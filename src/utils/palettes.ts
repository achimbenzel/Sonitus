/* ============================================================
   Palette files: save/load color palettes independently of full
   presets. Plain JSON inside, custom `.sonitus-palette` extension.
   Works for generated image palettes, the custom palette and any
   manually edited palette.
   ============================================================ */

import { downloadBlob } from './export'

export interface PaletteFile {
  version: 1
  app: 'sonitus-dither'
  kind: 'palette'
  name: string
  /** 2..32 hex colors, in order. */
  colors: string[]
  /** Optional metadata. */
  mode?: string
  created?: string
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const DEFAULT_NAME = 'Sonitus Palette'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'palette'
}

export function exportPaletteFile(name: string, colors: string[], mode?: string): void {
  const paletteName = name.trim() || DEFAULT_NAME
  const file: PaletteFile = {
    version: 1,
    app: 'sonitus-dither',
    kind: 'palette',
    name: paletteName,
    colors,
    mode,
    created: new Date().toISOString(),
  }
  downloadBlob(
    new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    `${slugify(paletteName)}.sonitus-palette`,
  )
}

export interface ParsedPalette {
  name: string
  colors: string[]
}

/** Validates a palette file; throws with a clear message on bad input. */
export function parsePaletteFile(json: string): ParsedPalette {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Palette file must be a JSON object')
  }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.colors) || obj.colors.length < 2) {
    throw new Error('Palette file needs a "colors" array with at least 2 colors')
  }
  if (obj.colors.some((c) => typeof c !== 'string' || !HEX_RE.test(c))) {
    throw new Error('Palette colors must be hex values like #aabbcc')
  }
  const colors = (obj.colors as string[]).slice(0, 32).map((c) => {
    let h = c.replace('#', '').toLowerCase()
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    return `#${h}`
  })
  const name =
    typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name.trim() : DEFAULT_NAME
  return { name, colors }
}

/** Merge palettes: current colors first, new ones appended without
 *  duplicates, capped at 32. */
export function mergePalettes(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map((c) => c.toLowerCase()))
  const merged = [...current]
  for (const c of incoming) {
    if (!seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase())
      merged.push(c)
    }
    if (merged.length >= 32) break
  }
  return merged
}
