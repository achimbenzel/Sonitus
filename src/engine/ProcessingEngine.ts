/* ============================================================
   ProcessingEngine — the main-thread orchestrator.

   Responsibilities:
   - decode source frames (File/Blob → ImageBitmap) through an LRU
     so long sequences never hold every full-res frame in memory
   - downscale to the processing resolution (GPU drawImage, then a
     cheap small getImageData readback)
   - hand work to the worker pool with priorities
   - cache processed frames (byte-budgeted LRU) keyed by
     frameId + settings hash, which is what makes timeline
     buffering and scrubbing feel instant
   ============================================================ */

import type { DitherSettings, PipelineSettings, RawImage, SourceFrame } from '../types'
import { CancelledError, PRIORITY, WorkerPool } from '../workers/workerPool'

export { CancelledError, PRIORITY }

/* ---------- LRU caches ---------- */

class LruMap<V> {
  private map = new Map<string, V>()
  constructor(private maxEntries: number) {}

  get(key: string): V | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }

  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as string
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/** LRU keyed on estimated bitmap bytes so ~any resolution fits a
 *  predictable memory budget. Bitmaps are not close()d on eviction —
 *  they may still be on screen; GC reclaims them. */
class BitmapCache {
  private map = new Map<string, { bmp: ImageBitmap; bytes: number }>()
  private bytes = 0
  constructor(private maxBytes: number) {}

  get(key: string): ImageBitmap | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    this.map.delete(key)
    this.map.set(key, e)
    return e.bmp
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  set(key: string, bmp: ImageBitmap): void {
    const bytes = bmp.width * bmp.height * 4
    const prev = this.map.get(key)
    if (prev) {
      this.bytes -= prev.bytes
      this.map.delete(key)
    }
    this.map.set(key, { bmp, bytes })
    this.bytes += bytes
    while (this.bytes > this.maxBytes && this.map.size > 1) {
      const oldestKey = this.map.keys().next().value as string
      const oldest = this.map.get(oldestKey)!
      this.map.delete(oldestKey)
      this.bytes -= oldest.bytes
    }
  }

  clear(): void {
    this.map.clear()
    this.bytes = 0
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.map.size, bytes: this.bytes }
  }
}

/* ---------- Engine ---------- */

export class ProcessingEngine {
  private pool = new WorkerPool()
  private decoded = new LruMap<ImageBitmap>(20)
  private decodePending = new Map<string, Promise<ImageBitmap>>()
  private processed = new BitmapCache(256 * 1024 * 1024)
  private pending = new Map<string, Promise<ImageBitmap>>()
  private listeners = new Set<() => void>()
  private scratch: OffscreenCanvas | null = null

  /** Deterministic hash of every processing-relevant setting.
   *  pixelScale and dpi are excluded — they only affect the cheap
   *  display/export upscale and export metadata, not worker output. */
  settingsHash(s: DitherSettings): string {
    return [
      s.algorithm, s.resolution, s.brightness, s.contrast, s.gamma, s.threshold,
      s.invert ? 1 : 0, s.serpentine ? 1 : 0, s.greyLevels,
      s.paletteMode, s.colorMapping, s.lightColor, s.darkColor, s.paletteSize,
      s.resolvedPalette?.join(',') ?? '',
      s.screenAngle,
      s.revealAmount,
      s.revealDirection,
      s.revealSoftness,
      s.bgFillOn ? s.bgColor : 'off',
      // Pre-dither effect chain (order matters; strength only while enabled).
      s.fxOrder.join(','),
      s.fxBlurOn ? s.preBlur : 'off',
      s.fxSharpenOn ? s.fxSharpen : 'off',
      s.fxEdgeOn ? s.fxEdge : 'off',
      s.fxGlowOn ? s.fxGlow : 'off',
      s.fxNoiseOn ? s.fxNoise : 'off',
      s.fxPosterizeOn ? s.fxPosterize : 'off',
    ].join('|')
  }

  private key(frameId: string, hash: string): string {
    return `${frameId}::${hash}`
  }

  isCached(frame: SourceFrame, hash: string): boolean {
    return this.processed.has(this.key(frame.id, hash))
  }

  /** Subscribe to "a frame finished processing" (for buffer UI). */
  onProcessed(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  /** Decode a source frame at full resolution (LRU-cached). */
  decodeSource(frame: SourceFrame): Promise<ImageBitmap> {
    const cached = this.decoded.get(frame.id)
    if (cached) return Promise.resolve(cached)
    const inflight = this.decodePending.get(frame.id)
    if (inflight) return inflight
    const p = createImageBitmap(frame.source)
      .then((bmp) => {
        this.decoded.set(frame.id, bmp)
        return bmp
      })
      .finally(() => this.decodePending.delete(frame.id))
    this.decodePending.set(frame.id, p)
    return p
  }

  private downscale(bmp: ImageBitmap, resolution: number): RawImage {
    const pw = Math.max(1, Math.min(Math.round(resolution), bmp.width))
    const ph = Math.max(1, Math.round((pw * bmp.height) / bmp.width))
    if (!this.scratch) this.scratch = new OffscreenCanvas(pw, ph)
    const c = this.scratch
    c.width = pw
    c.height = ph
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bmp, 0, 0, pw, ph)
    return ctx.getImageData(0, 0, pw, ph) as unknown as RawImage
  }

  private pipelineSettings(s: DitherSettings): PipelineSettings {
    const { resolution: _r, pixelScale: _p, ...rest } = s
    return rest
  }

  /** Process a frame with the given settings. Deduped and cached.
   *  `tag` groups queued work for cancellation (defaults to the
   *  settings hash; keyframed timelines pass a generation id instead,
   *  since their per-frame hashes legitimately differ). */
  getProcessed(
    frame: SourceFrame,
    settings: DitherSettings,
    priority: number,
    tag?: string,
  ): Promise<ImageBitmap> {
    const hash = this.settingsHash(settings)
    const key = this.key(frame.id, hash)
    const cached = this.processed.get(key)
    if (cached) return Promise.resolve(cached)
    const inflight = this.pending.get(key)
    if (inflight) return inflight

    const p = (async () => {
      const src = await this.decodeSource(frame)
      const small = this.downscale(src, settings.resolution)
      const out = await this.pool.run(small, this.pipelineSettings(settings), priority, tag ?? hash)
      const bmp = await createImageBitmap(new ImageData(out.data, out.width, out.height))
      this.processed.set(key, bmp)
      this.emit()
      return bmp
    })().finally(() => this.pending.delete(key))
    this.pending.set(key, p)
    return p
  }

  /** Like getProcessed but returns raw pixels (for SVG export). */
  async getProcessedData(frame: SourceFrame, settings: DitherSettings): Promise<RawImage> {
    const src = await this.decodeSource(frame)
    const small = this.downscale(src, settings.resolution)
    return this.pool.run(
      small,
      this.pipelineSettings(settings),
      PRIORITY.EXPORT,
      this.settingsHash(settings),
    )
  }

  /** Drop queued buffer work from an older generation (stale settings
   *  or keyframes). */
  invalidatePending(currentTag: string): void {
    this.pool.cancelQueued((tag, priority) => priority === PRIORITY.BUFFER && tag !== currentTag)
  }

  /** Current size of the processed-frame cache (for the Settings UI). */
  cacheStats(): { entries: number; bytes: number } {
    return this.processed.stats()
  }

  /** Reset for a new project. */
  clearAll(): void {
    this.pool.cancelAll()
    this.processed.clear()
    this.decoded.clear()
  }
}
