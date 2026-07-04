/* ============================================================
   Pre-dither effect chain. Pure buffer math (no DOM) so it runs
   inside the worker, and every effect is deterministic — a frame
   reprocessed with identical settings is pixel-identical, which
   keeps the playback buffer cache valid.

   Fixed order (matches the sidebar top-to-bottom):
     1. Blur        (preBlur — the long-standing pre-blur)
     2. Sharpen     (unsharp mask)
     3. Edge boost  (adds Sobel edge energy)
     4. Glow        (screen-blends a blurred copy)
     5. Noise       (deterministic grain)
     6. Posterize   (per-channel level quantization)
     7. Contrast boost (smoothstep S-curve)
   ============================================================ */

import type { PipelineSettings } from '../types'
import { whiteNoise } from './algorithms/noise'

/** Separable box blur on RGB (alpha untouched, avoids edge halos).
 *  Two passes per axis approximate a gaussian well enough here. */
export function boxBlurRgb(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const tmp = toFloatRgb(data)
  blurFloatRgb(tmp, w, h, radius)
  fromFloatRgb(data, tmp)
}

function toFloatRgb(data: Uint8ClampedArray): Float32Array {
  const tmp = new Float32Array((data.length / 4) * 3)
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    tmp[p] = data[i]
    tmp[p + 1] = data[i + 1]
    tmp[p + 2] = data[i + 2]
  }
  return tmp
}

function fromFloatRgb(data: Uint8ClampedArray, tmp: Float32Array): void {
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    data[i] = tmp[p]
    data[i + 1] = tmp[p + 1]
    data[i + 2] = tmp[p + 2]
  }
}

function blurFloatRgb(buf: Float32Array, w: number, h: number, radius: number): void {
  const r = Math.min(Math.max(1, Math.round(radius)), 32)
  blurAxis(buf, w, h, r, true)
  blurAxis(buf, w, h, r, false)
  blurAxis(buf, w, h, r, true)
  blurAxis(buf, w, h, r, false)
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

/** Sobel edge magnitude of the luminance, normalized to 0..1. */
function sobelEdges(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h
  const lum = new Float32Array(n)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    lum[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
  }
  const mag = new Float32Array(n)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const gx =
        -lum[p - w - 1] + lum[p - w + 1] - 2 * lum[p - 1] + 2 * lum[p + 1] - lum[p + w - 1] + lum[p + w + 1]
      const gy =
        -lum[p - w - 1] - 2 * lum[p - w] - lum[p - w + 1] + lum[p + w - 1] + 2 * lum[p + w] + lum[p + w + 1]
      mag[p] = Math.min(1, Math.sqrt(gx * gx + gy * gy) / 1020)
    }
  }
  return mag
}

export { sobelEdges }

/** Runs the enabled pre-dither effects in chain order, in place. */
export function applyEffects(data: Uint8ClampedArray, w: number, h: number, s: PipelineSettings): void {
  // 1. Blur
  const blurRadius = Math.round(s.preBlur)
  if (blurRadius > 0) boxBlurRgb(data, w, h, blurRadius)

  // 2. Sharpen — unsharp mask: src + k · (src − blur(src))
  if (s.fxSharpenOn && s.fxSharpen > 0) {
    const soft = toFloatRgb(data)
    blurFloatRgb(soft, w, h, 1)
    const k = (s.fxSharpen / 100) * 1.6
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      data[i] = data[i] + k * (data[i] - soft[p])
      data[i + 1] = data[i + 1] + k * (data[i + 1] - soft[p + 1])
      data[i + 2] = data[i + 2] + k * (data[i + 2] - soft[p + 2])
    }
  }

  // 3. Edge boost — brighten along Sobel edges
  if (s.fxEdgeOn && s.fxEdge > 0) {
    const mag = sobelEdges(data, w, h)
    const k = (s.fxEdge / 100) * 170
    for (let p = 0, i = 0; p < mag.length; p++, i += 4) {
      const add = mag[p] * k
      if (add === 0) continue
      data[i] = data[i] + add
      data[i + 1] = data[i + 1] + add
      data[i + 2] = data[i + 2] + add
    }
  }

  // 4. Glow — screen-blend a wide blurred copy
  if (s.fxGlowOn && s.fxGlow > 0) {
    const soft = toFloatRgb(data)
    blurFloatRgb(soft, w, h, Math.max(2, Math.round(w / 60)))
    const g = s.fxGlow / 100
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      data[i] = 255 - ((255 - data[i]) * (255 - soft[p] * g)) / 255
      data[i + 1] = 255 - ((255 - data[i + 1]) * (255 - soft[p + 1] * g)) / 255
      data[i + 2] = 255 - ((255 - data[i + 2]) * (255 - soft[p + 2] * g)) / 255
    }
  }

  // 5. Noise — deterministic signed grain
  if (s.fxNoiseOn && s.fxNoise > 0) {
    const amp = (s.fxNoise / 100) * 64
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const d = (whiteNoise(p % w, (p / w) | 0) - 0.5) * 2 * amp
      data[i] = data[i] + d
      data[i + 1] = data[i + 1] + d
      data[i + 2] = data[i + 2] + d
    }
  }

  // 6. Posterize — per-channel level quantization
  if (s.fxPosterizeOn) {
    const levels = Math.min(16, Math.max(2, Math.round(s.fxPosterize)))
    const step = 255 / (levels - 1)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i] / step) * step
      data[i + 1] = Math.round(data[i + 1] / step) * step
      data[i + 2] = Math.round(data[i + 2] / step) * step
    }
  }

  // 7. Contrast boost — smoothstep S-curve, mixed by strength
  if (s.fxContrastOn && s.fxContrast > 0) {
    const m = s.fxContrast / 100
    const lut = new Uint8ClampedArray(256)
    for (let v = 0; v < 256; v++) {
      const t = v / 255
      const st = t * t * (3 - 2 * t)
      lut[v] = 255 * (t * (1 - m) + st * m)
    }
    for (let i = 0; i < data.length; i += 4) {
      data[i] = lut[data[i]]
      data[i + 1] = lut[data[i + 1]]
      data[i + 2] = lut[data[i + 2]]
    }
  }
}
