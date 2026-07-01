/* ============================================================
   Styled number input: custom up/down steppers (native spinners
   are hidden globally), clamped to [min, max], Enter/blur commit,
   Escape restores the previous value.
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface NumberFieldProps {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  disabled?: boolean
  ariaLabel?: string
}

export function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  ariaLabel,
}: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value))
  const focused = useRef(false)

  // Reflect external changes unless the user is mid-edit.
  useEffect(() => {
    if (!focused.current) setDraft(String(value))
  }, [value])

  const clamp = (v: number) => Math.min(max, Math.max(min, v))

  const commit = () => {
    const parsed = Number(draft)
    const next = Number.isFinite(parsed) ? clamp(parsed) : value
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  const bump = (dir: 1 | -1) => {
    const next = clamp(value + dir * step)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className={`numfield${disabled ? ' disabled' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={() => {
          focused.current = true
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setDraft(String(value))
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            bump(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            bump(-1)
          }
        }}
      />
      <div className="numfield-steppers">
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => bump(1)} aria-label="Increase">
          <ChevronUp size={10} strokeWidth={3} />
        </button>
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => bump(-1)} aria-label="Decrease">
          <ChevronDown size={10} strokeWidth={3} />
        </button>
      </div>
    </div>
  )
}
