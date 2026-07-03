/* ============================================================
   ColorSwatchPicker — app-styled replacement for the native
   <input type="color">:
     [swatch button] → popover with
       - saturation/value field (drag, pointer-captured)
       - hue slider (drag, pointer-captured)
       - eyedropper (EyeDropper API, when available) + live preview
       - R / G / B number inputs and validated HEX input
   The popover only closes on outside click, Escape or the swatch
   toggle — never while dragging inside it (drags are captured on
   stable elements, so re-renders can't kill them).
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Pipette } from 'lucide-react'
import { hexToRgb, rgbToHex } from '../../dither/palette'
import type { RGB } from '../../dither/palette'

interface Hsv {
  h: number // 0..360
  s: number // 0..1
  v: number // 0..1
}

function rgbToHsv([r, g, b]: RGB): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb({ h, s, v }: Hsv): RGB {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [
    Math.round((rgb[0] + m) * 255),
    Math.round((rgb[1] + m) * 255),
    Math.round((rgb[2] + m) * 255),
  ]
}

/** EyeDropper API (Chrome / Electron); absent elsewhere. */
interface EyeDropperResult {
  sRGBHex: string
}
interface EyeDropperCtor {
  new (): { open(): Promise<EyeDropperResult> }
}
const eyeDropperCtor = (window as { EyeDropper?: EyeDropperCtor }).EyeDropper

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

interface PanelProps {
  value: string
  onChange: (hex: string) => void
  /** Set while the eyedropper overlay is active (its clicks land
   *  outside the popover and must not close it). */
  onEyedropperActive: (active: boolean) => void
}

function ColorPickerPanel({ value, onChange, onEyedropperActive }: PanelProps) {
  // HSV is the working model — it keeps hue/saturation stable while the
  // value passes through greys, where RGB alone loses that information.
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(hexToRgb(value)))
  const lastEmitted = useRef(value)

  // Follow external changes (preset chips, hex field in the row) but
  // never fight our own onChange round-trip.
  useEffect(() => {
    if (value.toLowerCase() !== lastEmitted.current.toLowerCase()) {
      setHsv(rgbToHsv(hexToRgb(value)))
      lastEmitted.current = value
    }
  }, [value])

  const emit = useCallback(
    (next: Hsv) => {
      setHsv(next)
      const hex = rgbToHex(hsvToRgb(next))
      lastEmitted.current = hex
      onChange(hex)
    },
    [onChange],
  )

  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  /** Shared drag helper: capture on the (stable) element itself. */
  const beginDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    apply: (ev: { clientX: number; clientY: number }, rect: DOMRect) => void,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    apply(e, el.getBoundingClientRect())
    const move = (ev: PointerEvent) => apply(ev, el.getBoundingClientRect())
    const finish = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', finish)
      el.removeEventListener('pointercancel', finish)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', finish)
    el.addEventListener('pointercancel', finish)
  }

  const onSvDown = (e: React.PointerEvent<HTMLDivElement>) =>
    beginDrag(e, (ev, rect) => {
      emit({
        ...hsvRef.current,
        s: clamp01((ev.clientX - rect.left) / rect.width),
        v: 1 - clamp01((ev.clientY - rect.top) / rect.height),
      })
    })

  const onHueDown = (e: React.PointerEvent<HTMLDivElement>) =>
    beginDrag(e, (ev, rect) => {
      emit({
        ...hsvRef.current,
        h: clamp01((ev.clientX - rect.left) / rect.width) * 359.999,
      })
    })

  const rgb = hsvToRgb(hsv)
  const hex = rgbToHex(rgb)
  const hueColor = rgbToHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }))

  const setChannel = (i: 0 | 1 | 2, raw: string) => {
    const n = Math.round(Number(raw))
    if (!Number.isFinite(n)) return
    const next: [number, number, number] = [rgb[0], rgb[1], rgb[2]]
    next[i] = Math.min(255, Math.max(0, n))
    const nextHsv = rgbToHsv(next)
    // Preserve the current hue when the color is achromatic (grey),
    // otherwise the hue slider would jump to red.
    if (nextHsv.s === 0) nextHsv.h = hsvRef.current.h
    emit(nextHsv)
  }

  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const commitHexDraft = () => {
    if (hexDraft !== null) {
      const m = hexDraft.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
      if (m) {
        let h = m[1].toLowerCase()
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
        const nextHsv = rgbToHsv(hexToRgb(`#${h}`))
        if (nextHsv.s === 0) nextHsv.h = hsvRef.current.h
        emit(nextHsv)
      }
    }
    setHexDraft(null)
  }

  const pickWithEyedropper = async () => {
    if (!eyeDropperCtor) return
    onEyedropperActive(true)
    try {
      const result = await new eyeDropperCtor().open()
      const nextHsv = rgbToHsv(hexToRgb(result.sRGBHex))
      if (nextHsv.s === 0) nextHsv.h = hsvRef.current.h
      emit(nextHsv)
    } catch {
      /* cancelled */
    } finally {
      onEyedropperActive(false)
    }
  }

  return (
    <div className="cpick" role="dialog" aria-label="Color picker">
      {/* saturation / value field */}
      <div
        className="cpick-sv"
        style={{ backgroundColor: hueColor }}
        onPointerDown={onSvDown}
        aria-label="Saturation and brightness"
      >
        <span
          className="cpick-sv-thumb"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: hex,
          }}
        />
      </div>

      {/* eyedropper · preview · hue */}
      <div className="cpick-huerow">
        {eyeDropperCtor && (
          <button
            type="button"
            className="iconbtn cpick-eyedrop"
            title="Pick color from screen"
            aria-label="Pick color from screen"
            onClick={pickWithEyedropper}
          >
            <Pipette size={13} />
          </button>
        )}
        <span className="cpick-preview" style={{ backgroundColor: hex }} />
        <div className="cpick-hue" onPointerDown={onHueDown} aria-label="Hue">
          <span className="cpick-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </div>
      </div>

      {/* hex + RGB inputs */}
      <div className="cpick-inputs">
        <label className="cpick-field cpick-field--hex">
          <input
            type="text"
            value={hexDraft ?? hex.toUpperCase()}
            spellCheck={false}
            maxLength={7}
            aria-label="Hex value"
            onFocus={(e) => {
              setHexDraft(hex.toUpperCase())
              e.target.select()
            }}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={commitHexDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHexDraft()
              else if (e.key === 'Escape') {
                setHexDraft(null)
                ;(e.target as HTMLInputElement).blur()
                e.stopPropagation()
              }
            }}
          />
          <span>HEX</span>
        </label>
        {(['R', 'G', 'B'] as const).map((ch, i) => (
          <label className="cpick-field" key={ch}>
            <input
              type="number"
              min={0}
              max={255}
              value={rgb[i as 0 | 1 | 2]}
              aria-label={`${ch} value`}
              onChange={(e) => setChannel(i as 0 | 1 | 2, e.target.value)}
            />
            <span>{ch}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

interface ColorSwatchPickerProps {
  value: string
  disabled?: boolean
  onChange: (hex: string) => void
  ariaLabel: string
  /** Extra class for the swatch button (e.g. paledit sizing). */
  swatchClass?: string
}

/** Swatch button + managed popover. Drop-in replacement for the old
 *  hidden-native-input swatch. */
export function ColorSwatchPicker({
  value,
  disabled,
  onChange,
  ariaLabel,
  swatchClass,
}: ColorSwatchPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const eyedropperActive = useRef(false)

  // Close on outside pointerdown / Escape. The eyedropper overlay makes
  // every click "outside", so it suspends outside-closing while active.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (eyedropperActive.current) return
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="cpick-anchor" ref={rootRef}>
      <button
        type="button"
        className={`color-swatch${swatchClass ? ` ${swatchClass}` : ''}${open ? ' open' : ''}`}
        style={{ background: value }}
        disabled={disabled}
        title="Open color picker"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      {open && (
        <ColorPickerPanel
          value={value}
          onChange={onChange}
          onEyedropperActive={(active) => {
            eyedropperActive.current = active
          }}
        />
      )}
    </span>
  )
}
