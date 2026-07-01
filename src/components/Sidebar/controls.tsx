/* Sidebar control primitives: clean section headings, sliders with
   editable values + double-click reset, toggles, selects, colors. */

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Select, type SelectOption } from '../ui/Select'

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="side-section">
      <h3 className="side-heading">{label}</h3>
      <div className="side-rows">{children}</div>
    </section>
  )
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** Value restored on double-click (usually the app default). */
  resetValue?: number
  disabled?: boolean
  /** Unit suffix shown after the value (kept outside the edit field). */
  unit?: string
  /** Decimals used for display. */
  decimals?: number
  onChange: (v: number) => void
}

export function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  resetValue,
  disabled,
  unit,
  decimals = 0,
  onChange,
}: SliderRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const display = value.toFixed(decimals)

  const beginEdit = () => {
    if (disabled) return
    setDraft(display)
    setEditing(true)
    // Focus after the input mounts.
    requestAnimationFrame(() => inputRef.current?.select())
  }
  const commitEdit = () => {
    const parsed = Number(draft.replace(',', '.'))
    if (Number.isFinite(parsed)) onChange(clamp(parsed))
    setEditing(false)
  }

  return (
    <div className={`control${disabled ? ' disabled' : ''}`}>
      <div className="control-head">
        <span className="control-label">{label}</span>
        <span className="control-valuebox">
          {editing ? (
            <input
              ref={inputRef}
              className="control-valueinput"
              type="text"
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit()
                else if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <button
              type="button"
              className="control-value"
              onClick={beginEdit}
              title="Click to type a value"
            >
              {display}
              {unit && <span className="control-unit">{unit}</span>}
            </button>
          )}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => {
          if (resetValue !== undefined) onChange(clamp(resetValue))
        }}
        title={resetValue !== undefined ? 'Double-click to reset' : undefined}
      />
    </div>
  )
}

export function ToggleRow({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className={`toggle control${disabled ? ' disabled' : ''}`}>
      <span className="control-label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" />
    </label>
  )
}

export function SelectRow({ label, value, options, disabled, onChange }: {
  label: string
  value: string
  options: SelectOption[]
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className={`control${disabled ? ' disabled' : ''}`}>
      <div className="control-head">
        <span className="control-label">{label}</span>
      </div>
      <Select value={value} options={options} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </div>
  )
}

export function ColorRow({ label, value, disabled, onChange }: {
  label: string
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div className={`control color-row${disabled ? ' disabled' : ''}`}>
      <span className="control-label">{label}</span>
      <span className="color-well">
        <span className="color-hex">{value.toUpperCase()}</span>
        <span className="color-swatch" style={{ background: value }}>
          <input
            type="color"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
          />
        </span>
      </span>
    </div>
  )
}
