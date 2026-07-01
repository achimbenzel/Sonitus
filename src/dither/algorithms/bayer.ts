/* ============================================================
   Ordered (Bayer) threshold matrices.

   Built recursively: M(2n) = | 4M      4M + 2 |
                              | 4M + 3  4M + 1 |
   and normalized to (v + 0.5) / n², giving thresholds in (0, 1).
   ============================================================ */

const cache = new Map<number, Float32Array>()

/** Returns a normalized `size`×`size` Bayer matrix (row-major).
 *  `size` must be a power of two. */
export function getBayerMatrix(size: number): Float32Array {
  const cached = cache.get(size)
  if (cached) return cached

  let n = 2
  let m = new Float32Array([0, 2, 3, 1])
  while (n < size) {
    const next = new Float32Array(n * n * 4)
    const n2 = n * 2
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 4 * m[y * n + x]
        next[y * n2 + x] = v
        next[y * n2 + x + n] = v + 2
        next[(y + n) * n2 + x] = v + 3
        next[(y + n) * n2 + x + n] = v + 1
      }
    }
    m = next
    n = n2
  }

  const norm = new Float32Array(size * size)
  const total = size * size
  for (let i = 0; i < total; i++) norm[i] = (m[i] + 0.5) / total
  cache.set(size, norm)
  return norm
}
