/* ============================================================
   Export system: PNG / JPEG / SVG stills and zipped PNG sequences.
   Everything is client-side; downloads go through a Blob URL.
   ============================================================ */

import { zipSync } from 'fflate'
import type { DitherSettings, RawImage, SourceFrame } from '../types'
import { PRIORITY, ProcessingEngine } from '../engine/ProcessingEngine'
import { hexToRgb } from '../dither/palette'
import { stampPngBlob, stampPngBytes } from './pngMeta'

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
function scaleToCanvas(bmp: ImageBitmap, settings: DitherSettings): OffscreenCanvas {
  const s = Math.max(1, Math.round(settings.pixelScale))
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
  const canvas = scaleToCanvas(bmp, settings)
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
  const blob = await stampPngBlob(await canvas.convertToBlob({ type: 'image/png' }))
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

/* ---------- Shared export cancellation handle ---------- */

export interface SequenceExportHandle {
  cancelled: boolean
}

/* ---------- CMYK screenprint separations ---------- */

/** Export the current processed frame as four separation plates
 *  (C / M / Y / K) for screenprinting, zipped as individual PNGs.
 *
 *  Conversion is the standard naive RGB→CMYK formula (no ICC profile),
 *  which is an approximation: it maximizes black generation (GCR) and
 *  assumes idealized inks. Plates are rendered as ink coverage —
 *  black where ink goes, white where the paper stays clean — at the
 *  full output size (processing resolution × pixel scale). */
export async function exportCmykPlates(
  engine: ProcessingEngine,
  frame: SourceFrame,
  settings: DitherSettings,
): Promise<void> {
  // Separate from the final composited output (incl. pixel scale) so
  // the plates match what you see.
  const bmp = await engine.getProcessed(frame, settings, PRIORITY.EXPORT)
  const composite = scaleToCanvas(bmp, settings)
  const width = composite.width
  const height = composite.height
  const data = composite
    .getContext('2d', { willReadFrequently: true })!
    .getImageData(0, 0, width, height).data
  const n = width * height

  const plates: Record<'C' | 'M' | 'Y' | 'K', Uint8ClampedArray> = {
    C: new Uint8ClampedArray(n * 4),
    M: new Uint8ClampedArray(n * 4),
    Y: new Uint8ClampedArray(n * 4),
    K: new Uint8ClampedArray(n * 4),
  }

  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const a = data[i + 3] / 255
    // Transparent pixels print nothing (treat as white paper).
    const r = (data[i] / 255) * a + (1 - a)
    const g = (data[i + 1] / 255) * a + (1 - a)
    const b = (data[i + 2] / 255) * a + (1 - a)
    const k = 1 - Math.max(r, g, b)
    const denom = 1 - k
    const c = denom > 0 ? (1 - r - k) / denom : 0
    const m = denom > 0 ? (1 - g - k) / denom : 0
    const y = denom > 0 ? (1 - b - k) / denom : 0
    const cov: Record<'C' | 'M' | 'Y' | 'K', number> = { C: c, M: m, Y: y, K: k }
    for (const key of ['C', 'M', 'Y', 'K'] as const) {
      const v = Math.round(255 * (1 - cov[key])) // ink = black on white
      const plate = plates[key]
      plate[i] = v
      plate[i + 1] = v
      plate[i + 2] = v
      plate[i + 3] = 255
    }
  }

  // Plates are already at the full output size — encode directly.
  const plateCanvas = new OffscreenCanvas(width, height)
  const plateCtx = plateCanvas.getContext('2d')!

  const base = baseName(frame)
  const files: Record<string, Uint8Array> = {}
  for (const key of ['C', 'M', 'Y', 'K'] as const) {
    plateCtx.putImageData(new ImageData(plates[key], width, height), 0, 0)
    const blob = await plateCanvas.convertToBlob({ type: 'image/png' })
    files[`${base}_${key}.png`] = stampPngBytes(new Uint8Array(await blob.arrayBuffer()))
  }
  const zipped = zipSync(files, { level: 0 })
  downloadBlob(
    new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' }),
    `${base}_cmyk_plates.zip`,
  )
}

/* Re-export for palette-aware callers. */
export { hexToRgb }
