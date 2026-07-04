/* ============================================================
   Dot diffusion (Knuth 1987): pixels are processed in the order
   given by an 8×8 class matrix; each pixel's quantization error is
   diffused only to its 8 neighbors with a HIGHER class number
   (orthogonal weight 2, diagonal weight 1). Combines the clustered
   look of ordered dithering with error-diffusion tone accuracy,
   and is parallel-friendly by construction.
   ============================================================ */

/** Knuth's 8×8 class matrix. */
const CLASS_MATRIX = new Uint8Array([
  34, 48, 40, 32, 29, 15, 23, 31,
  42, 58, 56, 53, 21, 5, 7, 10,
  50, 62, 61, 45, 13, 1, 2, 18,
  38, 46, 54, 37, 25, 17, 9, 26,
  28, 14, 22, 30, 35, 49, 41, 33,
  20, 4, 6, 11, 43, 59, 57, 52,
  12, 0, 3, 19, 51, 63, 60, 44,
  24, 16, 8, 27, 39, 47, 55, 36,
])

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [-1, -1, 1], [0, -1, 2], [1, -1, 1],
  [-1, 0, 2], [1, 0, 2],
  [-1, 1, 1], [0, 1, 2], [1, 1, 1],
]

/** Per-class offsets within the 8×8 tile (one cell per class). */
const CLASS_POS: Array<[number, number]> = (() => {
  const pos: Array<[number, number]> = new Array(64)
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) pos[CLASS_MATRIX[y * 8 + x]] = [x, y]
  return pos
})()

const classOf = (x: number, y: number): number => CLASS_MATRIX[(y & 7) * 8 + (x & 7)]

/**
 * Generic dot-diffusion driver over one or more channel planes.
 * `quantize(p)` reads the current channel values at pixel `p`,
 * writes its output wherever it likes, and returns the quantized
 * values so the error can be diffused per channel.
 */
export function dotDiffuse(
  chans: Float32Array[],
  w: number,
  h: number,
  quantize: (p: number) => ArrayLike<number>,
): void {
  const nChan = chans.length
  for (let k = 0; k < 64; k++) {
    const [ox, oy] = CLASS_POS[k]
    for (let by = oy; by < h; by += 8) {
      for (let bx = ox; bx < w; bx += 8) {
        const p = by * w + bx
        const q = quantize(p)
        // Collect eligible neighbors (higher class) and their weights.
        let totalW = 0
        for (const [dx, dy, wt] of NEIGHBORS) {
          const nx = bx + dx
          const ny = by + dy
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          if (classOf(nx, ny) > k) totalW += wt
        }
        if (totalW === 0) continue
        for (let c = 0; c < nChan; c++) {
          const err = chans[c][p] - q[c]
          if (err === 0) continue
          for (const [dx, dy, wt] of NEIGHBORS) {
            const nx = bx + dx
            const ny = by + dy
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
            if (classOf(nx, ny) > k) chans[c][ny * w + nx] += (err * wt) / totalW
          }
        }
      }
    }
  }
}
