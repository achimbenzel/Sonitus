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
  /** A keyframe sits here but the live value differs from the stored one. */
  dirty: boolean
  canPrev: boolean
  canNext: boolean
  /** Create / save-changed-value / remove (explicit, never automatic). */
  onToggle: () => void
  onPrev: () => void
  onNext: () => void
}

export function kfToggleTitle(at: boolean, dirty: boolean): string {
  if (!at) return 'Add keyframe at current frame'
  if (dirty) return 'Save changed value to this keyframe'
  return 'Remove keyframe at current frame'
}

export function KeyframeControl({ has, at, dirty, canPrev, canNext, onToggle, onPrev, onNext }: KfControlProps) {
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
        className={`kf-diamond${at ? ' at' : ''}${dirty ? ' dirty' : ''}`}
        onClick={onToggle}
        title={kfToggleTitle(at, dirty)}
        aria-label={kfToggleTitle(at, dirty)}
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

/** One pre-dither effect: [enable toggle][label][value] + strength
 *  slider (disabled while the effect is off). */
export function EffectRow({ label, on, value, min, max, step = 1, unit, resetValue, onToggle, onChange }: {
  label: string
  on: boolean
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  resetValue?: number
  onToggle: (on: boolean) => void
  onChange: (v: number) => void
}) {
  return (
    <div className={`control${on ? '' : ' fx-off'}`}>
      <div className="control-head">
        <label className="toggle toggle--mini" title={`${on ? 'Disable' : 'Enable'} ${label}`}>
          <input
            type="checkbox"
            checked={on}
            aria-label={`Enable ${label}`}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="track" />
        </label>
        <span className="control-label">{label}</span>
        <span className="control-valuebox">
          <span className="control-value control-value--static">
            {value}
            {unit && <span className="control-unit">{unit}</span>}
          </span>
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!on}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => {
          if (resetValue !== undefined) onChange(resetValue)
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
