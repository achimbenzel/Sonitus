/* ============================================================
   Shared types for the whole app.
   ============================================================ */

export type AlgorithmId =
  // Error diffusion
  | 'floyd-steinberg'
  | 'jjn'
  | 'stucki'
  | 'atkinson'
  | 'burkes'
  | 'sierra'
  | 'two-row-sierra'
  | 'sierra-lite'
  // Ordered (Bayer)
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'bayer-16'
  // Stochastic
  | 'random'
  | 'blue-noise'
  | 'value-noise'

export type PaletteMode = 'mono' | 'image'

/** How selected colors are interpreted.
 *  'current' — palette-based mapping (mono ramp / extracted palette).
 *  'legacy'  — reproduction of the older HTML app: Rec.601 luminance
 *  with additive threshold in mono, and independent per-channel RGB
 *  level quantization in image mode. */
export type ColorMapping = 'current' | 'legacy'

/** Image-palette generation style ('custom' uses customPalette). */
export type PaletteStyle =
  | 'dominant'
  | 'average'
  | 'vibrant'
  | 'muted'
  | 'contrast'
  | 'custom'

/** Post-dither resampling method: applied AFTER dithering and AFTER
 *  the pixel-scale upscale, as the very last step of the pipeline.
 *  It softens/rounds the enlarged dither pixels without changing the
 *  output dimensions or the pattern size. 'bleeding' additionally
 *  pulls contrast back up for a rounded "ink bleed" look. */
export type ResamplingMethod = 'nearest' | 'linear' | 'soft' | 'bleeding'

/** All user-tweakable dither parameters. Kept flat so it can be
 *  hashed, serialized as a preset and diffed cheaply. */
export interface DitherSettings {
  algorithm: AlgorithmId
  /** Internal processing width in pixels (aspect ratio preserved). */
  resolution: number
  /** Post-dither softening method (used when postResample is on). */
  resampling: ResamplingMethod
  /** Enable the post-dither resampling pass (off = crisp output). */
  postResample: boolean
  /** -100 .. 100 */
  brightness: number
  /** -100 .. 100 */
  contrast: number
  /** Midtones. 0.2 .. 3, 1 = neutral. >1 brightens midtones. */
  gamma: number
  /** Quantization bias, -100 .. 100. Positive = darker result. */
  threshold: number
  /** Pre-blur radius in processed pixels, 0 .. 10. */
  preBlur: number
  invert: boolean
  /** Serpentine scanning (error diffusion only). */
  serpentine: boolean
  /** Number of tonal levels for mono output, 2 .. 16. */
  greyLevels: number
  paletteMode: PaletteMode
  /** Color interpretation mode (current palette vs legacy RGB levels). */
  colorMapping: ColorMapping
  /** Mono palette: color used for highlights (bright pixels). */
  lightColor: string
  /** Mono palette: color used for shadows (dark pixels). */
  darkColor: string
  /** Image palette: number of colors extracted from the source, 2 .. 32. */
  paletteSize: number
  /** Image palette: generation style. */
  paletteStyle: PaletteStyle
  /** User-defined palette (hex colors) for paletteStyle 'custom'. */
  customPalette: string[]
  /** Derived, not persisted: the resolved image palette shared by all
   *  frames (computed once from the source — prevents flicker). */
  resolvedPalette?: string[]
  /** Output pixel scale multiplier (export size = resolution * scale). */
  pixelScale: number
}

/** The subset of settings the worker pipeline needs.
 *  `resolution` and `pixelScale` are applied outside the worker. */
export type PipelineSettings = Omit<DitherSettings, 'resolution' | 'pixelScale'>

export const DEFAULT_SETTINGS: DitherSettings = {
  algorithm: 'floyd-steinberg',
  resolution: 320,
  resampling: 'soft',
  postResample: false,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  threshold: 0,
  preBlur: 0,
  invert: false,
  serpentine: true,
  greyLevels: 2,
  paletteMode: 'mono',
  colorMapping: 'current',
  lightColor: '#e8f4f8',
  darkColor: '#071318',
  paletteSize: 8,
  paletteStyle: 'dominant',
  customPalette: ['#071318', '#1c3fae', '#46b3cc', '#4af17a', '#ffb02e', '#e8f4f8'],
  pixelScale: 4,
}

export type ProjectKind = 'none' | 'image' | 'sequence' | 'video'

/** One imported frame. Pixel data stays in `source` (a File or an
 *  extracted Blob) and is decoded on demand through an LRU cache, so
 *  long sequences do not exhaust memory. */
export interface SourceFrame {
  id: string
  index: number
  name: string
  width: number
  height: number
  source: File | Blob
  /** Small JPEG data URL for the timeline. */
  thumb: string
}

export type CompareMode = 'dithered' | 'original' | 'split'

export type ExportKind = 'png' | 'jpeg' | 'svg' | 'sequence' | 'mp4' | 'gif' | 'cmyk'

/* ---------- Keyframes ---------- */

/** Settings keys that can be animated on the timeline. */
export type KeyframableParam =
  | 'resolution'
  | 'brightness'
  | 'contrast'
  | 'gamma'
  | 'threshold'
  | 'preBlur'
  | 'greyLevels'
  | 'pixelScale'
  | 'lightColor'
  | 'darkColor'

/** Easing applied to the transition FROM a keyframe to the next one. */
export type EasingId = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold'

export interface Keyframe {
  /** Timeline frame index the keyframe sits on (at the current FPS). */
  frame: number
  /** Authoritative time position in seconds. When the FPS changes,
   *  `frame` is recomputed from this so keyframes keep their time. */
  time: number
  /** Number for numeric params, hex string for color params. */
  value: number | string
  /** Easing of the outgoing segment (default: linear). */
  easing?: EasingId
}

/** A selected keyframe in the timeline (for easing editing etc.). */
export interface KeyframeRef {
  param: KeyframableParam
  frame: number
}

/** Per-parameter keyframe lists, each kept sorted by frame. */
export type KeyframeMap = Partial<Record<KeyframableParam, Keyframe[]>>

/* ---------- Timeline ---------- */

export interface TimelineState {
  /** Playback rate. */
  fps: number
  /** Timeline length in seconds when no sequence dictates it. */
  durationSeconds: number
  /** Total timeline frames (sequence length, or fps * duration). */
  totalFrames: number
}

/** Plain-object image so the pipeline is usable both on the main
 *  thread and inside workers (and in node-based tests). */
export interface RawImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface ProgressState {
  label: string
  /** 0..1, or null for indeterminate. */
  value: number | null
  cancellable?: boolean
}
