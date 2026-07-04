/* ============================================================
   Stochastic threshold sources: hash-based white noise, tiling
   value noise, and a generated blue-noise texture.

   All are deterministic per (x, y) so a reprocessed frame is
   pixel-identical — this keeps the playback buffer cache valid
   and avoids flicker between identical frames.
   ============================================================ */

/** Deterministic per-pixel white noise in [0, 1). Integer hash with
 *  unsigned mixing — verified uniform across the full range. */
export function whiteNoise(x: number, y: number): number {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

/* ---------- Value noise (smooth, organic threshold field) ---------- */

const VN_SIZE = 64 // lattice period; tiles seamlessly
let vnLattice: Float32Array | null = null

function lattice(): Float32Array {
  if (!vnLattice) {
    vnLattice = new Float32Array(VN_SIZE * VN_SIZE)
    for (let y = 0; y < VN_SIZE; y++)
      for (let x = 0; x < VN_SIZE; x++) vnLattice[y * VN_SIZE + x] = whiteNoise(x, y)
  }
  return vnLattice
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function valueNoiseAt(fx: number, fy: number): number {
  const l = lattice()
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = smooth(fx - x0)
  const ty = smooth(fy - y0)
  const xa = ((x0 % VN_SIZE) + VN_SIZE) % VN_SIZE
  const xb = (xa + 1) % VN_SIZE
  const ya = ((y0 % VN_SIZE) + VN_SIZE) % VN_SIZE
  const yb = (ya + 1) % VN_SIZE
  const v00 = l[ya * VN_SIZE + xa]
  const v10 = l[ya * VN_SIZE + xb]
  const v01 = l[yb * VN_SIZE + xa]
  const v11 = l[yb * VN_SIZE + xb]
  const top = v00 + (v10 - v00) * tx
  const bot = v01 + (v11 - v01) * tx
  return top + (bot - top) * ty
}

/** Multi-octave value noise in [0, 1). Frequency tuned so grain is
 *  visible at typical processing resolutions. */
export function valueNoise(x: number, y: number): number {
  const v =
    valueNoiseAt(x * 0.35, y * 0.35) * 0.55 +
    valueNoiseAt(x * 0.9, y * 0.9) * 0.3 +
    whiteNoise(x, y) * 0.15
  return Math.min(0.999, Math.max(0, v))
}

/* ---------- Additional deterministic threshold patterns ---------- */

/** Gaussian ("true white noise") threshold via Box–Muller: densities
 *  cluster around mid-grey, giving softer, less salt-and-pepper grain
 *  than the uniform random threshold. */
export function gaussNoise(x: number, y: number): number {
  const u1 = Math.max(1e-6, whiteNoise(x, y))
  const u2 = whiteNoise(x + 40503, y + 20011)
  const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.min(0.999, Math.max(0.001, 0.5 + g * 0.16))
}

/** Interference/moiré pattern: two crossed sine fields with mutual
 *  phase modulation — a woven, fabric-like threshold texture. */
export function patternNoise(x: number, y: number): number {
  const v =
    0.5 +
    0.24 * Math.sin(x * 0.53 + 2.2 * Math.sin(y * 0.18)) +
    0.24 * Math.sin(y * 0.61 + 2.0 * Math.sin(x * 0.15))
  return Math.min(0.999, Math.max(0.001, v))
}

/** Film-grain threshold: clumpy low-frequency noise mixed with white
 *  noise — coarser clumps than value noise, no smooth gradients. */
export function grainNoise(x: number, y: number): number {
  const v = valueNoiseAt(x * 1.7, y * 1.7) * 0.55 + whiteNoise(x, y) * 0.45
  return Math.min(0.999, Math.max(0.001, v))
}

/** Dispersed-dot threshold via Interleaved Gradient Noise (Jimenez):
 *  a highly uniform, non-tiling dispersed pattern — visibly different
 *  from Bayer's rigid crosshatch. */
export function dispersedDot(x: number, y: number): number {
  const f = 0.06711056 * x + 0.00583715 * y
  const v = 52.9829189 * (f - Math.floor(f))
  return v - Math.floor(v)
}

/** Arithmetic (XOR) dither: the classic bitwise interference texture,
 *  with a secondary arithmetic sub-order for smoother tone steps. */
export function xorPattern(x: number, y: number): number {
  const major = (x ^ y) & 15
  const minor = (x * 5 + y * 11) & 15
  return (major * 16 + minor + 0.5) / 256
}

/* ---------- Blue noise (void-and-cluster) ---------- */

const BN_SIZE = 64
let blueNoiseTex: Float32Array | null = null

/** Generates a 64×64 blue-noise dither array with Ulichney's
 *  void-and-cluster method. The texture tiles seamlessly (the energy
 *  filter wraps toroidally). Generated once per worker and cached
 *  (~tens of ms), then indexed like a Bayer matrix. */
export function getBlueNoise(): Float32Array {
  if (blueNoiseTex) return blueNoiseTex

  const n = BN_SIZE * BN_SIZE
  const size = BN_SIZE
  const sigma = 1.9

  // Precompute the wrapped gaussian energy kernel.
  const kernel = new Float32Array(n)
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const wx = Math.min(dx, size - dx)
      const wy = Math.min(dy, size - dy)
      kernel[dy * size + dx] = Math.exp(-(wx * wx + wy * wy) / (2 * sigma * sigma))
    }
  }

  const binary = new Uint8Array(n)
  const energy = new Float32Array(n)

  const splat = (idx: number, sign: number) => {
    const px = idx % size
    const py = (idx / size) | 0
    for (let y = 0; y < size; y++) {
      const ky = ((y - py + size) % size) * size
      const row = y * size
      for (let x = 0; x < size; x++) {
        energy[row + x] += sign * kernel[ky + ((x - px + size) % size)]
      }
    }
  }

  // Find extreme energy among cells matching `state`.
  const findExtreme = (state: number, wantMax: boolean): number => {
    let best = -1
    let bestE = wantMax ? -Infinity : Infinity
    for (let i = 0; i < n; i++) {
      if (binary[i] !== state) continue
      const e = energy[i]
      if (wantMax ? e > bestE : e < bestE) {
        bestE = e
        best = i
      }
    }
    return best
  }

  // Seed with ~10% random minority points (deterministic hash).
  let ones = 0
  for (let i = 0; i < n; i++) {
    if (whiteNoise(i % size, (i / size) | 0) < 0.1) {
      binary[i] = 1
      splat(i, 1)
      ones++
    }
  }
  if (ones === 0) {
    binary[0] = 1
    splat(0, 1)
    ones = 1
  }

  // Phase 0: swap tightest cluster into largest void until stable.
  for (let iter = 0; iter < n; iter++) {
    const cluster = findExtreme(1, true)
    binary[cluster] = 0
    splat(cluster, -1)
    const voidCell = findExtreme(0, false)
    binary[voidCell] = 1
    splat(voidCell, 1)
    if (voidCell === cluster) break
  }

  const rank = new Int32Array(n)

  // Phase 1: remove minority points, ranking ones-1 .. 0.
  {
    const snap = binary.slice()
    const snapEnergy = energy.slice()
    for (let r = ones - 1; r >= 0; r--) {
      const cluster = findExtreme(1, true)
      binary[cluster] = 0
      splat(cluster, -1)
      rank[cluster] = r
    }
    binary.set(snap)
    energy.set(snapEnergy)
  }

  // Phase 2: insert into voids until half full, ranking ones .. n/2-1.
  let filled = ones
  while (filled < n / 2) {
    const voidCell = findExtreme(0, false)
    binary[voidCell] = 1
    splat(voidCell, 1)
    rank[voidCell] = filled++
  }

  // Phase 3: majority is now 1s; treat 0s as clusters of "holes" and
  // fill the tightest hole-cluster first. A hole cluster is where the
  // energy of 1s is LOWEST, so keep inserting at the minimum-energy 0.
  while (filled < n) {
    const cell = findExtreme(0, false)
    binary[cell] = 1
    splat(cell, 1)
    rank[cell] = filled++
  }

  const tex = new Float32Array(n)
  for (let i = 0; i < n; i++) tex[i] = (rank[i] + 0.5) / n
  blueNoiseTex = tex
  return tex
}

export const BLUE_NOISE_SIZE = BN_SIZE
