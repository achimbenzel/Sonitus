/* ============================================================
   Preset (parameter) files: JSON export/import with validation.
   Unknown keys are ignored; invalid values fail with a clear
   message instead of silently corrupting state.
   ============================================================ */

import type { DitherSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'
import { ALGORITHMS } from '../dither/algorithms/index'
import { downloadBlob } from './export'

export interface PresetFile extends DitherSettings {
  version: 1
  app: string
  /** User-chosen preset name (older presets may not have one). */
  name: string
  fps: number
  loop: boolean
}

const DEFAULT_PRESET_NAME = 'Dither Preset'

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'dither-preset'
}

export function exportPreset(
  settings: DitherSettings,
  fps: number,
  loop: boolean,
  name?: string,
): void {
  const presetName = name?.trim() || DEFAULT_PRESET_NAME
  // resolvedPalette is derived from the source image — never persist it.
  const { resolvedPalette: _derived, ...persistable } = settings
  const preset: PresetFile = {
    version: 1,
    app: 'sonitus-dither',
    name: presetName,
    ...persistable,
    fps,
    loop,
  }
  // Sonitus preset files use the .sonitus extension; the content is
  // plain JSON, and import still accepts older .json preset files.
  downloadBlob(
    new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }),
    `${slugify(presetName)}.sonitus`,
  )
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function num(obj: Record<string, unknown>, key: string, min: number, max: number, fallback: number): number {
  const v = obj[key]
  if (v === undefined) return fallback
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`Preset field "${key}" must be a number`)
  }
  return Math.min(max, Math.max(min, v))
}

function bool(obj: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = obj[key]
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') throw new Error(`Preset field "${key}" must be true/false`)
  return v
}

function hex(obj: Record<string, unknown>, key: string, fallback: string): string {
  const v = obj[key]
  if (v === undefined) return fallback
  if (typeof v !== 'string' || !HEX_RE.test(v)) {
    throw new Error(`Preset field "${key}" must be a hex color like #aabbcc`)
  }
  return v
}

export interface ParsedPreset {
  settings: DitherSettings
  fps: number
  loop: boolean
  /** Preset name; older files without one fall back to a default. */
  name: string
}

export function parsePreset(json: string): ParsedPreset {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Preset must be a JSON object')
  }
  const obj = raw as Record<string, unknown>

  const algorithm = obj.algorithm ?? DEFAULT_SETTINGS.algorithm
  if (typeof algorithm !== 'string' || !ALGORITHMS.some((a) => a.id === algorithm)) {
    throw new Error(`Unknown algorithm "${String(algorithm)}"`)
  }
  const paletteMode = obj.paletteMode ?? DEFAULT_SETTINGS.paletteMode
  if (paletteMode !== 'mono' && paletteMode !== 'image') {
    throw new Error('paletteMode must be "mono" or "image"')
  }
  // Older presets fall back to the current mapping / dominant style.
  // (`resampling` / `postResample` from old preset files are ignored —
  // the post-dither soften feature was removed.)
  const colorMapping = obj.colorMapping ?? DEFAULT_SETTINGS.colorMapping
  if (colorMapping !== 'current' && colorMapping !== 'legacy') {
    throw new Error('colorMapping must be "current" or "legacy"')
  }
  const paletteStyle = obj.paletteStyle ?? DEFAULT_SETTINGS.paletteStyle
  const PALETTE_STYLES = ['dominant', 'average', 'vibrant', 'muted', 'contrast', 'custom']
  if (typeof paletteStyle !== 'string' || !PALETTE_STYLES.includes(paletteStyle)) {
    throw new Error(`paletteStyle must be one of ${PALETTE_STYLES.join(', ')}`)
  }
  let customPalette = DEFAULT_SETTINGS.customPalette
  if (obj.customPalette !== undefined) {
    if (
      !Array.isArray(obj.customPalette) ||
      obj.customPalette.some((c) => typeof c !== 'string' || !HEX_RE.test(c))
    ) {
      throw new Error('customPalette must be an array of hex colors')
    }
    customPalette = (obj.customPalette as string[]).slice(0, 32)
  }

  const d = DEFAULT_SETTINGS
  const settings: DitherSettings = {
    algorithm: algorithm as DitherSettings['algorithm'],
    resolution: Math.round(num(obj, 'resolution', 8, 1024, d.resolution)),
    brightness: num(obj, 'brightness', -100, 100, d.brightness),
    contrast: num(obj, 'contrast', -100, 100, d.contrast),
    gamma: num(obj, 'gamma', 0.2, 3, d.gamma),
    threshold: num(obj, 'threshold', -100, 100, d.threshold),
    preBlur: num(obj, 'preBlur', 0, 10, d.preBlur),
    invert: bool(obj, 'invert', d.invert),
    serpentine: bool(obj, 'serpentine', d.serpentine),
    greyLevels: Math.round(num(obj, 'greyLevels', 2, 16, d.greyLevels)),
    paletteMode,
    colorMapping: colorMapping as DitherSettings['colorMapping'],
    paletteStyle: paletteStyle as DitherSettings['paletteStyle'],
    customPalette,
    lightColor: hex(obj, 'lightColor', d.lightColor),
    darkColor: hex(obj, 'darkColor', d.darkColor),
    paletteSize: Math.round(num(obj, 'paletteSize', 2, 32, d.paletteSize)),
    pixelScale: Math.round(num(obj, 'pixelScale', 1, 16, d.pixelScale)),
  }
  return {
    settings,
    fps: Math.round(num(obj, 'fps', 1, 60, 12)),
    loop: bool(obj, 'loop', true),
    name: typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name.trim() : DEFAULT_PRESET_NAME,
  }
}
