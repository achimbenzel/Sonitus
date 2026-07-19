/* ============================================================
   The dither pipeline. Pure functions over plain image buffers —
   no DOM, no React — so it runs identically inside a Web Worker
   or on the main thread (and can be unit-tested headlessly).

   Order of operations:
     1. tone LUT (brightness → contrast → gamma → invert)
     2. pre-dither effect chain (blur, sharpen, edge boost, glow,
        noise, posterize, contrast boost — see effects.ts)
     3. dither
        - mono: luminance → N grey levels → dark/light color ramp
        - image: median-cut palette → nearest-color quantization
   The input is already downscaled to the processing resolution by
   the caller; upscaling (pixelScale) also happens outside.
   ============================================================ */

import type { PipelineSettings, RawImage } from '../types'
import { DIFFUSION_KERNELS } from './algorithms/kernels'
import { getBayerMatrix } from './algorithms/bayer'
import { getPatternMatrix } from './algorithms/patterns'
import { getAlgorithm } from './algorithms/index'
import {
  BLUE_NOISE_SIZE,
  dispersedDot,
  gaussNoise,
  getBlueNoise,
  grainNoise,
  patternNoise,
  valueNoise,
  whiteNoise,
  xorPattern,
} from './algorithms/noise'
import { dotDiffuse } from './algorithms/dotDiffusion'
import { applyEffects, sobelEdges } from './effects'
import { hexToRgb, medianCutPalette, monoRamp, type RGB } from './palette'

export function processImage(src: RawImage, s: PipelineSettings): RawImage {
  const { width, height } = src
  const data = new Uint8ClampedArray(src.data)

  // Optional background fill: composite transparent source pixels over
  // the background color first, so they dither like normal pixels.
  if (s.bgFillOn) {
    const [br, bg, bb] = hexToRgb(s.bgColor)
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]
      if (a === 255) continue
      const t = a / 255
      data[i] = data[i] * t + br * (1 - t)
      data[i + 1] = data[i + 1] * t + bg * (1 - t)
      data[i + 2] = data[i + 2] * t + bb * (1 - t)
      data[i + 3] = 255
    }
  }

  applyToneLut(data, s)
  applyEffects(data, width, height, s)

  if (s.paletteMode === 'image') {
    if (s.colorMapping === 'legacy') {
      // Legacy "Color (Levels)": independent per-channel quantization.
      ditherRgbLevels(data, width, height, s)
    } else {
      ditherToImagePalette(data, width, height, s)
    }
  } else {
    ditherMono(data, width, height, s)
  }

  applyReveal(data, width, height, s)
  return { data, width, height }
}

/* ---------- Dither-in reveal ----------
   Post-dither wipe with a dithered dissolve edge: pixels ahead of the
   sweep front turn fully transparent, pixels inside the softness band
   drop out per-pixel against a Bayer-8 pattern — so the image "dithers
   in" from the chosen direction as revealAmount animates 0 → 100.   */

function applyReveal(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  s: Pick<PipelineSettings, 'revealAmount' | 'revealDirection' | 'revealSoftness'>,
): void {
  const r = Math.min(100, Math.max(0, s.revealAmount)) / 100
  if (r >= 1) return

  // Per-pixel progress along the sweep, 0 (revealed first) .. 1 (last).
  const mx = (width - 1) / 2
  const my = (height - 1) / 2
  const maxRadial = Math.hypot(mx, my) || 1
  const progress: (x: number, y: number) => number = {
    left: (x: number) => (width > 1 ? x / (width - 1) : 0),
    right: (x: number) => (width > 1 ? 1 - x / (width - 1) : 0),
    top: (_x: number, y: number) => (height > 1 ? y / (height - 1) : 0),
    bottom: (_x: number, y: number) => (height > 1 ? 1 - y / (height - 1) : 0),
    center: (x: number, y: number) => Math.hypot(x - mx, y - my) / maxRadial,
    edges: (x: number, y: number) => 1 - Math.hypot(x - mx, y - my) / maxRadial,
  }[s.revealDirection]

  // Softness 0..100 → dissolve band as a fraction of the sweep span.
  // The front travels through 1 + band so r=0 hides and r=1 shows all.
  const band = Math.max(0.02, (Math.min(100, Math.max(0, s.revealSoftness)) / 100) * 0.6)
  const front = r * (1 + band)
  const bayer = getBayerMatrix(8)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const m = (front - progress(x, y)) / band
      if (m >= 1) continue
      if (m <= 0 || m < bayer[(y % 8) * 8 + (x % 8)]) {
        data[(y * width + x) * 4 + 3] = 0
      }
    }
  }
}

/* ---------- Tone adjustments ---------- */

/** Exported: palette extraction (App) runs the same LUT over its
 *  sample so extracted palettes match the adjusted image — without
 *  this, inverting an image would still yield the original palette. */
export function applyToneLut(
  data: Uint8ClampedArray,
  s: Pick<PipelineSettings, 'brightness' | 'contrast' | 'gamma' | 'invert'>,
): void {
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

/* ---------- Threshold sources for ordered / stochastic modes ---------- */

type ThresholdFn = (x: number, y: number) => number

const STOCHASTIC_FNS: Record<string, ThresholdFn> = {
  random: whiteNoise,
  'white-gauss': gaussNoise,
  'value-noise': valueNoise,
  'pattern-noise': patternNoise,
  grain: grainNoise,
  'dispersed-dot': dispersedDot,
  'arithmetic-xor': xorPattern,
}

function makeThresholdFn(s: PipelineSettings): ThresholdFn {
  const def = getAlgorithm(s.algorithm)
  if (def.kind === 'ordered') {
    if (def.pattern) {
      const { size, data } = getPatternMatrix(def.pattern, s.screenAngle)
      return (x, y) => data[(y % size) * size + (x % size)]
    }
    const size = def.bayerSize ?? 4
    const m = getBayerMatrix(size)
    return (x, y) => m[(y % size) * size + (x % size)]
  }
  if (s.algorithm === 'blue-noise') {
    const tex = getBlueNoise()
    const n = BLUE_NOISE_SIZE
    return (x, y) => tex[(y % n) * n + (x % n)]
  }
  return STOCHASTIC_FNS[s.algorithm] ?? whiteNoise
}

/* ---------- Hooks for the advanced error-diffusion variants ----------
   The stylized diffusion algorithms share the plain scanline loop and
   differ only in a per-pixel error scale (how much error survives) or
   an added threshold bias (a pattern folded into quantization).      */

interface EdHooks {
  /** Multiplies the diffused error at (x, y). */
  errScale?: (x: number, y: number) => number
  /** Added to the value being quantized at (x, y); already scaled to
   *  channel units (one quantization step ≈ `step`). */
  tBias?: (x: number, y: number) => number
}

function makeEdHooks(
  s: PipelineSettings,
  data: Uint8ClampedArray,
  w: number,
  h: number,
  step: number,
): EdHooks {
  switch (s.algorithm) {
    case 'modulated-x':
      // Error strength waves along x → vertical banding texture.
      return { errScale: (x) => 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(x * 0.32)) }
    case 'modulated-y':
      return { errScale: (_x, y) => 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(y * 0.32)) }
    case 'hybrid': {
      // Half-strength diffusion (kernel div is doubled) + a Bayer bias:
      // ordered structure with diffusion tone accuracy.
      const m = getBayerMatrix(4)
      return { tBias: (x, y) => (m[(y % 4) * 4 + (x % 4)] - 0.5) * step }
    }
    case 'contour': {
      // Blue-noise threshold modulation breaks up "worm" contours.
      const tex = getBlueNoise()
      const n = BLUE_NOISE_SIZE
      return { tBias: (x, y) => (tex[(y % n) * n + (x % n)] - 0.5) * step * 0.7 }
    }
    case 'edge-aware': {
      // Diffuse less error across strong edges so they stay crisp.
      const mag = sobelEdges(data, w, h)
      return { errScale: (x, y) => 1 - 0.85 * mag[y * w + x] }
    }
    default:
      return {}
  }
}

/* ---------- Mono / grayscale dithering ---------- */

function ditherMono(data: Uint8ClampedArray, w: number, h: number, s: PipelineSettings): void {
  const levels = Math.min(16, Math.max(2, Math.round(s.greyLevels)))
  const maxLevel = levels - 1
  const step = 255 / maxLevel
  const bias = s.threshold * 1.275
  const legacy = s.colorMapping === 'legacy'
  const n = w * h

  // Current: Rec.709 luminance, threshold folded in (positive → darker).
  // Legacy (old HTML app): Rec.601 luminance; the bias is ADDED at
  // quantization time only and the diffused error is measured against
  // the un-biased value — faithful to the original implementation.
  const lum = new Float32Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    lum[p] = legacy
      ? 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      : 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] - bias
  }
  const qBias = legacy ? bias : 0

  const levelIdx = new Uint8Array(n)
  const def = getAlgorithm(s.algorithm)

  const quantLevel = (v: number): number => {
    let idx = Math.round((v / 255) * maxLevel)
    if (idx < 0) idx = 0
    else if (idx > maxLevel) idx = maxLevel
    return idx
  }

  if (def.kind === 'error-diffusion') {
    const kernel = DIFFUSION_KERNELS[s.algorithm]
    const { div, taps } = kernel
    const hooks = makeEdHooks(s, data, w, h, step)
    for (let y = 0; y < h; y++) {
      const reverse = s.serpentine && (y & 1) === 1
      const xStart = reverse ? w - 1 : 0
      const xEnd = reverse ? -1 : w
      const xStep = reverse ? -1 : 1
      for (let x = xStart; x !== xEnd; x += xStep) {
        const p = y * w + x
        const old = lum[p]
        const tb = hooks.tBias ? hooks.tBias(x, y) : 0
        const idx = quantLevel(old + qBias + tb)
        levelIdx[p] = idx
        const scale = hooks.errScale ? hooks.errScale(x, y) : 1
        const err = (old - idx * step) * scale
        for (const [tdx, tdy, tw] of taps) {
          const nx = x + (reverse ? -tdx : tdx)
          const ny = y + tdy
          if (nx < 0 || nx >= w || ny >= h) continue
          lum[ny * w + nx] += (err * tw) / div
        }
      }
    }
  } else if (def.kind === 'dot-diffusion') {
    dotDiffuse([lum], w, h, (p) => {
      const idx = quantLevel(lum[p] + qBias)
      levelIdx[p] = idx
      return [idx * step]
    })
  } else {
    // Ordered / stochastic: perturb by one quantization step around the
    // threshold texture, then round to the nearest level.
    const tf = makeThresholdFn(s)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        const v = lum[p] + qBias + (tf(x, y) - 0.5) * step
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

/** Legacy image-color mode from the old HTML app: each RGB channel is
 *  quantized to `greyLevels` levels independently (posterized dither).
 *  Bias is added at quantization; error measured against the raw value. */
function ditherRgbLevels(data: Uint8ClampedArray, w: number, h: number, s: PipelineSettings): void {
  const levels = Math.min(16, Math.max(2, Math.round(s.greyLevels)))
  const qStep = 255 / (levels - 1)
  const bias = s.threshold * 1.275
  const n = w * h
  const def = getAlgorithm(s.algorithm)

  const chans = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    chans[0][p] = data[i]
    chans[1][p] = data[i + 1]
    chans[2][p] = data[i + 2]
  }
  const quant = (v: number): number => {
    const q = Math.round(Math.min(255, Math.max(0, v)) / qStep) * qStep
    return q < 0 ? 0 : q > 255 ? 255 : q
  }

  if (def.kind === 'error-diffusion') {
    const { div, taps } = DIFFUSION_KERNELS[s.algorithm]
    const hooks = makeEdHooks(s, data, w, h, qStep)
    for (let y = 0; y < h; y++) {
      const reverse = s.serpentine && (y & 1) === 1
      const xStart = reverse ? w - 1 : 0
      const xEnd = reverse ? -1 : w
      const xStep = reverse ? -1 : 1
      for (let x = xStart; x !== xEnd; x += xStep) {
        const p = y * w + x
        const i = p * 4
        const tb = hooks.tBias ? hooks.tBias(x, y) : 0
        const scale = hooks.errScale ? hooks.errScale(x, y) : 1
        for (let c = 0; c < 3; c++) {
          const arr = chans[c]
          const old = arr[p]
          const q = quant(old + bias + tb)
          const err = (old - q) * scale
          data[i + c] = q
          for (const [tdx, tdy, tw] of taps) {
            const nx = x + (reverse ? -tdx : tdx)
            const ny = y + tdy
            if (nx < 0 || nx >= w || ny >= h) continue
            arr[ny * w + nx] += (err * tw) / div
          }
        }
      }
    }
  } else if (def.kind === 'dot-diffusion') {
    dotDiffuse(chans, w, h, (p) => {
      const i = p * 4
      const q0 = quant(chans[0][p] + bias)
      const q1 = quant(chans[1][p] + bias)
      const q2 = quant(chans[2][p] + bias)
      data[i] = q0
      data[i + 1] = q1
      data[i + 2] = q2
      return [q0, q1, q2]
    })
  } else {
    const tf = makeThresholdFn(s)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        const i = p * 4
        const t = (tf(x, y) - 0.5) * qStep
        data[i] = quant(chans[0][p] + t + bias)
        data[i + 1] = quant(chans[1][p] + t + bias)
        data[i + 2] = quant(chans[2][p] + t + bias)
      }
    }
  }
}

function ditherToImagePalette(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  s: PipelineSettings,
): void {
  const count = Math.min(32, Math.max(2, Math.round(s.paletteSize)))
  // A resolved palette (computed once from the source, shared by every
  // frame) prevents per-frame palette flicker; fall back to per-frame
  // extraction only while it is not available yet.
  const palette: RGB[] =
    s.resolvedPalette && s.resolvedPalette.length >= 2
      ? s.resolvedPalette.map(hexToRgb)
      : medianCutPalette(data, count)
  const nearest = makeNearest(palette)
  const bias = s.threshold * 1.275
  const n = w * h
  const def = getAlgorithm(s.algorithm)

  // One "step" for threshold-bias hooks ≈ per-channel level spacing.
  const hookStep = 255 / Math.max(1, Math.round(Math.cbrt(palette.length)) - 1)

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
    const hooks = makeEdHooks(s, data, w, h, hookStep)
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
        const tb = hooks.tBias ? hooks.tBias(x, y) : 0
        const c = palette[nearest(or + tb, og + tb, ob + tb)]
        const scale = hooks.errScale ? hooks.errScale(x, y) : 1
        const er = (or - c[0]) * scale
        const eg = (og - c[1]) * scale
        const eb = (ob - c[2]) * scale
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
  } else if (def.kind === 'dot-diffusion') {
    const fr = new Float32Array(n)
    const fg = new Float32Array(n)
    const fb = new Float32Array(n)
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      fr[p] = data[i] - bias
      fg[p] = data[i + 1] - bias
      fb[p] = data[i + 2] - bias
    }
    dotDiffuse([fr, fg, fb], w, h, (p) => {
      const c = palette[nearest(fr[p], fg[p], fb[p])]
      const i = p * 4
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      return c
    })
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
