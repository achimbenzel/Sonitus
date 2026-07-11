/* ============================================================
   Custom select: replaces native <select> with a fully styled
   trigger + popup listbox (hover/focus/open/disabled states,
   keyboard navigation, optional option groups and an optional
   search field for long lists).
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'

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
  /** Small inline variant (e.g. color picker mode switch). */
  compact?: boolean
  /** Show a filter field at the top of the menu (for long lists). */
  searchable?: boolean
}

export function Select({ value, options, onChange, disabled, ariaLabel, compact, searchable }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)

  // The rendered list; with an active search it is the filtered subset.
  const trimmed = query.trim().toLowerCase()
  const visible =
    searchable && trimmed !== ''
      ? options.filter((o) => o.label.toLowerCase().includes(trimmed))
      : options

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
    setQuery('')
    setActive(options.findIndex((o) => o.value === value))
    setOpen(true)
    if (searchable) requestAnimationFrame(() => searchRef.current?.focus())
  }

  const commit = (idx: number) => {
    const opt = visible[idx]
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
      setActive((a) => Math.min(visible.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(active)
    } else if (e.key === ' ' && !searchable) {
      e.preventDefault()
      commit(active)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  // Render options preserving group order, with group headers.
  let lastGroup: string | undefined
  const items: JSX.Element[] = []
  visible.forEach((opt, idx) => {
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
    <div className={`select${compact ? ' select--compact' : ''}${disabled ? ' disabled' : ''}`} ref={rootRef}>
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
          {searchable && (
            <div className="select-search">
              <Search size={12} />
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder="Search…"
                aria-label={`Search ${ariaLabel ?? 'options'}`}
                spellCheck={false}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
              />
            </div>
          )}
          {items.length > 0 ? items : <div className="select-empty">No matches</div>}
        </div>
      )}
    </div>
  )
}
