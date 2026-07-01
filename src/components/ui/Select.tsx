/* ============================================================
   Custom select: replaces native <select> with a fully styled
   trigger + popup listbox (hover/focus/open/disabled states,
   keyboard navigation, optional option groups).
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  group?: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  ariaLabel?: string
}

export function Select({ value, options, onChange, disabled, ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  // Keep the active option visible while navigating with the keyboard.
  useEffect(() => {
    if (!open || active < 0) return
    const el = menuRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openMenu = () => {
    setActive(options.findIndex((o) => o.value === value))
    setOpen(true)
  }

  const commit = (idx: number) => {
    const opt = options[idx]
    if (opt) onChange(opt.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        openMenu()
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(active)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  // Render options preserving group order, with group headers.
  let lastGroup: string | undefined
  const items: JSX.Element[] = []
  options.forEach((opt, idx) => {
    if (opt.group !== lastGroup) {
      lastGroup = opt.group
      if (opt.group) {
        items.push(
          <div key={`g-${opt.group}`} className="select-group">
            {opt.group}
          </div>,
        )
      }
    }
    items.push(
      <div
        key={opt.value}
        data-idx={idx}
        role="option"
        aria-selected={opt.value === value}
        className={`select-option${opt.value === value ? ' selected' : ''}${idx === active ? ' active' : ''}`}
        onPointerEnter={() => setActive(idx)}
        onClick={() => commit(idx)}
      >
        <span className="select-option-label">{opt.label}</span>
        {opt.value === value && <Check size={13} strokeWidth={2.5} />}
      </div>,
    )
  })

  return (
    <div className={`select${disabled ? ' disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`select-trigger${open ? ' open' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className="select-value">{selected?.label ?? '—'}</span>
        <ChevronDown size={14} className="select-chevron" />
      </button>
      {open && (
        <div className="select-menu" role="listbox" ref={menuRef}>
          {items}
        </div>
      )}
    </div>
  )
}
