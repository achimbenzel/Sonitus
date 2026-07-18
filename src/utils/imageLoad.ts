/* ============================================================
   Import helpers: single images, sorted image sequences and
   MP4 frame extraction (seek-based, no server, Chrome-friendly).
   ============================================================ */

import type { SourceFrame } from '../types'

const THUMB_WIDTH = 96
/** Hard cap so a long video cannot exhaust memory. */
export const MAX_VIDEO_FRAMES = 600
/** Extracted video frames are stored at most this wide. */
const MAX_VIDEO_WIDTH = 1920

let frameCounter = 0
const nextFrameId = () => `frame-${++frameCounter}`

export function naturalSortFiles(files: File[]): File[] {
  return [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
  )
}

function makeThumb(source: CanvasImageSource, sw: number, sh: number, canvas: HTMLCanvasElement): string {
  const tw = THUMB_WIDTH
  const th = Math.max(1, Math.round((tw * sh) / sw))
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0, tw, th)
  return canvas.toDataURL('image/jpeg', 0.6)
}

/** Build frames from image files (single image or sorted sequence).
 *  Each file is decoded once for dimensions + thumbnail, then the
 *  bitmap is released; pixels are re-decoded on demand later. */
export async function buildImageFrames(
  files: File[],
  onProgress: (v: number) => void,
): Promise<SourceFrame[]> {
  const sorted = naturalSortFiles(files)
  const thumbCanvas = document.createElement('canvas')
  const frames: SourceFrame[] = []
  for (let i = 0; i < sorted.length; i++) {
    const file = sorted[i]
    let bmp: ImageBitmap
    try {
      bmp = await createImageBitmap(file)
    } catch {
      throw new Error(`Could not decode "${file.name}" — is it a valid PNG/JPG?`)
    }
    frames.push({
      id: nextFrameId(),
      index: i,
      name: file.name,
      width: bmp.width,
      height: bmp.height,
      source: file,
      thumb: makeThumb(bmp, bmp.width, bmp.height, thumbCanvas),
    })
    bmp.close()
    onProgress((i + 1) / sorted.length)
  }
  return frames
}

/* ---------- Animated GIF / WebP (ImageDecoder / WebCodecs) ---------- */

interface ImageDecoderFrame {
  image: VideoFrame
}
interface ImageDecoderTrack {
  frameCount: number
}
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: ImageDecoderTrack | null }
  completed: Promise<void>
  decode(options: { frameIndex: number }): Promise<ImageDecoderFrame>
  close(): void
}
interface ImageDecoderCtor {
  new (init: { data: ArrayBuffer; type: string }): ImageDecoderLike
  isTypeSupported(type: string): Promise<boolean>
}

function imageDecoderCtor(): ImageDecoderCtor | null {
  return (globalThis as { ImageDecoder?: ImageDecoderCtor }).ImageDecoder ?? null
}

/**
 * Decodes an animated GIF/WebP into timeline frames with the clip's
 * own frame rate (from per-frame durations). Returns null when the
 * file is a single still frame or the ImageDecoder API is missing —
 * callers then fall back to the plain image path.
 */
export async function decodeAnimatedImage(
  file: File,
  onProgress: (v: number) => void,
): Promise<VideoImportResult | null> {
  const Ctor = imageDecoderCtor()
  if (!Ctor) return null
  const type = file.type || (/\.gif$/i.test(file.name) ? 'image/gif' : 'image/webp')
  if (!(await Ctor.isTypeSupported(type).catch(() => false))) return null

  const decoder = new Ctor({ data: await file.arrayBuffer(), type })
  try {
    await decoder.tracks.ready
    // Frame counts can grow while parsing finishes — wait for all data.
    await decoder.completed.catch(() => undefined)
    const frameCount = decoder.tracks.selectedTrack?.frameCount ?? 1
    if (frameCount <= 1) return null

    const total = Math.min(MAX_VIDEO_FRAMES, frameCount)
    const canvas = document.createElement('canvas')
    const thumbCanvas = document.createElement('canvas')
    const frames: SourceFrame[] = []
    let totalUs = 0
    for (let i = 0; i < total; i++) {
      const { image } = await decoder.decode({ frameIndex: i })
      if (i === 0) {
        canvas.width = image.displayWidth
        canvas.height = image.displayHeight
      }
      // GIFs without an explicit delay conventionally play at 10 fps.
      totalUs += image.duration || 100_000
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0)
      image.close()
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Frame encode failed'))), 'image/png'),
      )
      frames.push({
        id: nextFrameId(),
        index: i,
        name: `frame_${String(i + 1).padStart(4, '0')}`,
        width: canvas.width,
        height: canvas.height,
        source: blob,
        thumb: makeThumb(canvas, canvas.width, canvas.height, thumbCanvas),
      })
      onProgress((i + 1) / total)
    }
    const measured = totalUs > 0 ? (frames.length * 1e6) / totalUs : NaN
    // GIF frame delays only have centisecond precision: a 30fps clip is
    // stored with 3cs delays and measures as 33.3fps. The wider snap
    // window maps those back onto the real rate (33.3 → 30).
    const fps = normalizeFps(measured, 0.15)
    return {
      frames,
      fps: fps ?? FALLBACK_VIDEO_FPS,
      fpsDetected: fps !== null,
    }
  } finally {
    decoder.close()
  }
}

function once(target: EventTarget, event: string, errorEvent = 'error'): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = () => {
      target.removeEventListener(errorEvent, fail)
      resolve()
    }
    const fail = () => {
      target.removeEventListener(event, ok)
      reject(new Error(`Video ${errorEvent} while waiting for ${event}`))
    }
    target.addEventListener(event, ok, { once: true })
    target.addEventListener(errorEvent, fail, { once: true })
  })
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      video.removeEventListener('seeked', ok)
      // Some encoders report a duration slightly past the last frame;
      // resolve anyway and let drawImage use the last decoded frame.
      resolve()
    }, 3000)
    const ok = () => {
      window.clearTimeout(timeout)
      resolve()
    }
    video.addEventListener('seeked', ok, { once: true })
    try {
      video.currentTime = t
    } catch (err) {
      window.clearTimeout(timeout)
      video.removeEventListener('seeked', ok)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** Common video frame rates the measured rate snaps to (23.976 → 24,
 *  29.97 → 30 etc.); the timeline works on whole frames per second. */
const COMMON_FPS = [12, 15, 24, 25, 30, 48, 50, 60]

export const FALLBACK_VIDEO_FPS = 12

/** Snap a measured rate to the nearest common one when plausible and
 *  clamp to the timeline's 1–60 range. `tolerance` is the relative
 *  snap distance; GIF delays are quantized to whole centiseconds
 *  (30fps is stored as 3cs = 33.3fps), so animated images need a
 *  wider window than the default. */
function normalizeFps(measured: number, tolerance = 0.08): number | null {
  if (!Number.isFinite(measured) || measured <= 0) return null
  const nearest = COMMON_FPS.reduce((p, c) =>
    Math.abs(c - measured) < Math.abs(p - measured) ? c : p,
  )
  const fps = Math.abs(nearest - measured) / measured <= tolerance ? nearest : Math.round(measured)
  return Math.min(60, Math.max(1, fps))
}

/* ---------- exact MP4 frame rate (container parsing) ----------
   The moov/trak/mdia boxes carry the authoritative timing: mdhd has
   the track timescale and the stts (time-to-sample) box the duration
   of every frame. fps = timescale * samples / totalSampleTime.     */

function boxType(view: DataView, off: number): string {
  return String.fromCharCode(
    view.getUint8(off), view.getUint8(off + 1), view.getUint8(off + 2), view.getUint8(off + 3),
  )
}

interface BoxRange {
  type: string
  start: number
  end: number
}

/** Iterate the child boxes inside [start, end) of a buffer. */
function* childBoxes(view: DataView, start: number, end: number): Generator<BoxRange> {
  let off = start
  while (off + 8 <= end) {
    let size = view.getUint32(off)
    const type = boxType(view, off + 4)
    let header = 8
    if (size === 1) {
      if (off + 16 > end) return
      size = Number(view.getBigUint64(off + 8))
      header = 16
    } else if (size === 0) {
      size = end - off
    }
    if (size < header || off + size > end) return
    yield { type, start: off + header, end: off + size }
    off += size
  }
}

function findBox(view: DataView, start: number, end: number, path: string[]): BoxRange | null {
  if (path.length === 0) return null
  for (const box of childBoxes(view, start, end)) {
    if (box.type !== path[0]) continue
    if (path.length === 1) return box
    const inner = findBox(view, box.start, box.end, path.slice(1))
    if (inner) return inner
  }
  return null
}

/** Average frame rate of the (first) video track from an MP4/MOV
 *  moov box, or null (not ISO-BMFF, fragmented file, parse failure).
 *  Exported for unit tests. */
export async function mp4Fps(file: File): Promise<number | null> {
  try {
    // Walk the top-level boxes with small slice reads (moov may sit
    // after mdat, and mdat can be huge — never read it).
    let off = 0
    let moov: DataView | null = null
    while (off + 8 <= file.size) {
      const head = new DataView(await file.slice(off, Math.min(off + 16, file.size)).arrayBuffer())
      if (head.byteLength < 8) return null
      let size = head.getUint32(0)
      const type = boxType(head, 4)
      let header = 8
      if (size === 1) {
        if (head.byteLength < 16) return null
        size = Number(head.getBigUint64(8))
        header = 16
      } else if (size === 0) {
        size = file.size - off
      }
      if (size < header) return null
      if (type === 'moov') {
        // moov is small (index data only) — safe to load fully.
        moov = new DataView(await file.slice(off + header, off + size).arrayBuffer())
        break
      }
      off += size
    }
    if (!moov) return null

    for (const trak of childBoxes(moov, 0, moov.byteLength)) {
      if (trak.type !== 'trak') continue
      const mdia = findBox(moov, trak.start, trak.end, ['mdia'])
      if (!mdia) continue
      const hdlr = findBox(moov, mdia.start, mdia.end, ['hdlr'])
      if (!hdlr || boxType(moov, hdlr.start + 8) !== 'vide') continue
      const mdhd = findBox(moov, mdia.start, mdia.end, ['mdhd'])
      const stts = findBox(moov, mdia.start, mdia.end, ['minf', 'stbl', 'stts'])
      if (!mdhd || !stts) continue
      const version = moov.getUint8(mdhd.start)
      const timescale = moov.getUint32(mdhd.start + (version === 1 ? 20 : 12))
      const entryCount = moov.getUint32(stts.start + 4)
      let samples = 0
      let totalTime = 0
      for (let i = 0; i < entryCount; i++) {
        const count = moov.getUint32(stts.start + 8 + i * 8)
        const delta = moov.getUint32(stts.start + 12 + i * 8)
        samples += count
        totalTime += count * delta
      }
      if (samples < 1 || totalTime <= 0 || timescale <= 0) continue
      return normalizeFps((timescale * samples) / totalTime)
    }
    return null
  } catch {
    return null
  }
}

/** Fallback measurement for non-MP4 sources (e.g. dropped WebM):
 *  play the clip muted and relate the decoded-frame counter
 *  (getVideoPlaybackQuality) to the elapsed media time. Decode
 *  counting works offscreen, but can lag mid-playback — so short
 *  clips are played to the end for an exact count. */
async function measurePlaybackFps(video: HTMLVideoElement): Promise<number | null> {
  if (typeof video.getVideoPlaybackQuality !== 'function') return null
  try {
    video.currentTime = 0
    const framesBefore = video.getVideoPlaybackQuality().totalVideoFrames
    const timeBefore = video.currentTime
    await video.play()
    await new Promise<void>((resolve) => {
      // Sample up to ~3s of playback; clips shorter than that play to
      // the end, which makes the decoded count exact.
      const timeout = window.setTimeout(resolve, 3000)
      video.addEventListener(
        'ended',
        () => {
          window.clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
    })
    const framesPlayed = video.getVideoPlaybackQuality().totalVideoFrames - framesBefore
    const timePlayed = video.currentTime - timeBefore
    video.pause()
    if (framesPlayed < 4 || timePlayed < 0.15) return null
    return normalizeFps(framesPlayed / timePlayed)
  } catch {
    return null
  }
}

export interface VideoImportResult {
  frames: SourceFrame[]
  /** The video's detected frame rate (or FALLBACK_VIDEO_FPS). */
  fps: number
  /** False when the rate could not be measured and the fallback is used. */
  fpsDetected: boolean
}

/** Extract frames from an MP4 by seeking at the video's own frame
 *  rate (auto-detected) and grabbing each presented frame. Frames are
 *  stored as JPEG blobs (decoded on demand) to keep memory bounded. */
export async function extractVideoFrames(
  file: File,
  onProgress: (v: number) => void,
): Promise<VideoImportResult> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  try {
    await once(video, 'loadedmetadata')
    if (video.readyState < 2) await once(video, 'loadeddata')

    let duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      // Chrome quirk: streamed/fragmented files report Infinity until
      // seeked far past the end; the seek clamps and fixes duration.
      await seekTo(video, 1e9)
      duration = video.duration
      await seekTo(video, 0)
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not read video duration')
    }

    // Timeline FPS follows the source video: exact rate from the MP4
    // container when possible, measured playback rate otherwise.
    const detected = (await mp4Fps(file)) ?? (await measurePlaybackFps(video))
    const safeFps = detected ?? FALLBACK_VIDEO_FPS
    const total = Math.min(MAX_VIDEO_FRAMES, Math.max(1, Math.floor(duration * safeFps)))

    const scale = Math.min(1, MAX_VIDEO_WIDTH / video.videoWidth)
    const cw = Math.max(1, Math.round(video.videoWidth * scale))
    const ch = Math.max(1, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')!
    const thumbCanvas = document.createElement('canvas')

    const frames: SourceFrame[] = []
    for (let i = 0; i < total; i++) {
      const t = Math.min(i / safeFps, Math.max(0, duration - 0.001))
      await seekTo(video, t)
      ctx.drawImage(video, 0, 0, cw, ch)
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Frame encode failed'))),
          'image/jpeg',
          0.92,
        ),
      )
      frames.push({
        id: nextFrameId(),
        index: i,
        name: `frame_${String(i + 1).padStart(4, '0')}`,
        width: cw,
        height: ch,
        source: blob,
        thumb: makeThumb(canvas, cw, ch, thumbCanvas),
      })
      onProgress((i + 1) / total)
    }
    return { frames, fps: safeFps, fpsDetected: detected !== null }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
