/* ============================================================
   The dither pipeline. Pure functions over plain image buffers —
   no DOM, no React — so it runs identically inside a Web Worker
   or on the main thread (and can be unit-tested headlessly).

   Order of operations:
     1. tone LUT (brightness → contrast → gamma → invert)
     2. pre-blur (separable box blur)
     3. dither
        - mono: luminance → N grey levels → dark/light color ramp
        - image: median-cut palette → nearest-color quantization
   The input is already downscaled to the processing resolution by
   the caller; upscaling (pixelScale) also happens outside.
   ============================================================ */

import type { PipelineSettings, RawImage } from '../types'
import { DIFFUSION_KERNELS } from './algorithms/kernels'
import { getBayerMatrix } from './algorithms/bayer'
import { getAlgorithm } from './algorithms/index'
import { BLUE_NOISE_SIZE, getBlueNoise, valueNoise, whiteNoise } from './algorithms/noise'
import { hexToRgb, medianCutPalette, monoRamp, type RGB } from './palette'

export function processImage(src: RawImage, s: PipelineSettings): RawImage {
  const { width, height } = src
  const data = new Uint8ClampedArray(src.data)

  applyToneLut(data, s)
  applyResampling(data, width, height, s)
  const blurRadius = Math.round(s.preBlur)
  if (blurRadius > 0) boxBlurRgb(data, width, height, blurRadius)

  if (s.paletteMode === 'image') {
    ditherToImagePalette(data, width, height, s)
  } else {
    ditherMono(data, width, height, s)
  }
  return { data, width, height }
}

/* ---------- Tone adjustments ---------- */

function applyToneLut(data: Uint8ClampedArray, s: PipelineSettings): void {
  const lut = new Uint8ClampedArray(256)
  const bright = s.brightness * 1.275 // map ±100 → ±127.5
  const contrast = 1 + s.contrast / 100 // 0..2
  const invGamma = 1 / Math.max(0.05, s.gamma)
  for (let v = 0; v < 256; v++) {
    let x = v + bright
    x = (x - 127.5) * contrast + 127.5
    x = 255 * Math.pow(Math.min(1, Math.max(0, x / 255)), invGamma)
    if (s.invert) x = 255 - x
    lut[v] = x
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
}

/** Resampling character pass, applied at processing resolution.
 *  - nearest / linear: sampling alone (handled during downscale).
 *  - soft: a gentle 1px blur takes the edge off hard details.
 *  - bleeding: blur + a smoothstep midtone expansion. The blur lets
 *    neighbouring tones flow into each other and the S-curve pulls
 *    them back apart, which rounds corners and makes shapes "bleed"
 *    like ink on paper without crushing the image. */
function applyResampling(data: Uint8ClampedArray, w: number, h: number, s: PipelineSettings): void {
  if (s.resampling === 'soft') {
    boxBlurRgb(data, w, h, 1)
    return
  }
  if (s.resampling !== 'bleeding') return
  boxBlurRgb(data, w, h, 2)
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) {
    const t = v / 255
    const smooth = t * t * (3 - 2 * t) // smoothstep
    // Blend keeps it predictable: 70% rounded curve, 30% original tone.
    lut[v] = 255 * (0.7 * smooth + 0.3 * t)
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
}

/** Separable box blur on RGB (alpha untouched, avoids edge halos).
 *  Two passes per axis approximate a gaussian well enough here. */
function boxBlurRgb(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const r = Math.min(radius, 32)
  const tmp = new Float32Array(w * h * 3)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    tmp[p] = data[i]
    tmp[p + 1] = data[i + 1]
    tmp[p + 2] = data[i + 2]
  }
  blurAxis(tmp, w, h, r, true)
  blurAxis(tmp, w, h, r, false)
  blurAxis(tmp, w, h, r, true)
  blurAxis(tmp, w, h, r, false)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    data[i] = tmp[p]
    data[i + 1] = tmp[p + 1]
    data[i + 2] = tmp[p + 2]
  }
}

function blurAxis(buf: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const lineLen = horizontal ? w : h
  const lines = horizontal ? h : w
  const stridePx = horizontal ? 1 : w
  const window = r * 2 + 1
  const line = new Float32Array(lineLen * 3)
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * w : l
    for (let i = 0; i < lineLen; i++) {
      const p = (base + i * stridePx) * 3
      line[i * 3] = buf[p]
      line[i * 3 + 1] = buf[p + 1]
      line[i * 3 + 2] = buf[p + 2]
    }
    let sr = 0
    let sg = 0
    let sb = 0
    // Prime the sliding window with edge-clamped samples.
    for (let i = -r; i <= r; i++) {
      const j = Math.min(lineLen - 1, Math.max(0, i)) * 3
      sr += line[j]
      sg += line[j + 1]
      sb += line[j + 2]
    }
    for (let i = 0; i < lineLen; i++) {
      const p = (base + i * stridePx) * 3
      buf[p] = sr / window
      buf[p + 1] = sg / window
      buf[p + 2] = sb / window
      const addI = Math.min(lineLen - 1, i + r + 1) * 3
      const subI = Math.max(0, i - r) * 3
      sr += line[addI] - line[subI]
      sg += line[addI + 1] - line[subI + 1]
      sb += line[addI + 2] - line[subI + 2]
    }
  }
}

/* ---------- Threshold sources for ordered / stochastic modes ---------- */

type ThresholdFn = (x: number, y: number) => number

function makeThresholdFn(s: PipelineSettings): ThresholdFn {
  const def = getAlgorithm(s.algorithm)
  if (def.kind === 'ordered') {
    const size = def.bayerSize ?? 4
    const m = getBayerMatrix(size)
    return (x, y) => m[(y % size) * size + (x % size)]
  }
  if (s.algorithm === 'blue-noise') {
    const tex = getBlueNoise()
    const n = BLUE_NOISE_SIZE
    return (x, y) => tex[(y % n) * n + (x % n)]
  }
  if (s.algorithm === 'value-noise') return valueNoise
  return whiteNoise
}

/* ---------- Mono / grayscale dithering ---------- */

function ditherMono(data: Uint8ClampedArray, w: number, h: number, s: PipelineSettings): void {
  const levels = Math.min(16, Math.max(2, Math.round(s.greyLevels)))
  const maxLevel = levels - 1
  const step = 255 / maxLevel
  const bias = s.threshold * 1.275 // positive threshold → darker output
  const n = w * h

  // Rec. 709 luminance, with the threshold bias folded in.
  const lum = new Float32Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] - bias
  }

  const levelIdx = new Uint8Array(n)
  const def = getAlgorithm(s.algorithm)

  if (def.kind === 'error-diffusion') {
    const kernel = DIFFUSION_KERNELS[s.algorithm]
    const { div, taps } = kernel
    for (let y = 0; y < h; y++) {
      const reverse = s.serpentine && (y & 1) === 1
      const xStart = reverse ? w - 1 : 0
      const xEnd = reverse ? -1 : w
      const xStep = reverse ? -1 : 1
      for (let x = xStart; x !== xEnd; x += xStep) {
        const p = y * w + x
        const old = lum[p]
        let idx = Math.round((old / 255) * maxLevel)
        if (idx < 0) idx = 0
        else if (idx > maxLevel) idx = maxLevel
        levelIdx[p] = idx
        const err = old - idx * step
        for (const [tdx, tdy, tw] of taps) {
          const nx = x + (reverse ? -tdx : tdx)
          const ny = y + tdy
          if (nx < 0 || nx >= w || ny >= h) continue
          lum[ny * w + nx] += (err * tw) / div
        }
      }
    }
  } else {
    // Ordered / stochastic: perturb by one quantization step around the
    // threshold texture, then round to the nearest level.
    const tf = makeThresholdFn(s)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        const v = lum[p] + (tf(x, y) - 0.5) * step
        let idx = Math.round((v / 255) * maxLevel)
        if (idx < 0) idx = 0
        else if (idx > maxLevel) idx = maxLevel
        levelIdx[p] = idx
      }
    }
  }

  const ramp = monoRamp(s.darkColor, s.lightColor, levels)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const c = ramp[levelIdx[p]]
    data[i] = c[0]
    data[i + 1] = c[1]
    data[i + 2] = c[2]
  }
}

/* ---------- Image-palette dithering ---------- */

/** Nearest-palette lookup memoized on a 15-bit RGB key. Palettes are
 *  ≤ 32 colors so a linear scan per distinct color is cheap. */
function makeNearest(palette: RGB[]) {
  const cache = new Int16Array(32768).fill(-1)
  return (r: number, g: number, b: number): number => {
    const rc = r < 0 ? 0 : r > 255 ? 255 : r | 0
    const gc = g < 0 ? 0 : g > 255 ? 255 : g | 0
    const bc = b < 0 ? 0 : b > 255 ? 255 : b | 0
    const key = ((rc >> 3) << 10) | ((gc >> 3) << 5) | (bc >> 3)
    const hit = cache[key]
    if (hit >= 0) return hit
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < palette.length; i++) {
      const dr = rc - palette[i][0]
      const dg = gc - palette[i][1]
      const db = bc - palette[i][2]
      const d = dr * dr + dg * dg + db * db
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    cache[key] = best
    return best
  }
}

function ditherToImagePalette(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  s: PipelineSettings,
): void {
  const count = Math.min(32, Math.max(2, Math.round(s.paletteSize)))
  const palette = medianCutPalette(data, count)
  const nearest = makeNearest(palette)
  const bias = s.threshold * 1.275
  const n = w * h
  const def = getAlgorithm(s.algorithm)

  if (def.kind === 'error-diffusion') {
    const fr = new Float32Array(n)
    const fg = new Float32Array(n)
    const fb = new Float32Array(n)
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      fr[p] = data[i] - bias
      fg[p] = data[i + 1] - bias
      fb[p] = data[i + 2] - bias
    }
    const { div, taps } = DIFFUSION_KERNELS[s.algorithm]
    for (let y = 0; y < h; y++) {
      const reverse = s.serpentine && (y & 1) === 1
      const xStart = reverse ? w - 1 : 0
      const xEnd = reverse ? -1 : w
      const xStep = reverse ? -1 : 1
      for (let x = xStart; x !== xEnd; x += xStep) {
        const p = y * w + x
        const or = fr[p]
        const og = fg[p]
        const ob = fb[p]
        const c = palette[nearest(or, og, ob)]
        const er = or - c[0]
        const eg = og - c[1]
        const eb = ob - c[2]
        const i = p * 4
        data[i] = c[0]
        data[i + 1] = c[1]
        data[i + 2] = c[2]
        for (const [tdx, tdy, tw] of taps) {
          const nx = x + (reverse ? -tdx : tdx)
          const ny = y + tdy
          if (nx < 0 || nx >= w || ny >= h) continue
          const np = ny * w + nx
          const f = tw / div
          fr[np] += er * f
          fg[np] += eg * f
          fb[np] += eb * f
        }
      }
    }
  } else {
    // Ordered / stochastic against a palette: perturb each channel by
    // roughly one per-channel quantization step, then snap to the
    // nearest palette color.
    const perChannelLevels = Math.max(2, Math.round(Math.cbrt(palette.length)))
    const step = 255 / (perChannelLevels - 1)
    const tf = makeThresholdFn(s)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const t = (tf(x, y) - 0.5) * step
        const c = palette[nearest(data[i] - bias + t, data[i + 1] - bias + t, data[i + 2] - bias + t)]
        data[i] = c[0]
        data[i + 1] = c[1]
        data[i + 2] = c[2]
      }
    }
  }
}

/* Re-exported for callers that need palette info (e.g. SVG export). */
export { hexToRgb }
