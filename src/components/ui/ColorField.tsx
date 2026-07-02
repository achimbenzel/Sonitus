/* ============================================================
   ColorField — unified color control:
     [color swatch] [HEX input]   ← hex entry is the primary control
     [preset chips]               ← compact row underneath
   The swatch previews the value live and opens the native picker
   on click. Hex input accepts #rgb / #rrggbb, validated before
   applying; Escape restores, Enter/blur commits.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** Single-color preset chips shown under the hex row. */
const COLOR_PRESETS = [
  '#000000', '#ffffff', '#e8e3dc', '#4af17a', '#03170a',
  '#ffb02e', '#ff6600', '#e63946', '#1c3fae', '#f4ead8',
]

/** Accepts #rgb / #rrggbb (with or without #); returns #rrggbb or null. */
export function normalizeHex(input: string): string | null {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1].toLowerCase()
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  return `#${h}`
}

interface ColorFieldProps {
  label: string
  value: string
  disabled?: boolean
  onChange: (hex: string) => void
  /** Optional slot (e.g. keyframe control) rendered before the label. */
  headSlot?: ReactNode
}

export function ColorField({ label, value, disabled, onChange, headSlot }: ColorFieldProps) {
  const [hexDraft, setHexDraft] = useState(value)
  const [hexInvalid, setHexInvalid] = useState(false)
  const editing = useRef(false)

  // Follow external value changes (keyframes, presets) unless typing.
  useEffect(() => {
    if (!editing.current) {
      setHexDraft(value)
      setHexInvalid(false)
    }
  }, [value])

  const commitHex = () => {
    editing.current = false
    const normalized = normalizeHex(hexDraft)
    if (normalized) {
      setHexDraft(normalized)
      if (normalized !== value) onChange(normalized)
    } else {
      // Invalid input: restore the applied color.
      setHexDraft(value)
    }
    setHexInvalid(false)
  }

  // Live-preview the swatch while a valid hex is being typed.
  const previewColor = normalizeHex(hexDraft) ?? value

  return (
    <div className={`control colorfield${disabled ? ' disabled' : ''}`}>
      <div className="control-head">
        {headSlot}
        <span className="control-label">{label}</span>
      </div>

      <div className="colorfield-body">
        <span
          className="color-swatch"
          style={{ background: previewColor }}
          title="Open color picker"
        >
          <input
            type="color"
            value={normalizeHex(value) ?? '#000000'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`${label} color picker`}
          />
        </span>
        <input
          type="text"
          className={`colorfield-hexinput${hexInvalid ? ' invalid' : ''}`}
          value={hexDraft}
          disabled={disabled}
          spellCheck={false}
          maxLength={7}
          aria-label={`${label} hex value`}
          onFocus={() => {
            editing.current = true
          }}
          onChange={(e) => {
            setHexDraft(e.target.value)
            setHexInvalid(e.target.value.trim() !== '' && normalizeHex(e.target.value) === null)
          }}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitHex()
            else if (e.key === 'Escape') {
              editing.current = false
              setHexDraft(value)
              setHexInvalid(false)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder="#ff6600"
        />
      </div>

      <div className="colorfield-presets">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={`colorchip${normalizeHex(value) === c ? ' selected' : ''}`}
            style={{ background: c }}
            title={c}
            aria-label={`${label}: ${c}`}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  )
}
