/* Small reusable sidebar control primitives. */

import type { ReactNode } from 'react'

export function Section({ label, variant, children }: {
  label: string
  variant?: 'teal' | 'cyan' | 'deep' | 'ink'
  children: ReactNode
}) {
  return (
    <section className="side-section">
      <span className={`flag${variant ? ` flag--${variant}` : ''}`}>{label}</span>
      <div className="side-rows">{children}</div>
    </section>
  )
}

export function SliderRow({ label, value, min, max, step = 1, disabled, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  format?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className={`control${disabled ? ' disabled' : ''}`}>
      <div className="control-head">
        <span className="control-label">{label}</span>
        <span className="control-value">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
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

export function SelectRow({ label, value, onChange, children }: {
  label: string
  value: string
  onChange: (v: string) => void
  children: ReactNode
}) {
  return (
    <div className="control">
      <div className="control-head">
        <span className="control-label">{label}</span>
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
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
      <input
        type="color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
