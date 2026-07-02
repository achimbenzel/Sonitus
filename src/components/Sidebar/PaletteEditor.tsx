/* Compact editor for the custom image palette: per color a picker
   swatch, validated hex field, reorder arrows and remove; plus add. */

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { normalizeHex } from '../ui/ColorField'

const MAX_COLORS = 32
const MIN_COLORS = 2

interface PaletteEditorProps {
  colors: string[]
  onChange: (next: string[]) => void
}

export function PaletteEditor({ colors, onChange }: PaletteEditorProps) {
  const [draftIdx, setDraftIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const setColor = (i: number, hex: string) => {
    const next = colors.slice()
    next[i] = hex
    onChange(next)
  }
  const commitDraft = (i: number) => {
    const normalized = normalizeHex(draft)
    if (normalized) setColor(i, normalized)
    setDraftIdx(null)
  }
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= colors.length) return
    const next = colors.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <div className="paledit">
      {colors.map((c, i) => (
        <div className="paledit-row" key={`${i}-${c}`}>
          <span className="color-swatch paledit-swatch" style={{ background: c }}>
            <input
              type="color"
              value={normalizeHex(c) ?? '#000000'}
              onChange={(e) => setColor(i, e.target.value)}
              aria-label={`Palette color ${i + 1}`}
            />
          </span>
          {draftIdx === i ? (
            <input
              type="text"
              className="colorfield-hexinput paledit-hex"
              value={draft}
              autoFocus
              spellCheck={false}
              maxLength={7}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitDraft(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraft(i)
                else if (e.key === 'Escape') setDraftIdx(null)
              }}
            />
          ) : (
            <button
              type="button"
              className="paledit-hexbtn"
              onClick={() => {
                setDraft(c)
                setDraftIdx(i)
              }}
              title="Edit hex value"
            >
              {c.toUpperCase()}
            </button>
          )}
          <span className="paledit-actions">
            <button
              className="iconbtn"
              disabled={i === 0}
              onClick={() => move(i, -1)}
              aria-label="Move color left"
              title="Move earlier"
            >
              <ChevronLeft size={11} />
            </button>
            <button
              className="iconbtn"
              disabled={i === colors.length - 1}
              onClick={() => move(i, 1)}
              aria-label="Move color right"
              title="Move later"
            >
              <ChevronRight size={11} />
            </button>
            <button
              className="iconbtn"
              disabled={colors.length <= MIN_COLORS}
              onClick={() => onChange(colors.filter((_, j) => j !== i))}
              aria-label="Remove color"
              title="Remove color"
            >
              <X size={11} />
            </button>
          </span>
        </div>
      ))}
      <button
        className="btn btn--sm paledit-add"
        disabled={colors.length >= MAX_COLORS}
        onClick={() => onChange([...colors, '#808080'])}
      >
        <Plus size={13} /> Add color
      </button>
    </div>
  )
}
