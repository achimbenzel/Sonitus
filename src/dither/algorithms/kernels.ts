/* ============================================================
   Error diffusion kernels.

   Each tap is [dx, dy, weight]; the propagated error for a tap is
   err * weight / div. dx is mirrored automatically when scanning
   right-to-left in serpentine mode.
   ============================================================ */

export interface DiffusionKernel {
  div: number
  taps: ReadonlyArray<readonly [number, number, number]>
}

export const DIFFUSION_KERNELS: Record<string, DiffusionKernel> = {
  'floyd-steinberg': {
    div: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3],
      [0, 1, 5],
      [1, 1, 1],
    ],
  },
  jjn: {
    div: 48,
    taps: [
      [1, 0, 7], [2, 0, 5],
      [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3],
      [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1],
    ],
  },
  stucki: {
    div: 42,
    taps: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
      [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1],
    ],
  },
  // Atkinson intentionally diffuses only 6/8 of the error, which
  // lifts highlights / crushes shadows — that is its signature look.
  atkinson: {
    div: 8,
    taps: [
      [1, 0, 1], [2, 0, 1],
      [-1, 1, 1], [0, 1, 1], [1, 1, 1],
      [0, 2, 1],
    ],
  },
  burkes: {
    div: 32,
    taps: [
      [1, 0, 8], [2, 0, 4],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2],
    ],
  },
  sierra: {
    div: 32,
    taps: [
      [1, 0, 5], [2, 0, 3],
      [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2],
      [-1, 2, 2], [0, 2, 3], [1, 2, 2],
    ],
  },
  'two-row-sierra': {
    div: 16,
    taps: [
      [1, 0, 4], [2, 0, 3],
      [-2, 1, 1], [-1, 1, 2], [0, 1, 3], [1, 1, 2], [2, 1, 1],
    ],
  },
  'sierra-lite': {
    div: 4,
    taps: [
      [1, 0, 2],
      [-1, 1, 1], [0, 1, 1],
    ],
  },
  // "False" Floyd–Steinberg: the simplified 3-tap variant from the
  // original paper's discussion — much streakier, its own look.
  'false-floyd-steinberg': {
    div: 8,
    taps: [
      [1, 0, 3],
      [0, 1, 3], [1, 1, 2],
    ],
  },
  // Stevenson–Arce: wide sparse kernel designed for hexagonal grids,
  // used here on the square grid — very smooth, soft gradients.
  'stevenson-arce': {
    div: 200,
    taps: [
      [2, 0, 32],
      [-3, 1, 12], [-1, 1, 26], [1, 1, 30], [3, 1, 16],
      [-2, 2, 12], [0, 2, 26], [2, 2, 12],
      [-3, 3, 5], [-1, 3, 12], [1, 3, 12], [3, 3, 5],
    ],
  },
  // Shiau–Fan: Floyd–Steinberg variants with a longer backward reach
  // on the next row, designed to suppress "worm" artifacts.
  'shiau-fan': {
    div: 8,
    taps: [
      [1, 0, 4],
      [-2, 1, 1], [-1, 1, 1], [0, 1, 2],
    ],
  },
  'shiau-fan-2': {
    div: 16,
    taps: [
      [1, 0, 8],
      [-3, 1, 1], [-2, 1, 1], [-1, 1, 2], [0, 1, 4],
    ],
  },
  // Fan: another Floyd–Steinberg refinement (shifted weights).
  fan: {
    div: 16,
    taps: [
      [1, 0, 7],
      [-2, 1, 1], [-1, 1, 3], [0, 1, 5],
    ],
  },
  // Minimal two-tap diffusion: half right, half down. Strong diagonal
  // texture — the simplest possible 2D error diffusion.
  'simple-2d': {
    div: 2,
    taps: [
      [1, 0, 1],
      [0, 1, 1],
    ],
  },
  // Advanced variants reuse the Floyd–Steinberg taps; their character
  // comes from error/threshold modulation applied in the pipeline.
  'modulated-x': {
    div: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3], [0, 1, 5], [1, 1, 1],
    ],
  },
  'modulated-y': {
    div: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3], [0, 1, 5], [1, 1, 1],
    ],
  },
  hybrid: {
    div: 32, // half-strength diffusion; a Bayer bias supplies the rest
    taps: [
      [1, 0, 7],
      [-1, 1, 3], [0, 1, 5], [1, 1, 1],
    ],
  },
  'edge-aware': {
    div: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3], [0, 1, 5], [1, 1, 1],
    ],
  },
  contour: {
    div: 16,
    taps: [
      [1, 0, 7],
      [-1, 1, 3], [0, 1, 5], [1, 1, 1],
    ],
  },
}
