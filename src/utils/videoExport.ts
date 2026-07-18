/* ============================================================
   Animated export: MP4 (WebCodecs + mediabunny) and GIF (gifenc).

   Both encoders run fully client-side and offline. Frames are
   rendered through the same engine/keyframe path as the preview:
   the caller supplies settingsAt(i) so keyframed parameters are
   baked into the output, and the pixel scale multiplier is applied
   before encoding.
   ============================================================ */

import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { zipSync } from 'fflate'
import { stampPngBytes } from './pngMeta'
import type { DitherSettings, SourceFrame } from '../types'
import { PRIORITY, ProcessingEngine } from '../engine/ProcessingEngine'
import { downloadBlob, flattenCanvas, knockOutColor, wantsFlatten, wantsTransparency } from './export'

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

/** Fixed output size for the whole animation.
 *
 *  The processed bitmap's size varies per frame when resolution or
 *  pixel scale are keyframed. The viewport always stretches the result
 *  onto the same rect, so animated resolution reads as "chunkier
 *  pixels", never as a crop. Exports must do the same: pick one canvas
 *  size for the entire timeline (the maximum any frame wants) and
 *  stretch every frame onto it — otherwise later frames get cropped,
 *  which showed up as an unintended zoom-in near the end. */
function computeOutputSize(
  frames: SourceFrame[],
  totalFrames: number,
  settingsAt: (i: number) => DitherSettings,
): { width: number; height: number } {
  let w = 2
  let h = 2
  for (let i = 0; i < totalFrames; i++) {
    const src = sourceFrameAt(frames, i)
    const s = settingsAt(i)
    const scale = Math.max(1, Math.round(s.pixelScale))
    const pw = Math.max(1, Math.min(Math.round(s.resolution), src.width))
    const ph = Math.max(1, Math.round((pw * src.height) / src.width))
    w = Math.max(w, pw * scale)
    h = Math.max(h, ph * scale)
  }
  return { width: w, height: h }
}

/** Render one timeline frame stretched onto the fixed output canvas —
 *  identical framing to the viewport (nearest neighbor, full rect). */
async function renderFrameInto(
  engine: ProcessingEngine,
  frames: SourceFrame[],
  i: number,
  settings: DitherSettings,
  canvas: OffscreenCanvas,
): Promise<void> {
  const bmp = await engine.getProcessed(sourceFrameAt(frames, i), settings, PRIORITY.EXPORT)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
}

/* ---------- MP4 ---------- */

export async function exportMp4(opts: AnimationExportOptions): Promise<void> {
  const { engine, frames, totalFrames, fps, settingsAt, onProgress, handle } = opts
  if (frames.length === 0) throw new Error('Nothing to export')
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('MP4 export needs WebCodecs (available in Chrome)')
  }

  // One fixed size for the whole timeline; H.264 needs even dimensions.
  const out = computeOutputSize(frames, totalFrames, settingsAt)
  const width = Math.max(2, out.width - (out.width % 2))
  const height = Math.max(2, out.height - (out.height % 2))
  const bitrate = Math.min(16_000_000, Math.max(1_000_000, Math.round(width * height * fps * 0.12)))

  // H.264 first (widest player compatibility); VP9-in-MP4 as fallback
  // for Chromium builds without proprietary encoders (plays in
  // Chrome/VLC). mediabunny probes WebCodecs encoder support.
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width, height, bitrate })
  if (!codec) throw new Error('No MP4 video encoder (H.264/VP9) is available in this browser')

  const canvas = new OffscreenCanvas(width, height)
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  })
  // Keyframe every ~2 seconds keeps seeking snappy without bloating size.
  const source = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2 })
  output.addVideoTrack(source, { frameRate: fps })
  await output.start()

  try {
    const frameDur = 1 / fps
    for (let i = 0; i < totalFrames; i++) {
      if (handle.cancelled) break
      const s = settingsAt(i)
      await renderFrameInto(engine, frames, i, s, canvas)
      // MP4 has no alpha — composite over the background color.
      flattenCanvas(canvas, s.bgColor)
      // Awaiting add() respects writer + encoder backpressure.
      await source.add(i * frameDur, frameDur)
      onProgress((i + 1) / totalFrames)
    }
    if (handle.cancelled) {
      await output.cancel()
      return
    }
    source.close()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => undefined)
    throw err
  }
  const blob = new Blob([output.target.buffer!], { type: 'video/mp4' })
  downloadBlob(blob, 'dithered.mp4')
}

/* ---------- GIF ---------- */

export async function exportGif(opts: AnimationExportOptions): Promise<void> {
  const { engine, frames, totalFrames, fps, settingsAt, onProgress, handle } = opts
  if (frames.length === 0) throw new Error('Nothing to export')

  // GIF frames share one fixed size, same framing as the viewport.
  const out = computeOutputSize(frames, totalFrames, settingsAt)
  const canvas = new OffscreenCanvas(out.width, out.height)
  const gif = GIFEncoder()
  // GIF delay is in ms, rounded to 10ms steps by the format.
  const delay = Math.max(20, Math.round(1000 / fps))

  for (let i = 0; i < totalFrames; i++) {
    if (handle.cancelled) return
    const s = settingsAt(i)
    await renderFrameInto(engine, frames, i, s, canvas)
    if (wantsTransparency(s)) knockOutColor(canvas, s.darkColor)
    if (wantsFlatten(s)) flattenCanvas(canvas, s.bgColor)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    // Any alpha (source transparency or the knocked-out shadow color)
    // becomes GIF 1-bit transparency: quantize with alpha kept, then
    // mark the fully transparent palette entry.
    let hasAlpha = false
    for (let p = 3; p < data.length; p += 4) {
      if (data[p] < 128) {
        hasAlpha = true
        break
      }
    }
    if (hasAlpha) {
      const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true })
      const index = applyPalette(data, palette, 'rgba4444')
      const transparentIndex = palette.findIndex((p) => p[3] === 0)
      gif.writeFrame(index, width, height, {
        palette,
        delay,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        // Restore to background between frames so transparency doesn't
        // accumulate previous frames underneath.
        dispose: 2,
      })
    } else {
      // Dithered output is already palette-limited, so 256 colors is
      // lossless for mono modes, near-lossless for image-palette mode.
      const palette = quantize(data, 256)
      const index = applyPalette(data, palette)
      gif.writeFrame(index, width, height, { palette, delay })
    }
    onProgress((i + 1) / totalFrames)
  }

  gif.finish()
  const bytes = gif.bytes()
  downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' }), 'dithered.gif')
}

/* ---------- PNG sequence (timeline-aware) ---------- */

/** Export the full timeline as numbered PNG frames in a ZIP. Works for
 *  imported sequences AND keyframe animations of a single image —
 *  duration, FPS, keyframes, easing and pixel scale are all baked in. */
export async function exportPngSequence(opts: AnimationExportOptions): Promise<void> {
  const { engine, frames, totalFrames, settingsAt, onProgress, handle } = opts
  if (frames.length === 0) throw new Error('Nothing to export')

  const out = computeOutputSize(frames, totalFrames, settingsAt)
  const canvas = new OffscreenCanvas(out.width, out.height)
  const files: Record<string, Uint8Array> = {}

  for (let i = 0; i < totalFrames; i++) {
    if (handle.cancelled) return
    const s = settingsAt(i)
    await renderFrameInto(engine, frames, i, s, canvas)
    // Knocked out per frame: a keyframed shadow color stays correct.
    if (wantsTransparency(s)) knockOutColor(canvas, s.darkColor)
    if (wantsFlatten(s)) flattenCanvas(canvas, s.bgColor)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    files[`frame_${String(i + 1).padStart(4, '0')}.png`] = stampPngBytes(
      new Uint8Array(await blob.arrayBuffer()),
      settingsAt(0).dpi,
    )
    onProgress((i + 1) / totalFrames)
  }
  if (handle.cancelled) return
  // PNGs are already compressed — store, don't deflate.
  const zipped = zipSync(files, { level: 0 })
  downloadBlob(new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }), 'dithered_sequence.zip')
}
