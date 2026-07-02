/* ============================================================
   Keyframe system — pure functions over an immutable KeyframeMap.

   - Numeric parameters interpolate linearly between keyframes
     (integer parameters are rounded after interpolation).
   - Color parameters interpolate per RGB channel.
   - Before the first / after the last keyframe the edge value holds.
   - A parameter with no keyframes falls through to the base settings,
     so non-keyframed editing is completely unaffected.
   ============================================================ */

import type { DitherSettings, Keyframe, KeyframeMap, KeyframableParam } from '../types'
import { hexToRgb } from '../dither/palette'

export const KEYFRAMABLE_PARAMS: readonly KeyframableParam[] = [
  'resolution',
  'brightness',
  'contrast',
  'gamma',
  'threshold',
  'preBlur',
  'greyLevels',
  'pixelScale',
  'lightColor',
  'darkColor',
]

const INT_PARAMS = new Set<KeyframableParam>(['resolution', 'greyLevels', 'pixelScale'])
const COLOR_PARAMS = new Set<KeyframableParam>(['lightColor', 'darkColor'])

export function isColorParam(param: KeyframableParam): boolean {
  return COLOR_PARAMS.has(param)
}

/* ---------- evaluation ---------- */

/** Index of the last keyframe with kf.frame <= frame, or -1. */
function lowerIndex(list: Keyframe[], frame: number): number {
  let lo = 0
  let hi = list.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (list[mid].frame <= frame) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  const c = [0, 1, 2].map((i) => Math.round(lerp(ca[i], cb[i], t)))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

function evalParam(param: KeyframableParam, list: Keyframe[], frame: number): number | string {
  const i = lowerIndex(list, frame)
  if (i === -1) return list[0].value
  if (i === list.length - 1) return list[i].value
  const a = list[i]
  const b = list[i + 1]
  if (a.frame === frame || b.frame === a.frame) return a.value
  const t = (frame - a.frame) / (b.frame - a.frame)
  if (COLOR_PARAMS.has(param)) {
    return lerpHex(String(a.value), String(b.value), t)
  }
  const v = lerp(Number(a.value), Number(b.value), t)
  return INT_PARAMS.has(param) ? Math.round(v) : v
}

/** Base settings with all keyframed parameters evaluated at `frame`. */
export function evaluateSettings(
  base: DitherSettings,
  kfs: KeyframeMap,
  frame: number,
): DitherSettings {
  let out: DitherSettings | null = null
  for (const param of KEYFRAMABLE_PARAMS) {
    const list = kfs[param]
    if (!list || list.length === 0) continue
    if (!out) out = { ...base }
    ;(out as Record<KeyframableParam, number | string>)[param] = evalParam(param, list, frame)
  }
  return out ?? base
}

/* ---------- editing (immutable updates) ---------- */

/** Insert or replace the keyframe for `param` at `frame`. */
export function setKeyframe(
  kfs: KeyframeMap,
  param: KeyframableParam,
  frame: number,
  value: number | string,
): KeyframeMap {
  const list = kfs[param] ?? []
  const next = list.filter((k) => k.frame !== frame)
  next.push({ frame, value })
  next.sort((a, b) => a.frame - b.frame)
  return { ...kfs, [param]: next }
}

/** Remove the keyframe at `frame`; drops the param entry when empty. */
export function removeKeyframe(
  kfs: KeyframeMap,
  param: KeyframableParam,
  frame: number,
): KeyframeMap {
  const list = kfs[param]
  if (!list) return kfs
  const next = list.filter((k) => k.frame !== frame)
  const out = { ...kfs }
  if (next.length === 0) delete out[param]
  else out[param] = next
  return out
}

export function hasKeyframes(kfs: KeyframeMap, param: KeyframableParam): boolean {
  return (kfs[param]?.length ?? 0) > 0
}

export function hasKeyframeAt(kfs: KeyframeMap, param: KeyframableParam, frame: number): boolean {
  return kfs[param]?.some((k) => k.frame === frame) ?? false
}

/** Nearest keyframe frame strictly before `frame`, or null. */
export function prevKeyframe(kfs: KeyframeMap, param: KeyframableParam, frame: number): number | null {
  const list = kfs[param]
  if (!list) return null
  let best: number | null = null
  for (const k of list) {
    if (k.frame < frame) best = k.frame
    else break
  }
  return best
}

/** Nearest keyframe frame strictly after `frame`, or null. */
export function nextKeyframe(kfs: KeyframeMap, param: KeyframableParam, frame: number): number | null {
  const list = kfs[param]
  if (!list) return null
  for (const k of list) {
    if (k.frame > frame) return k.frame
  }
  return null
}

/** Sorted union of all frames that hold at least one keyframe. */
export function allKeyframeFrames(kfs: KeyframeMap): number[] {
  const set = new Set<number>()
  for (const param of KEYFRAMABLE_PARAMS) {
    for (const k of kfs[param] ?? []) set.add(k.frame)
  }
  return [...set].sort((a, b) => a - b)
}
