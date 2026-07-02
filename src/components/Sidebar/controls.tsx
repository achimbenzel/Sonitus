/* Sidebar control primitives: clean section headings, sliders with
   editable values + double-click reset, keyframe controls, toggles,
   selects. */

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react'
import { Select, type SelectOption } from '../ui/Select'

export function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="side-section">
      <h3 className="side-heading">{label}</h3>
      <div className="side-rows">{children}</div>
    </section>
  )
}

/* ---------- keyframe control (diamond + prev/next) ---------- */

export interface KfControlProps {
  /** Parameter has at least one keyframe somewhere. */
  has: boolean
  /** A keyframe sits exactly on the current frame. */
  at: boolean
  canPrev: boolean
  canNext: boolean
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
}

export function KeyframeControl({ has, at, canPrev, canNext, onToggle, onPrev, onNext }: KfControlProps) {
  return (
    <span className={`kfctl${has ? ' has' : ''}`}>
      {has && (
        <button
          type="button"
          className="kf-nav"
          disabled={!canPrev}
          onClick={onPrev}
          title="Previous keyframe"
          aria-label="Previous keyframe"
        >
          <ChevronLeft size={10} strokeWidth={3} />
        </button>
      )}
      <button
        type="button"
        className={`kf-diamond${at ? ' at' : ''}`}
        onClick={onToggle}
        title={at ? 'Remove keyframe at current frame' : 'Add keyframe at current frame'}
        aria-label={at ? 'Remove keyframe' : 'Add keyframe'}
        aria-pressed={at}
      >
        <Diamond size={9} strokeWidth={2.5} fill={at ? 'currentColor' : 'none'} />
      </button>
      {has && (
        <button
          type="button"
          className="kf-nav"
          disabled={!canNext}
          onClick={onNext}
          title="Next keyframe"
          aria-label="Next keyframe"
        >
          <ChevronRight size={10} strokeWidth={3} />
        </button>
      )}
    </span>
  )
}

/* ---------- slider ---------- */

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
  /** Optional keyframe control rendered next to the label. */
  kf?: KfControlProps
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
  kf,
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
        {kf && <KeyframeControl {...kf} />}
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
