/* ============================================================
   Shared types for the whole app.
   ============================================================ */

export type AlgorithmId =
  // Error diffusion
  | 'floyd-steinberg'
  | 'false-floyd-steinberg'
  | 'jjn'
  | 'stucki'
  | 'atkinson'
  | 'burkes'
  | 'sierra'
  | 'two-row-sierra'
  | 'sierra-lite'
  | 'stevenson-arce'
  | 'shiau-fan'
  | 'shiau-fan-2'
  | 'fan'
  | 'simple-2d'
  // Ordered (Bayer + patterns)
  | 'bayer-2'
  | 'bayer-4'
  | 'bayer-8'
  | 'bayer-16'
  | 'clustered-dot'
  | 'dispersed-dot'
  | 'checker'
  // Halftone screens
  | 'halftone-dot'
  | 'line-halftone'
  | 'cross-halftone'
  | 'ordered-halftone'
  | 'screen-halftone'
  | 'dot-matrix'
  // Stochastic
  | 'random'
  | 'blue-noise'
  | 'value-noise'
  | 'white-gauss'
  | 'pattern-noise'
  | 'grain'
  // Advanced / stylized
  | 'modulated-x'
  | 'modulated-y'
  | 'dot-diffusion'
  | 'arithmetic-xor'
  | 'hybrid'
  | 'edge-aware'
  | 'contour'

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

/** Pre-dither effect identifiers, in their default chain order. */
export type EffectId = 'blur' | 'sharpen' | 'edge' | 'glow' | 'noise' | 'posterize'

export const DEFAULT_FX_ORDER: readonly EffectId[] = [
  'blur',
  'sharpen',
  'edge',
  'glow',
  'noise',
  'posterize',
]

/** All user-tweakable dither parameters. Kept flat so it can be
 *  hashed, serialized as a preset and diffed cheaply. */
export interface DitherSettings {
  algorithm: AlgorithmId
  /** Internal processing width in pixels (aspect ratio preserved). */
  resolution: number
  /** -100 .. 100 */
  brightness: number
  /** -100 .. 100 */
  contrast: number
  /** Midtones. 0.2 .. 3, 1 = neutral. >1 brightens midtones. */
  gamma: number
  /** Quantization bias, -100 .. 100. Positive = darker result. */
  threshold: number
  /* ----- pre-dither effect chain (applied in this order, after the
     tone LUT, before dithering) ----- */
  /** #1 Blur, toggle + radius in processed pixels 0..10 (keyframable). */
  fxBlurOn: boolean
  preBlur: number
  /** #2 Sharpen (unsharp mask), toggle + strength 0..100. */
  fxSharpenOn: boolean
  fxSharpen: number
  /** #3 Edge boost (brightens Sobel edges), toggle + strength 0..100. */
  fxEdgeOn: boolean
  fxEdge: number
  /** #4 Glow (screen-blended blurred copy), toggle + strength 0..100. */
  fxGlowOn: boolean
  fxGlow: number
  /** #5 Noise (deterministic grain), toggle + strength 0..100. */
  fxNoiseOn: boolean
  fxNoise: number
  /** #6 Posterize, toggle + levels 2..16. */
  fxPosterizeOn: boolean
  fxPosterize: number
  /** Order the effect chain runs in (and is listed in the sidebar). */
  fxOrder: EffectId[]
  /** Halftone screen angle in degrees (screen-halftone only), 0..90. */
  screenAngle: number
  invert: boolean
  /** Serpentine scanning (error diffusion only). */
  serpentine: boolean
  /** Number of tonal levels for mono output, 2 .. 16. */
  greyLevels: number
  paletteMode: PaletteMode
  /** Color interpretation mode (current palette vs legacy RGB levels). */
  colorMapping: ColorMapping
  /** Fill transparent source pixels with `bgColor` before dithering
   *  (viewport + every export). Off = source alpha passes through. */
  bgFillOn: boolean
  bgColor: string
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
  /** Print resolution metadata for exports (PNG/JPEG/CMYK), 10..1200. */
  dpi: number
  /** Mono exports: make shadow-color pixels fully transparent
   *  (PNG stills, PNG sequences and SVG — formats with alpha). */
  exportTransparent: boolean
}

/** The subset of settings the worker pipeline needs.
 *  `resolution`, `pixelScale` and `dpi` are applied outside the worker. */
export type PipelineSettings = Omit<DitherSettings, 'resolution' | 'pixelScale' | 'dpi'>

export const DEFAULT_SETTINGS: DitherSettings = {
  algorithm: 'floyd-steinberg',
  resolution: 320,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  threshold: 0,
  fxBlurOn: false,
  preBlur: 0,
  fxSharpenOn: false,
  fxSharpen: 50,
  fxEdgeOn: false,
  fxEdge: 50,
  fxGlowOn: false,
  fxGlow: 50,
  fxNoiseOn: false,
  fxNoise: 30,
  fxPosterizeOn: false,
  fxPosterize: 6,
  fxOrder: [...DEFAULT_FX_ORDER],
  screenAngle: 45,
  invert: false,
  serpentine: true,
  greyLevels: 2,
  paletteMode: 'mono',
  colorMapping: 'current',
  bgFillOn: false,
  bgColor: '#071318',
  lightColor: '#e8f4f8',
  darkColor: '#071318',
  paletteSize: 8,
  paletteStyle: 'dominant',
  customPalette: ['#071318', '#1c3fae', '#46b3cc', '#4af17a', '#ffb02e', '#e8f4f8'],
  pixelScale: 1,
  dpi: 96,
  exportTransparent: true,
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
  // effect strengths (each applies while its effect toggle is on)
  | 'fxSharpen'
  | 'fxEdge'
  | 'fxGlow'
  | 'fxNoise'
  | 'fxPosterize'

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
