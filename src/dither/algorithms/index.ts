/* ============================================================
   Algorithm registry. Adding a new algorithm means:
     1. add its id to AlgorithmId in src/types
     2. register it here (and add a kernel / threshold source)
   The pipeline and the UI both read from this table.
   ============================================================ */

import type { AlgorithmId } from '../../types'

export type AlgorithmKind = 'error-diffusion' | 'ordered' | 'stochastic'

export interface AlgorithmDef {
  id: AlgorithmId
  label: string
  kind: AlgorithmKind
  /** For ordered algorithms: Bayer matrix size. */
  bayerSize?: number
}

export const ALGORITHMS: AlgorithmDef[] = [
  { id: 'floyd-steinberg', label: 'Floyd–Steinberg', kind: 'error-diffusion' },
  { id: 'jjn', label: 'Jarvis–Judice–Ninke', kind: 'error-diffusion' },
  { id: 'stucki', label: 'Stucki', kind: 'error-diffusion' },
  { id: 'atkinson', label: 'Atkinson', kind: 'error-diffusion' },
  { id: 'burkes', label: 'Burkes', kind: 'error-diffusion' },
  { id: 'sierra', label: 'Sierra', kind: 'error-diffusion' },
  { id: 'two-row-sierra', label: 'Two-Row Sierra', kind: 'error-diffusion' },
  { id: 'sierra-lite', label: 'Sierra Lite', kind: 'error-diffusion' },
  { id: 'bayer-2', label: 'Bayer 2×2', kind: 'ordered', bayerSize: 2 },
  { id: 'bayer-4', label: 'Bayer 4×4', kind: 'ordered', bayerSize: 4 },
  { id: 'bayer-8', label: 'Bayer 8×8', kind: 'ordered', bayerSize: 8 },
  { id: 'bayer-16', label: 'Bayer 16×16', kind: 'ordered', bayerSize: 16 },
  { id: 'random', label: 'Random Threshold', kind: 'stochastic' },
  { id: 'blue-noise', label: 'Blue Noise', kind: 'stochastic' },
  { id: 'value-noise', label: 'Value Noise', kind: 'stochastic' },
]

export function getAlgorithm(id: AlgorithmId): AlgorithmDef {
  const def = ALGORITHMS.find((a) => a.id === id)
  if (!def) throw new Error(`Unknown algorithm: ${id}`)
  return def
}

export function isErrorDiffusion(id: AlgorithmId): boolean {
  return getAlgorithm(id).kind === 'error-diffusion'
}
