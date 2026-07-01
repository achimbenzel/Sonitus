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

/** Extract frames from an MP4 by seeking at a fixed FPS and grabbing
 *  each presented frame. Frames are stored as JPEG blobs (decoded on
 *  demand) to keep memory bounded. */
export async function extractVideoFrames(
  file: File,
  fps: number,
  onProgress: (v: number) => void,
): Promise<SourceFrame[]> {
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
    const safeFps = Math.min(60, Math.max(1, fps))
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
    return frames
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
