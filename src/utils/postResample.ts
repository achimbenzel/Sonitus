/* ============================================================
   Post-dither resampling — the LAST step of the image pipeline.

   Runs after dithering and after the pixel-scale upscale: the
   crisp nearest-neighbor result is drawn first, then a softened
   pass (canvas blur, plus a contrast pull for "bleeding") is
   composited on top. Dimensions never change; only the edges of
   the enlarged dither pixels get rounded/softened. The blur
   radius is proportional to the on-canvas size of one dither
   pixel, so the viewport preview and every export look identical
   regardless of their actual pixel dimensions.
   ============================================================ */

import type { DitherSettings, ResamplingMethod } from '../types'

/** Blur radius per method, in fractions of one enlarged dither pixel. */
const RADIUS: Record<ResamplingMethod, number> = {
  nearest: 0,
  linear: 0.14,
  soft: 0.28,
  bleeding: 0.42,
}

export interface PostSoften {
  method: ResamplingMethod
}

/** The active post-soften config, or null when the pass is disabled
 *  (or would be a no-op). */
export function postSoftenOf(s: DitherSettings): PostSoften | null {
  if (!s.postResample || RADIUS[s.resampling] === 0) return null
  return { method: s.resampling }
}

/** CSS canvas filter for one enlarged-dither-pixel size of `blockPx`. */
function filterFor(method: ResamplingMethod, blockPx: number): string {
  const radius = Math.max(0.3, blockPx * RADIUS[method])
  // "Bleeding" pulls the blurred tones apart again, which rounds the
  // shapes into slightly swollen, ink-like blobs.
  return method === 'bleeding'
    ? `blur(${radius.toFixed(2)}px) contrast(1.55) saturate(1.05)`
    : `blur(${radius.toFixed(2)}px)`
}

/** Draw `source` into `ctx` at dx/dy/dw/dh with the softened look.
 *  `blockPx` is the drawn size of one dither pixel (dw / sourcePixelW).
 *  The crisp base is drawn first so blur never fades the border. */
export function drawSoftened(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  source: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  method: ResamplingMethod,
  blockPx: number,
): void {
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, dx, dy, dw, dh) // crisp base (keeps edges solid)
  ctx.filter = filterFor(method, blockPx)
  ctx.drawImage(source, dx, dy, dw, dh) // softened pass on top
  ctx.restore()
}

/** Apply the post pass to a whole canvas in place (used by exports:
 *  the canvas already holds the crisp upscaled frame). */
export function softenCanvas(
  canvas: OffscreenCanvas,
  method: ResamplingMethod,
  blockPx: number,
): void {
  const snapshot = new OffscreenCanvas(canvas.width, canvas.height)
  snapshot.getContext('2d')!.drawImage(canvas, 0, 0)
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.filter = filterFor(method, blockPx)
  ctx.drawImage(snapshot, 0, 0)
  ctx.restore()
}
