/* ============================================================
   Animation presets: one click generates ordinary keyframes for
   an animated dither look. The generated keyframes are regular
   timeline keyframes — draggable, easing-editable and deletable
   like hand-made ones — and applying a preset is a single undo
   step. A preset replaces only the keyframes of the parameters
   it animates; keyframes on other parameters are kept.
   ============================================================ */

import type {
  DitherSettings,
  EasingId,
  Keyframe,
  KeyframableParam,
  KeyframeMap,
} from '../types'
import { hexToRgb, rgbToHex } from '../dither/palette'

export interface AnimPreset {
  id: string
  name: string
  description: string
  /** Params this preset animates (their existing keyframes are replaced). */
  params: KeyframableParam[]
  /** Settings the animation needs to be visible (effect toggles etc.). */
  settings?: Partial<DitherSettings>
  /** Build the keyframes for a timeline of `duration` seconds. */
  build: (duration: number, fps: number, settings: DitherSettings) => KeyframeMap
}

function kf(
  time: number,
  fps: number,
  value: number | string,
  easing: EasingId = 'ease-in-out',
): Keyframe {
  return { frame: Math.round(time * fps), time, value, easing }
}

/** Drop points that collapse onto an already-used frame (short
 *  timelines at low FPS), keeping one keyframe per frame. */
function dedupe(list: Keyframe[]): Keyframe[] {
  const seen = new Set<number>()
  return list.filter((k) => (seen.has(k.frame) ? false : (seen.add(k.frame), true)))
}

/** Rotate a hex color's hue by `deg` degrees (s/v preserved). */
function rotateHue(hex: string, deg: number): string {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  const v = max
  h = (h + deg + 360) % 360
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [rr, gg, bb] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
      : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return rgbToHex([
    Math.round((rr + m) * 255),
    Math.round((gg + m) * 255),
    Math.round((bb + m) * 255),
  ])
}

export const ANIM_PRESETS: AnimPreset[] = [
  {
    id: 'threshold-pulse',
    name: 'Threshold pulse',
    description: 'The dither threshold swings dark and bright in one smooth breathing cycle.',
    params: ['threshold'],
    build: (dur, fps) => ({
      threshold: dedupe([
        kf(0, fps, 0),
        kf(dur * 0.25, fps, 45),
        kf(dur * 0.5, fps, 0),
        kf(dur * 0.75, fps, -45),
        kf(dur, fps, 0),
      ]),
    }),
  },
  {
    id: 'pixel-crunch',
    name: 'Pixel crunch',
    description: 'Resolution collapses into chunky pixels mid-timeline and recovers.',
    params: ['resolution'],
    build: (dur, fps, s) => {
      const hi = s.resolution
      const lo = Math.max(16, Math.round(hi / 6))
      return {
        resolution: dedupe([kf(0, fps, hi), kf(dur * 0.5, fps, lo), kf(dur, fps, hi)]),
      }
    },
  },
  {
    id: 'glow-bloom',
    name: 'Glow bloom',
    description: 'A glow swells to full strength and fades out again. Enables the Glow effect.',
    params: ['fxGlow'],
    settings: { fxGlowOn: true },
    build: (dur, fps) => ({
      fxGlow: dedupe([kf(0, fps, 0), kf(dur * 0.5, fps, 100), kf(dur, fps, 0)]),
    }),
  },
  {
    id: 'noise-storm',
    name: 'Noise storm',
    description: 'Grain rushes in, rumbles, and settles. Enables the Noise effect.',
    params: ['fxNoise'],
    settings: { fxNoiseOn: true },
    build: (dur, fps) => ({
      fxNoise: dedupe([
        kf(0, fps, 0),
        kf(dur * 0.35, fps, 85),
        kf(dur * 0.65, fps, 55),
        kf(dur, fps, 0),
      ]),
    }),
  },
  {
    id: 'strobe-flicker',
    name: 'Strobe flicker',
    description: 'Brightness jumps between hard levels with no blending (hold easing).',
    params: ['brightness'],
    build: (dur, fps) => {
      const levels = [0, 45, -35, 30, -50, 40, -25, 0]
      return {
        brightness: dedupe(
          levels.map((v, i) => kf((dur * i) / (levels.length - 1), fps, v, 'hold')),
        ),
      }
    },
  },
  {
    id: 'color-drift',
    name: 'Color drift',
    description: 'The highlight color drifts once around the hue wheel (mono palettes).',
    params: ['lightColor'],
    settings: { paletteMode: 'mono' },
    build: (dur, fps, s) => ({
      lightColor: dedupe(
        [0, 90, 180, 270, 360].map((deg, i) =>
          kf((dur * i) / 4, fps, rotateHue(s.lightColor, deg), 'linear'),
        ),
      ),
    }),
  },
  {
    id: 'focus-pull',
    name: 'Focus pull',
    description: 'Starts defocused, snaps into sharp focus, then blurs back. Enables Blur.',
    params: ['preBlur'],
    settings: { fxBlurOn: true },
    build: (dur, fps) => ({
      preBlur: dedupe([
        kf(0, fps, 6),
        kf(dur * 0.4, fps, 0),
        kf(dur * 0.6, fps, 0),
        kf(dur, fps, 6),
      ]),
    }),
  },
]
