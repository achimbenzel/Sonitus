/* ============================================================
   Pre-dither effect chain. Pure buffer math (no DOM) so it runs
   inside the worker, and every effect is deterministic — a frame
   reprocessed with identical settings is pixel-identical, which
   keeps the playback buffer cache valid.

   The chain order is user-controlled (`fxOrder` in the settings,
   reordered with the sidebar arrows) and defaults to:
     Blur → Sharpen → Edge boost → Glow → Noise → Posterize
   Each step only runs while its enable toggle is on; strengths are
   keyframable, so per-frame values flow in via evaluated settings.
   ============================================================ */

import type { EffectId, PipelineSettings } from '../types'
import { DEFAULT_FX_ORDER } from '../types'
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

type EffectStep = (data: Uint8ClampedArray, w: number, h: number, s: PipelineSettings) => void

const EFFECT_STEPS: Record<EffectId, EffectStep> = {
  // Blur — box blur at the (keyframable) radius
  blur: (data, w, h, s) => {
    const radius = Math.round(s.preBlur)
    if (s.fxBlurOn && radius > 0) boxBlurRgb(data, w, h, radius)
  },
  // Sharpen — unsharp mask: src + k · (src − blur(src))
  sharpen: (data, w, h, s) => {
    if (!s.fxSharpenOn || s.fxSharpen <= 0) return
    const soft = toFloatRgb(data)
    blurFloatRgb(soft, w, h, 1)
    const k = (s.fxSharpen / 100) * 1.6
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      data[i] = data[i] + k * (data[i] - soft[p])
      data[i + 1] = data[i + 1] + k * (data[i + 1] - soft[p + 1])
      data[i + 2] = data[i + 2] + k * (data[i + 2] - soft[p + 2])
    }
  },
  // Edge boost — brighten along Sobel edges
  edge: (data, w, h, s) => {
    if (!s.fxEdgeOn || s.fxEdge <= 0) return
    const mag = sobelEdges(data, w, h)
    const k = (s.fxEdge / 100) * 170
    for (let p = 0, i = 0; p < mag.length; p++, i += 4) {
      const add = mag[p] * k
      if (add === 0) continue
      data[i] = data[i] + add
      data[i + 1] = data[i + 1] + add
      data[i + 2] = data[i + 2] + add
    }
  },
  // Glow — screen-blend a wide blurred copy
  glow: (data, w, h, s) => {
    if (!s.fxGlowOn || s.fxGlow <= 0) return
    const soft = toFloatRgb(data)
    blurFloatRgb(soft, w, h, Math.max(2, Math.round(w / 60)))
    const g = s.fxGlow / 100
    for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
      data[i] = 255 - ((255 - data[i]) * (255 - soft[p] * g)) / 255
      data[i + 1] = 255 - ((255 - data[i + 1]) * (255 - soft[p + 1] * g)) / 255
      data[i + 2] = 255 - ((255 - data[i + 2]) * (255 - soft[p + 2] * g)) / 255
    }
  },
  // Noise — deterministic signed grain
  noise: (data, w, _h, s) => {
    if (!s.fxNoiseOn || s.fxNoise <= 0) return
    const amp = (s.fxNoise / 100) * 64
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const d = (whiteNoise(p % w, (p / w) | 0) - 0.5) * 2 * amp
      data[i] = data[i] + d
      data[i + 1] = data[i + 1] + d
      data[i + 2] = data[i + 2] + d
    }
  },
  // Posterize — per-channel level quantization
  posterize: (data, _w, _h, s) => {
    if (!s.fxPosterizeOn) return
    const levels = Math.min(16, Math.max(2, Math.round(s.fxPosterize)))
    const step = 255 / (levels - 1)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.round(data[i] / step) * step
      data[i + 1] = Math.round(data[i + 1] / step) * step
      data[i + 2] = Math.round(data[i + 2] / step) * step
    }
  },
}

/** Sanitize a stored order: drop unknown ids and duplicates, append
 *  any missing effects in default order — the chain always contains
 *  every effect exactly once. */
export function normalizeFxOrder(order: unknown): EffectId[] {
  const seen = new Set<EffectId>()
  const out: EffectId[] = []
  if (Array.isArray(order)) {
    for (const id of order) {
      if ((DEFAULT_FX_ORDER as readonly string[]).includes(id as string) && !seen.has(id as EffectId)) {
        seen.add(id as EffectId)
        out.push(id as EffectId)
      }
    }
  }
  for (const id of DEFAULT_FX_ORDER) if (!seen.has(id)) out.push(id)
  return out
}

/** Runs the enabled pre-dither effects in the user's chain order. */
export function applyEffects(data: Uint8ClampedArray, w: number, h: number, s: PipelineSettings): void {
  for (const id of normalizeFxOrder(s.fxOrder)) {
    EFFECT_STEPS[id](data, w, h, s)
  }
}
