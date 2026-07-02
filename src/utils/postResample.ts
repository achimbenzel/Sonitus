/* ============================================================
   Post-dither resampling — the LAST step of the image pipeline.

   Runs after dithering and after the pixel-scale upscale. The goal
   is the classic halftone/"gooey" look: blur the enlarged dither
   pixels so neighbouring shapes flow together, then HARD-requantize
   every pixel back to the exact palette of the crisp result. That
   rounds corners and merges dots into smooth contours while keeping
   edges razor sharp — rounded but not blurry, and the output stays
   palette-pure. Dimensions never change.

   Methods only differ in reach:
     linear   – subtle corner rounding
     soft     – full halftone rounding (reference look)
     bleeding – wider reach + light bias, dots swell like ink
   ============================================================ */

import type { DitherSettings, ResamplingMethod } from '../types'

/** Blur reach per method, in fractions of one enlarged dither pixel. */
const RADIUS: Record<ResamplingMethod, number> = {
  nearest: 0,
  linear: 0.22,
  soft: 0.42,
  bleeding: 0.6,
}

/** Brightness bias before requantizing — makes light shapes swell. */
const LIGHT_BIAS: Record<ResamplingMethod, number> = {
  nearest: 0,
  linear: 0,
  soft: 0,
  bleeding: 14,
}

/** Above this pixel count the requantize pass falls back to a plain
 *  blur (avoids huge ImageData readbacks on extreme output sizes). */
const MAX_REQUANTIZE_PIXELS = 24_000_000

export interface PostSoften {
  method: ResamplingMethod
}

/** The active post-soften config, or null when the pass is disabled
 *  (or would be a no-op). */
export function postSoftenOf(s: DitherSettings): PostSoften | null {
  if (!s.postResample || RADIUS[s.resampling] === 0) return null
  return { method: s.resampling }
}

/** Distinct colors of the crisp dithered result (it is palette-pure
 *  by construction). Returns null if the image is unexpectedly rich —
 *  then requantizing would be wrong and we fall back to plain blur. */
function collectPalette(data: Uint8ClampedArray): number[] | null {
  const seen = new Set<number>()
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue
    seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
    if (seen.size > 256) return null
  }
  return seen.size > 0 ? [...seen] : null
}

/** Apply the post pass to a canvas in place. The canvas holds the
 *  crisp upscaled frame; `blockPx` is the size of one enlarged dither
 *  pixel on this canvas (i.e. the pixel-scale factor). */
export function softenCanvas(
  canvas: OffscreenCanvas,
  method: ResamplingMethod,
  blockPx: number,
): void {
  const w = canvas.width
  const h = canvas.height
  const radius = Math.max(0.4, blockPx * RADIUS[method])
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!

  // Blur pass (GPU) — lets neighbouring dither shapes flow together.
  const tmp = new OffscreenCanvas(w, h)
  const tctx = tmp.getContext('2d', { willReadFrequently: true })!
  tctx.filter = `blur(${radius.toFixed(2)}px)`
  tctx.drawImage(canvas, 0, 0)

  if (w * h > MAX_REQUANTIZE_PIXELS) {
    // Too large for a pixel pass — keep at least the softened look.
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(tmp, 0, 0)
    return
  }

  const crisp = ctx.getImageData(0, 0, w, h)
  const palette = collectPalette(crisp.data)
  const blurred = tctx.getImageData(0, 0, w, h)
  if (!palette) {
    ctx.putImageData(blurred, 0, 0)
    return
  }

  // Hard requantize the blurred image back to the crisp palette:
  // rounded contours with razor-sharp edges (blur + threshold,
  // generalized to any palette). Alpha is kept from the crisp image.
  const pr = new Uint8Array(palette.length)
  const pg = new Uint8Array(palette.length)
  const pb = new Uint8Array(palette.length)
  palette.forEach((c, i) => {
    pr[i] = (c >> 16) & 255
    pg[i] = (c >> 8) & 255
    pb[i] = c & 255
  })
  const cache = new Int16Array(32768).fill(-1)
  const bias = LIGHT_BIAS[method]
  const src = blurred.data
  const dst = crisp.data
  for (let i = 0; i < dst.length; i += 4) {
    const r = Math.min(255, src[i] + bias)
    const g = Math.min(255, src[i + 1] + bias)
    const b = Math.min(255, src[i + 2] + bias)
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    let idx = cache[key]
    if (idx < 0) {
      let bestD = Infinity
      idx = 0
      for (let p = 0; p < palette.length; p++) {
        const dr = r - pr[p]
        const dg = g - pg[p]
        const db = b - pb[p]
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) {
          bestD = d
          idx = p
        }
      }
      cache[key] = idx
    }
    dst[i] = pr[idx]
    dst[i + 1] = pg[idx]
    dst[i + 2] = pb[idx]
    // dst alpha stays the crisp alpha
  }
  ctx.putImageData(crisp, 0, 0)
}

/** Build the softened display bitmap at output resolution
 *  (processed × pixelScale) — used by the viewport preview so it
 *  matches the exports exactly. */
export async function compositeSoftened(
  source: ImageBitmap,
  pixelScale: number,
  method: ResamplingMethod,
): Promise<ImageBitmap> {
  const s = Math.max(1, Math.round(pixelScale))
  const c = new OffscreenCanvas(source.width * s, source.height * s)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, c.width, c.height)
  softenCanvas(c, method, s)
  return createImageBitmap(c)
}
