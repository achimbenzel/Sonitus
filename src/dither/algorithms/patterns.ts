/* ============================================================
   Generated ordered-dither threshold matrices beyond Bayer:
   clustered dots, halftone screens (dot / line / cross / diamond /
   rotated), checkerboard and dot-matrix looks.

   Every matrix is built from a value field over one tile and then
   RANK-NORMALIZED: thresholds are the sorted rank of each cell
   mapped to (0, 1), so tones are always evenly distributed no
   matter what shape the field has.
   ============================================================ */

import { whiteNoise } from './noise'

export interface PatternMatrix {
  size: number
  /** Row-major thresholds in (0, 1). */
  data: Float32Array
}

/** Map field values to evenly spaced thresholds by rank. Ties are
 *  broken with a deterministic per-cell jitter so equal field values
 *  do not all flip at once. */
function rankNormalize(values: Float32Array, size: number): PatternMatrix {
  const n = values.length
  const order = Array.from({ length: n }, (_, i) => i)
  const jittered = new Float32Array(n)
  for (let i = 0; i < n; i++) jittered[i] = values[i] + whiteNoise(i, 7919) * 1e-4
  order.sort((a, b) => jittered[a] - jittered[b])
  const data = new Float32Array(n)
  for (let r = 0; r < n; r++) data[order[r]] = (r + 0.5) / n
  return { size, data }
}

function buildField(size: number, field: (x: number, y: number) => number): PatternMatrix {
  const values = new Float32Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) values[y * size + x] = field(x, y)
  return rankNormalize(values, size)
}

/* Classic recursive 8×8 clustered-dot screen (two dot centers per
   tile at 45°) — the standard laser-printer halftone matrix. */
const CLUSTERED_DOT_8 = [
  24, 10, 12, 26, 35, 47, 49, 37,
  8, 0, 2, 14, 45, 59, 61, 51,
  22, 6, 4, 16, 43, 57, 63, 53,
  30, 20, 18, 28, 33, 41, 55, 39,
  34, 46, 48, 36, 25, 11, 13, 27,
  44, 58, 60, 50, 9, 1, 3, 15,
  42, 56, 62, 52, 23, 7, 5, 17,
  32, 40, 54, 38, 31, 21, 19, 29,
]

const cache = new Map<string, PatternMatrix>()

/** Threshold matrix for a pattern algorithm. `angle` only affects
 *  'screen-halftone' (degrees). */
export function getPatternMatrix(id: string, angle = 45): PatternMatrix {
  const key = id === 'screen-halftone' ? `${id}:${Math.round(angle)}` : id
  const hit = cache.get(key)
  if (hit) return hit

  let m: PatternMatrix
  switch (id) {
    case 'clustered-dot': {
      const data = new Float32Array(64)
      for (let i = 0; i < 64; i++) data[i] = (CLUSTERED_DOT_8[i] + 0.5) / 64
      m = { size: 8, data }
      break
    }
    case 'halftone-dot':
      // Round dots growing from the cell center.
      m = buildField(8, (x, y) => {
        const dx = x - 3.5
        const dy = y - 3.5
        return dx * dx + dy * dy
      })
      break
    case 'line-halftone':
      // Horizontal line screen: lines thicken from the row center.
      m = buildField(8, (_x, y) => Math.abs(y - 3.5))
      break
    case 'cross-halftone':
      // Grid/cross screen: ink follows the nearest cell axis.
      m = buildField(8, (x, y) => Math.min(Math.abs(x - 3.5), Math.abs(y - 3.5)))
      break
    case 'ordered-halftone':
      // Diamond dots (Manhattan distance) — a coarser print-like screen.
      m = buildField(12, (x, y) => Math.abs(x - 5.5) + Math.abs(y - 5.5))
      break
    case 'screen-halftone': {
      // Rotated dot screen: the classic print screen at a user angle.
      // Sampled over a 64-tile and rank-normalized; the tile repeat is
      // an approximation for angles whose screen is not grid-periodic.
      const rad = (angle * Math.PI) / 180
      const cs = Math.cos(rad)
      const sn = Math.sin(rad)
      const cell = 8
      m = buildField(64, (x, y) => {
        const u = x * cs + y * sn
        const v = -x * sn + y * cs
        const du = ((u % cell) + cell) % cell - cell / 2
        const dv = ((v % cell) + cell) % cell - cell / 2
        return du * du + dv * dv
      })
      break
    }
    case 'checker': {
      // Coarse 2×2-block checkerboard with Bayer micro-order inside,
      // so midtones flip block by block.
      const bayer2 = [0, 2, 3, 1]
      m = buildField(4, (x, y) => {
        const block = ((x >> 1) + (y >> 1)) & 1
        return block * 8 + bayer2[(y & 1) * 2 + (x & 1)]
      })
      break
    }
    case 'dot-matrix': {
      // LED/dot-matrix look: round dots with an always-dark gap grid.
      // Dot cells get evenly spread thresholds in (0, 0.85); the gap
      // grid is pinned near 1 so it only lights up for near-white.
      const size = 6
      const inside: number[] = []
      const dist = new Float32Array(size * size)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x - 2.5
          const dy = y - 2.5
          const i = y * size + x
          dist[i] = Math.sqrt(dx * dx + dy * dy)
          if (dist[i] <= 2.05) inside.push(i)
        }
      }
      inside.sort((a, b) => dist[a] - dist[b])
      const data = new Float32Array(size * size).fill(0.97)
      inside.forEach((cell, r) => {
        data[cell] = ((r + 0.5) / inside.length) * 0.85
      })
      m = { size, data }
      break
    }
    default:
      throw new Error(`Unknown pattern matrix: ${id}`)
  }
  cache.set(key, m)
  return m
}
