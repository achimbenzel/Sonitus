/* ============================================================
   Export system: PNG / JPEG / SVG stills and zipped PNG sequences.
   Everything is client-side; downloads go through a Blob URL.
   ============================================================ */

import { zipSync } from 'fflate'
import type { DitherSettings, RawImage, SourceFrame } from '../types'
import { PRIORITY, ProcessingEngine } from '../engine/ProcessingEngine'
import { hexToRgb } from '../dither/palette'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Nearest-neighbor upscale of a processed bitmap by pixelScale. */
function scaleToCanvas(bmp: ImageBitmap, scale: number): OffscreenCanvas {
  const s = Math.max(1, Math.round(scale))
  const c = new OffscreenCanvas(bmp.width * s, bmp.height * s)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  return c
}

function baseName(frame: SourceFrame): string {
  return frame.name.replace(/\.[a-z0-9]+$/i, '') || 'dithered'
}

export async function exportStill(
  engine: ProcessingEngine,
  frame: SourceFrame,
  settings: DitherSettings,
  format: 'png' | 'jpeg',
): Promise<void> {
  const bmp = await engine.getProcessed(frame, settings, PRIORITY.EXPORT)
  const canvas = scaleToCanvas(bmp, settings.pixelScale)
  if (format === 'jpeg') {
    // JPEG has no alpha — composite over the shadow color (mono) or black.
    const flat = new OffscreenCanvas(canvas.width, canvas.height)
    const ctx = flat.getContext('2d')!
    ctx.fillStyle = settings.paletteMode === 'mono' ? settings.darkColor : '#000000'
    ctx.fillRect(0, 0, flat.width, flat.height)
    ctx.drawImage(canvas, 0, 0)
    const blob = await flat.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
    downloadBlob(blob, `${baseName(frame)}_dithered.jpg`)
    return
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  downloadBlob(blob, `${baseName(frame)}_dithered.png`)
}

/* ---------- SVG ---------- */

function toHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}

/** Vectorize a processed frame. Horizontal runs of equal color merge
 *  into 1-unit-tall rect subpaths, grouped into one <path> per color —
 *  compact and fast to render with shape-rendering: crispEdges. */
export function rawImageToSvg(img: RawImage, pixelScale: number): string {
  const { data, width: w, height: h } = img
  const byColor = new Map<string, string[]>()

  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      if (a < 8) {
        x++
        continue
      }
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      let end = x + 1
      while (end < w) {
        const j = (y * w + end) * 4
        if (data[j] !== r || data[j + 1] !== g || data[j + 2] !== b || Math.abs(data[j + 3] - a) > 8) break
        end++
      }
      const key = a < 248 ? `${toHex(r, g, b)}@${(a / 255).toFixed(2)}` : toHex(r, g, b)
      let list = byColor.get(key)
      if (!list) {
        list = []
        byColor.set(key, list)
      }
      list.push(`M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  }

  const scale = Math.max(1, Math.round(pixelScale))
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">`,
  ]
  for (const [key, ds] of byColor) {
    const [fill, opacity] = key.split('@')
    const op = opacity ? ` fill-opacity="${opacity}"` : ''
    parts.push(`<path fill="${fill}"${op} d="${ds.join('')}"/>`)
  }
  parts.push('</svg>')
  return parts.join('\n')
}

export async function exportSvg(
  engine: ProcessingEngine,
  frame: SourceFrame,
  settings: DitherSettings,
): Promise<void> {
  const raw = await engine.getProcessedData(frame, settings)
  const svg = rawImageToSvg(raw, settings.pixelScale)
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${baseName(frame)}_dithered.svg`)
}

/* ---------- Sequence export ---------- */

export interface SequenceExportHandle {
  cancelled: boolean
}

export async function exportSequence(
  engine: ProcessingEngine,
  frames: SourceFrame[],
  settings: DitherSettings,
  onProgress: (v: number) => void,
  handle: SequenceExportHandle,
): Promise<void> {
  const files: Record<string, Uint8Array> = {}
  for (let i = 0; i < frames.length; i++) {
    if (handle.cancelled) return
    const bmp = await engine.getProcessed(frames[i], settings, PRIORITY.EXPORT)
    const canvas = scaleToCanvas(bmp, settings.pixelScale)
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    files[`frame_${String(i + 1).padStart(4, '0')}.png`] = new Uint8Array(
      await blob.arrayBuffer(),
    )
    onProgress((i + 1) / frames.length)
  }
  if (handle.cancelled) return
  // PNGs are already compressed — store, don't deflate.
  const zipped = zipSync(files, { level: 0 })
  downloadBlob(new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }), 'dithered_sequence.zip')
}

/* Re-export for palette-aware callers. */
export { hexToRgb }
