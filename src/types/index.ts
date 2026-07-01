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
  /** Pre-blur radius in processed pixels, 0 .. 10. */
  preBlur: number
  invert: boolean
  /** Serpentine scanning (error diffusion only). */
  serpentine: boolean
  /** Number of tonal levels for mono output, 2 .. 16. */
  greyLevels: number
  paletteMode: PaletteMode
  /** Mono palette: color used for highlights (bright pixels). */
  lightColor: string
  /** Mono palette: color used for shadows (dark pixels). */
  darkColor: string
  /** Image palette: number of colors extracted from the source, 2 .. 32. */
  paletteSize: number
  /** Output pixel scale multiplier (export size = resolution * scale). */
  pixelScale: number
}

/** The subset of settings the worker pipeline needs.
 *  `resolution` and `pixelScale` are applied outside the worker. */
export type PipelineSettings = Omit<DitherSettings, 'resolution' | 'pixelScale'>

export const DEFAULT_SETTINGS: DitherSettings = {
  algorithm: 'floyd-steinberg',
  resolution: 320,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  threshold: 0,
  preBlur: 0,
  invert: false,
  serpentine: true,
  greyLevels: 2,
  paletteMode: 'mono',
  lightColor: '#e8f4f8',
  darkColor: '#071318',
  paletteSize: 8,
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
