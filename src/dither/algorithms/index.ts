/* ============================================================
   Algorithm registry. Adding a new algorithm means:
     1. add its id to AlgorithmId in src/types
     2. register it here (and add a kernel / matrix / threshold fn)
   The pipeline and the UI both read from this table. `group` is a
   pure UI concern (section headers in the algorithm dropdown);
   `kind` decides which pipeline path runs.
   ============================================================ */

import type { AlgorithmId } from '../../types'

export type AlgorithmKind =
  | 'error-diffusion' // kernel-based scanline diffusion
  | 'ordered' // tiled threshold matrix (Bayer or generated pattern)
  | 'stochastic' // per-pixel threshold function
  | 'dot-diffusion' // Knuth class-order diffusion

export interface AlgorithmDef {
  id: AlgorithmId
  label: string
  kind: AlgorithmKind
  /** Dropdown section header. */
  group: string
  /** For ordered algorithms backed by a Bayer matrix. */
  bayerSize?: number
  /** For ordered algorithms backed by a generated pattern matrix. */
  pattern?: string
}

const ED = 'Error diffusion'
const OD = 'Ordered'
const HT = 'Halftone & pattern'
const NO = 'Noise'
const AV = 'Advanced'

export const ALGORITHMS: AlgorithmDef[] = [
  // --- error diffusion ---
  { id: 'floyd-steinberg', label: 'Floyd–Steinberg', kind: 'error-diffusion', group: ED },
  { id: 'false-floyd-steinberg', label: 'False Floyd–Steinberg', kind: 'error-diffusion', group: ED },
  { id: 'jjn', label: 'Jarvis–Judice–Ninke', kind: 'error-diffusion', group: ED },
  { id: 'stucki', label: 'Stucki', kind: 'error-diffusion', group: ED },
  { id: 'atkinson', label: 'Atkinson', kind: 'error-diffusion', group: ED },
  { id: 'burkes', label: 'Burkes', kind: 'error-diffusion', group: ED },
  { id: 'sierra', label: 'Sierra', kind: 'error-diffusion', group: ED },
  { id: 'two-row-sierra', label: 'Two-Row Sierra', kind: 'error-diffusion', group: ED },
  { id: 'sierra-lite', label: 'Sierra Lite', kind: 'error-diffusion', group: ED },
  { id: 'fan', label: 'Fan', kind: 'error-diffusion', group: ED },
  { id: 'shiau-fan', label: 'Shiau–Fan', kind: 'error-diffusion', group: ED },
  { id: 'shiau-fan-2', label: 'Shiau–Fan 2', kind: 'error-diffusion', group: ED },
  { id: 'stevenson-arce', label: 'Stevenson–Arce', kind: 'error-diffusion', group: ED },
  { id: 'simple-2d', label: 'Simple 2D Diffusion', kind: 'error-diffusion', group: ED },
  // --- ordered ---
  { id: 'bayer-2', label: 'Bayer 2×2', kind: 'ordered', group: OD, bayerSize: 2 },
  { id: 'bayer-4', label: 'Bayer 4×4', kind: 'ordered', group: OD, bayerSize: 4 },
  { id: 'bayer-8', label: 'Bayer 8×8', kind: 'ordered', group: OD, bayerSize: 8 },
  { id: 'bayer-16', label: 'Bayer 16×16', kind: 'ordered', group: OD, bayerSize: 16 },
  { id: 'clustered-dot', label: 'Clustered Dot', kind: 'ordered', group: OD, pattern: 'clustered-dot' },
  { id: 'dispersed-dot', label: 'Dispersed Dot', kind: 'stochastic', group: OD },
  { id: 'checker', label: 'Checker Threshold', kind: 'ordered', group: OD, pattern: 'checker' },
  // --- halftone screens ---
  { id: 'halftone-dot', label: 'Halftone', kind: 'ordered', group: HT, pattern: 'halftone-dot' },
  { id: 'line-halftone', label: 'Line Halftone', kind: 'ordered', group: HT, pattern: 'line-halftone' },
  { id: 'cross-halftone', label: 'Cross Halftone', kind: 'ordered', group: HT, pattern: 'cross-halftone' },
  { id: 'ordered-halftone', label: 'Ordered Halftone', kind: 'ordered', group: HT, pattern: 'ordered-halftone' },
  { id: 'screen-halftone', label: 'Screen Angle Halftone', kind: 'ordered', group: HT, pattern: 'screen-halftone' },
  { id: 'dot-matrix', label: 'Dot Matrix', kind: 'ordered', group: HT, pattern: 'dot-matrix' },
  // --- noise ---
  { id: 'random', label: 'Random Threshold', kind: 'stochastic', group: NO },
  { id: 'white-gauss', label: 'White Noise (Gaussian)', kind: 'stochastic', group: NO },
  { id: 'blue-noise', label: 'Blue Noise', kind: 'stochastic', group: NO },
  { id: 'value-noise', label: 'Value Noise', kind: 'stochastic', group: NO },
  { id: 'pattern-noise', label: 'Pattern Noise', kind: 'stochastic', group: NO },
  { id: 'grain', label: 'Grain Threshold', kind: 'stochastic', group: NO },
  // --- advanced / stylized ---
  { id: 'modulated-x', label: 'Modulated Diffusion X', kind: 'error-diffusion', group: AV },
  { id: 'modulated-y', label: 'Modulated Diffusion Y', kind: 'error-diffusion', group: AV },
  { id: 'dot-diffusion', label: 'Dot Diffusion (Knuth)', kind: 'dot-diffusion', group: AV },
  { id: 'arithmetic-xor', label: 'Arithmetic Dither (XOR)', kind: 'stochastic', group: AV },
  { id: 'hybrid', label: 'Hybrid Dither', kind: 'error-diffusion', group: AV },
  { id: 'edge-aware', label: 'Edge-Aware Dither', kind: 'error-diffusion', group: AV },
  { id: 'contour', label: 'Contour Dither', kind: 'error-diffusion', group: AV },
]

export function getAlgorithm(id: AlgorithmId): AlgorithmDef {
  const def = ALGORITHMS.find((a) => a.id === id)
  if (!def) throw new Error(`Unknown algorithm: ${id}`)
  return def
}

export function isErrorDiffusion(id: AlgorithmId): boolean {
  const kind = getAlgorithm(id).kind
  return kind === 'error-diffusion' || kind === 'dot-diffusion'
}
