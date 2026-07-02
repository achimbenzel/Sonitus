/* ============================================================
   Animated export: MP4 (WebCodecs + mp4-muxer) and GIF (gifenc).

   Both encoders run fully client-side and offline. Frames are
   rendered through the same engine/keyframe path as the preview:
   the caller supplies settingsAt(i) so keyframed parameters are
   baked into the output, and the pixel scale multiplier is applied
   before encoding.
   ============================================================ */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import type { DitherSettings, SourceFrame } from '../types'
import { PRIORITY, ProcessingEngine } from '../engine/ProcessingEngine'
import { downloadBlob } from './export'

export interface AnimationExportOptions {
  engine: ProcessingEngine
  frames: SourceFrame[]
  totalFrames: number
  fps: number
  settingsAt: (frameIndex: number) => DitherSettings
  onProgress: (v: number) => void
  handle: { cancelled: boolean }
}

/** Timeline frame → source frame (sequences map 1:1, stills repeat). */
function sourceFrameAt(frames: SourceFrame[], i: number): SourceFrame {
  return frames.length > 1 ? frames[Math.min(i, frames.length - 1)] : frames[0]
}

/** Render one timeline frame at output size (processed × pixelScale). */
async function renderFrame(
  engine: ProcessingEngine,
  frames: SourceFrame[],
  i: number,
  settings: DitherSettings,
  canvas: OffscreenCanvas,
): Promise<void> {
  const bmp = await engine.getProcessed(sourceFrameAt(frames, i), settings, PRIORITY.EXPORT)
  const scale = Math.max(1, Math.round(settings.pixelScale))
  const w = bmp.width * scale
  const h = bmp.height * scale
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
}

/* ---------- MP4 ---------- */

interface CodecPick {
  codec: string
  muxCodec: 'avc' | 'vp9'
  bitrate: number
}

async function pickVideoCodec(width: number, height: number, fps: number): Promise<CodecPick> {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('MP4 export needs WebCodecs (available in Chrome)')
  }
  const bitrate = Math.min(16_000_000, Math.max(1_000_000, Math.round(width * height * fps * 0.12)))
  // H.264 first (widest player compatibility): High → Main → Baseline,
  // level 4.2 covers 1080p60.
  for (const codec of ['avc1.64002a', 'avc1.4d002a', 'avc1.42002a']) {
    const support = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps })
    if (support.supported) return { codec, muxCodec: 'avc', bitrate }
  }
  // Fallback: VP9 in MP4 — plays in Chrome/VLC; used when the browser
  // build ships without proprietary H.264 encoders.
  const vp9 = await VideoEncoder.isConfigSupported({
    codec: 'vp09.00.41.08', width, height, bitrate, framerate: fps,
  })
  if (vp9.supported) return { codec: 'vp09.00.41.08', muxCodec: 'vp9', bitrate }
  throw new Error('No MP4 video encoder (H.264/VP9) is available in this browser')
}

export async function exportMp4(opts: AnimationExportOptions): Promise<void> {
  const { engine, frames, totalFrames, fps, settingsAt, onProgress, handle } = opts
  if (frames.length === 0) throw new Error('Nothing to export')

  // Size comes from frame 0; H.264 requires even dimensions.
  const canvas = new OffscreenCanvas(2, 2)
  await renderFrame(engine, frames, 0, settingsAt(0), canvas)
  const width = Math.max(2, canvas.width - (canvas.width % 2))
  const height = Math.max(2, canvas.height - (canvas.height % 2))
  const { codec, muxCodec, bitrate } = await pickVideoCodec(width, height, fps)

  const evenCanvas = new OffscreenCanvas(width, height)
  const evenCtx = evenCanvas.getContext('2d')!
  evenCtx.imageSmoothingEnabled = false

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: muxCodec, width, height },
    fastStart: 'in-memory',
  })
  let encoderError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e))
    },
  })
  encoder.configure({ codec, width, height, bitrate, framerate: fps })

  const frameDurUs = Math.round(1_000_000 / fps)
  for (let i = 0; i < totalFrames; i++) {
    if (handle.cancelled || encoderError) break
    await renderFrame(engine, frames, i, settingsAt(i), canvas)
    evenCtx.drawImage(canvas, 0, 0)
    const vf = new VideoFrame(evenCanvas, {
      timestamp: i * frameDurUs,
      duration: frameDurUs,
    })
    // Keyframe every ~2 seconds keeps seeking snappy without bloating size.
    encoder.encode(vf, { keyFrame: i % Math.max(1, fps * 2) === 0 })
    vf.close()
    // Backpressure: don't let the encode queue grow unbounded.
    while (encoder.encodeQueueSize > 4) {
      await new Promise((r) => setTimeout(r, 5))
    }
    onProgress((i + 1) / totalFrames)
  }

  if (!handle.cancelled && !encoderError) {
    await encoder.flush()
    muxer.finalize()
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' })
    downloadBlob(blob, 'dithered.mp4')
  }
  encoder.close()
  if (encoderError) throw encoderError
}

/* ---------- GIF ---------- */

export async function exportGif(opts: AnimationExportOptions): Promise<void> {
  const { engine, frames, totalFrames, fps, settingsAt, onProgress, handle } = opts
  if (frames.length === 0) throw new Error('Nothing to export')

  const canvas = new OffscreenCanvas(2, 2)
  const gif = GIFEncoder()
  // GIF delay is in ms, rounded to 10ms steps by the format.
  const delay = Math.max(20, Math.round(1000 / fps))

  for (let i = 0; i < totalFrames; i++) {
    if (handle.cancelled) return
    await renderFrame(engine, frames, i, settingsAt(i), canvas)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    // Dithered output is already palette-limited, so 256 colors is lossless
    // for mono modes and near-lossless for image-palette mode.
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, width, height, { palette, delay })
    onProgress((i + 1) / totalFrames)
  }

  gif.finish()
  const bytes = gif.bytes()
  downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' }), 'dithered.gif')
}
