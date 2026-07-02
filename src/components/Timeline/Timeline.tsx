/* ============================================================
   Timeline — creative-software layout (modelled on the
   Ditherfield reference screenshots):

   ┌ drag handle (resize) ───────────────────────────────────────┐
   ├ transport: ⏮ ◀ ▶ ▶ ⏭ ⟳ · counter/FPS/DUR (center) · zoom ─┤
   ├ PROPERTY column │ ruler with time markers ──────────────────┤
   │ Source          │ (compact thumbnails for sequences)        │
   │ ◆ Brightness ‹› │ ──◆────/────◆──────                       │
   │ ◆ Contrast   ‹› │ ◆──~──────◆────────                       │
   └──────────────────────────────────────────────────────────────┘

   Position model: the playhead lives on [0, totalFrames] where
   position `totalFrames` is the EXACT end of the timeline
   (5 s × 12 fps → 60 frames, end position = 5.00 s). Content at the
   end position is the last frame; ruler, counter and playhead all
   share this mapping, so there are no off-by-one drifts.

   - One row per keyframed parameter with its own keyframe toggle
     (create / save-changed / remove) and ‹n/n› navigation.
   - Markers sit at frame*ppf, exactly like the playhead — no drift
     when zooming or scrolling.
   - The "/" | "~" | "□" markers between keyframes open a per-segment
     easing menu (Linear / Ease In / Out / In-Out / Hold).
   - The top edge is a drag handle: resize the timeline vertically
     (clamped, persisted to localStorage).
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Diamond,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { EasingId, KeyframeMap, KeyframeRef, KeyframableParam, SourceFrame } from '../../types'
import { EASINGS, KEYFRAMABLE_PARAMS, PARAM_LABELS } from '../../keyframes/keyframes'
import { NumberField } from '../ui/NumberField'
import { kfToggleTitle, type KfControlProps } from '../Sidebar/controls'

const LABEL_W = 200
const RULER_H = 28
/** Parameter rows are two lines tall: name row + keyframe-mode chip. */
const PARAM_ROW_H = 44
const ROW_H = 26
const MIN_BODY_H = 96
const MAX_BODY_H = 420
const DEFAULT_BODY_H = 150
const BODY_H_KEY = 'sonitus.timelineHeight'
/** Extra content width so the end tick, label and playhead cap stay visible. */
const TAIL_PAD = 16
const MIN_PPF = 0.5
const MAX_PPF = 40

interface TimelineProps {
  frames: SourceFrame[]
  totalFrames: number
  /** Playhead position ∈ [0, totalFrames]; totalFrames = exact end. */
  current: number
  onSeek: (index: number) => void
  kfControl: (param: KeyframableParam) => KfControlProps
  playing: boolean
  onTogglePlay: () => void
  fps: number
  setFps: (v: number) => void
  durationSeconds: number
  setDurationSeconds: (v: number) => void
  loop: boolean
  setLoop: (v: boolean) => void
  bufferedAt: (index: number) => boolean
  buffering: boolean
  /** Bumped whenever cached/processed state changes (redraw trigger). */
  bufferTick: number
  keyframes: KeyframeMap
  selectedKf: KeyframeRef | null
  onSelectKf: (ref: KeyframeRef | null) => void
  onSetEasing: (ref: KeyframeRef, easing: EasingId) => void
  onDeleteKf: (ref: KeyframeRef) => void
  /** Move a keyframe to another frame (drag). Overlaps are refused. */
  onMoveKf: (param: KeyframableParam, from: number, to: number) => void
}

/** Largest "nice" step (1/2/5×10ⁿ) keeping labels ≥ minPx apart. */
function pickLabelStep(pxPerUnit: number, minPx: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    if (s * pxPerUnit >= minPx) return s
  }
  return 1000
}

function clampBodyH(v: number): number {
  return Math.min(MAX_BODY_H, Math.max(MIN_BODY_H, Math.round(v)))
}

function easingGlyph(easing: EasingId | undefined): string {
  if (easing === 'hold') return '□'
  if (!easing || easing === 'linear') return '/'
  return '~'
}

interface EasingMenuState {
  param: KeyframableParam
  frame: number
  left: number
  bottom: number
}

export function Timeline({
  frames,
  totalFrames,
  current,
  onSeek,
  kfControl,
  playing,
  onTogglePlay,
  fps,
  setFps,
  durationSeconds,
  setDurationSeconds,
  loop,
  setLoop,
  bufferedAt,
  buffering,
  bufferTick,
  keyframes,
  selectedKf,
  onSelectKf,
  onSetEasing,
  onDeleteKf,
  onMoveKf,
}: TimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ppf, setPpf] = useState(8) // pixels per frame
  const [viewW, setViewW] = useState(0) // ruler viewport width (excl. labels)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [bodyH, setBodyH] = useState(() => {
    const stored = Number(localStorage.getItem(BODY_H_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampBodyH(stored) : DEFAULT_BODY_H
  })
  const [easingMenu, setEasingMenu] = useState<EasingMenuState | null>(null)
  const scrubbing = useRef(false)
  const fittedFor = useRef(-1)
  /** Fresh keyframe map for drag closures (avoids stale captures). */
  const keyframesRef = useRef(keyframes)
  keyframesRef.current = keyframes
  /** Set while a keyframe drag actually moved — suppresses the click
   *  that fires right after pointerup. */
  const suppressKfClick = useRef(false)

  /* ---------- keyframe dragging (snaps to whole frames) ---------- */

  const beginKfDrag = useCallback(
    (e: React.PointerEvent, param: KeyframableParam, startFrame: number) => {
      if (e.button !== 0) return
      e.stopPropagation()
      const el = scrollRef.current
      if (!el) return
      const state = { frame: startFrame, moved: false }
      const move = (ev: PointerEvent) => {
        const rect = el.getBoundingClientRect()
        const x = ev.clientX - rect.left + el.scrollLeft - LABEL_W
        // Snap to whole frames, clamped to the timeline range.
        const target = Math.min(totalFrames, Math.max(0, Math.round(x / ppf)))
        if (target === state.frame) return
        const list = keyframesRef.current[param] ?? []
        // Refuse to land on another keyframe of the same parameter.
        if (list.some((k) => k.frame === target)) return
        onMoveKf(param, state.frame, target)
        state.frame = target
        state.moved = true
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (state.moved) {
          suppressKfClick.current = true
          onSelectKf({ param, frame: state.frame })
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [ppf, totalFrames, onMoveKf, onSelectKf],
  )

  const hasSequence = frames.length > 1
  const paramRows = KEYFRAMABLE_PARAMS.filter((p) => (keyframes[p]?.length ?? 0) > 0)
  const virtualW = Math.max(1, Math.ceil(totalFrames * ppf) + TAIL_PAD)

  /* ---------- vertical resize (drag handle at the top edge) ---------- */

  useEffect(() => {
    localStorage.setItem(BODY_H_KEY, String(bodyH))
  }, [bodyH])

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = bodyH
    const move = (ev: PointerEvent) => setBodyH(clampBodyH(startH + (startY - ev.clientY)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- sizing / fit ---------- */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(Math.max(0, el.clientWidth - LABEL_W)))
    ro.observe(el)
    setViewW(Math.max(0, el.clientWidth - LABEL_W))
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (viewW <= 0) return
    setPpf(Math.min(20, Math.max(MIN_PPF, (viewW - TAIL_PAD - 4) / totalFrames)))
    const el = scrollRef.current
    if (el) el.scrollLeft = 0
  }, [viewW, totalFrames])

  // Fit once whenever the timeline length changes.
  useEffect(() => {
    if (viewW === 0 || totalFrames === fittedFor.current) return
    fittedFor.current = totalFrames
    fit()
  }, [totalFrames, viewW, fit])

  /* ---------- zoom ---------- */

  const zoomAt = useCallback((factor: number, anchorViewportX: number) => {
    const el = scrollRef.current
    if (!el) return
    setPpf((old) => {
      const next = Math.min(MAX_PPF, Math.max(MIN_PPF, old * factor))
      if (next !== old) {
        const contentX = el.scrollLeft + anchorViewportX
        const frameAtAnchor = contentX / old
        // Keep the frame under the anchor stationary.
        requestAnimationFrame(() => {
          el.scrollLeft = frameAtAnchor * next - anchorViewportX
        })
      }
      return next
    })
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // Ctrl/⌘+wheel zooms around the cursor; plain wheel scrolls natively.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left - LABEL_W)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  /* ---------- scrub ---------- */

  const seekFromPointer = useCallback(
    (clientX: number) => {
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left + el.scrollLeft - LABEL_W
      // Clamp to [0, totalFrames]: the end boundary is a valid position.
      onSeek(Math.min(totalFrames, Math.max(0, Math.floor(x / ppf))))
    },
    [onSeek, ppf, totalFrames],
  )

  /* ---------- keep playhead visible while playing ---------- */

  useEffect(() => {
    const el = scrollRef.current
    if (!el || scrubbing.current) return
    const x = current * ppf
    const visible = el.clientWidth - LABEL_W
    if (x < el.scrollLeft + 8 || x > el.scrollLeft + visible - 16) {
      el.scrollLeft = Math.max(0, x - visible * 0.15)
    }
  }, [current, ppf])

  /* ---------- delete selected keyframe with Del/Backspace ---------- */

  useEffect(() => {
    if (!selectedKf) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      onDeleteKf(selectedKf)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedKf, onDeleteKf])

  /* ---------- easing menu (outside click / Escape closes) ---------- */

  useEffect(() => {
    if (!easingMenu) return
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.tl-easemenu')) setEasingMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEasingMenu(null)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [easingMenu])

  const openEasingMenu = (param: KeyframableParam, frame: number, target: HTMLElement) => {
    const root = rootRef.current
    if (!root) return
    const rootRect = root.getBoundingClientRect()
    const btnRect = target.getBoundingClientRect()
    setEasingMenu({
      param,
      frame,
      left: Math.min(rootRect.width - 168, Math.max(4, btnRect.left - rootRect.left - 20)),
      bottom: rootRect.bottom - btnRect.top + 6,
    })
  }

  /* ---------- ruler drawing ---------- */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewW <= 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(viewW * dpr)
    canvas.height = Math.round(RULER_H * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewW, RULER_H)

    const css = getComputedStyle(document.documentElement)
    const colTick = css.getPropertyValue('--line-strong').trim() || '#2c5566'
    const colTextStrong = css.getPropertyValue('--ink-soft').trim() || '#a9c4cd'
    const colText = css.getPropertyValue('--ink-dim').trim() || '#6f8b95'
    const colBuffer = css.getPropertyValue('--sq-peach').trim() || '#54d6cf'

    const first = Math.max(0, Math.floor(scrollLeft / ppf))
    const last = Math.min(totalFrames, Math.ceil((scrollLeft + viewW) / ppf))

    // Minor frame ticks when zoomed in enough to resolve them.
    if (ppf >= 4) {
      ctx.fillStyle = colTick
      ctx.globalAlpha = 0.5
      for (let f = first; f <= Math.min(last, totalFrames - 1); f++) {
        if (f % fps === 0) continue
        ctx.fillRect(Math.round(f * ppf - scrollLeft), RULER_H - 7, 1, 5)
      }
      ctx.globalAlpha = 1
    }

    // Second ticks with time labels (skip the end boundary; drawn below).
    ctx.font = '600 8.5px "JetBrains Mono", monospace'
    ctx.textBaseline = 'top'
    const secStep = pickLabelStep(ppf * fps, 56)
    for (let s = Math.floor(first / fps); s * fps <= last; s++) {
      if (s % secStep !== 0) continue
      const f = s * fps
      if (f >= totalFrames) break
      const x = Math.round(f * ppf - scrollLeft)
      ctx.fillStyle = colTick
      ctx.fillRect(x, RULER_H - 12, 1, 12)
      ctx.fillStyle = colTextStrong
      ctx.fillText(`${s}s`, x + 4, 3)
    }

    // The exact end boundary always gets a tick + right-aligned label,
    // so the timeline visibly ends at e.g. 5.00s — never one frame short.
    {
      const endX = Math.round(totalFrames * ppf - scrollLeft)
      if (endX >= -60 && endX <= viewW + 60) {
        ctx.fillStyle = colTick
        ctx.fillRect(endX, RULER_H - 14, 1, 14)
        const totalSec = totalFrames / fps
        const label = Number.isInteger(totalSec) ? `${totalSec}s` : `${totalSec.toFixed(2)}s`
        ctx.fillStyle = colTextStrong
        ctx.fillText(label, endX - ctx.measureText(label).width - 4, 3)
      }
    }

    // Frame-number labels when zoomed far in.
    if (ppf >= 26) {
      ctx.fillStyle = colText
      for (let f = first; f <= Math.min(last, totalFrames - 1); f++) {
        if (f % fps === 0) continue
        ctx.fillText(String(f + 1), Math.round(f * ppf - scrollLeft) + 3, RULER_H - 22)
      }
    }

    // Buffered strip along the bottom (subtle).
    if (frames.length > 0) {
      ctx.fillStyle = colBuffer
      ctx.globalAlpha = 0.75
      let runStart = -1
      const lastContent = Math.min(last, totalFrames - 1)
      for (let f = first; f <= lastContent + 1; f++) {
        const buffered = f <= lastContent && bufferedAt(f)
        if (buffered && runStart === -1) runStart = f
        if (!buffered && runStart !== -1) {
          ctx.fillRect(runStart * ppf - scrollLeft, RULER_H - 2, (f - runStart) * ppf, 2)
          runStart = -1
        }
      }
      ctx.globalAlpha = 1
    }
  }, [viewW, scrollLeft, ppf, totalFrames, fps, frames.length, bufferedAt, bufferTick])

  /* ---------- thumbnails (tiled, compact) ---------- */

  let thumbs: JSX.Element[] | null = null
  if (hasSequence && ppf > 0) {
    const tileFrames = Math.max(1, Math.round(34 / ppf)) // frames per tile
    thumbs = []
    for (let f = 0; f < totalFrames; f += tileFrames) {
      const src = frames[Math.min(f, frames.length - 1)]
      thumbs.push(
        <img
          key={f}
          src={src.thumb}
          alt=""
          draggable={false}
          style={{ left: f * ppf, width: Math.min(tileFrames, totalFrames - f) * ppf }}
        />,
      )
    }
  }

  /* ---------- per-row helpers ---------- */

  const rowNav = (param: KeyframableParam) => {
    const list = keyframes[param] ?? []
    const atOrBefore = list.filter((k) => k.frame <= current).length
    const prev = [...list].reverse().find((k) => k.frame < current)
    const next = list.find((k) => k.frame > current)
    return { list, pos: atOrBefore, prev, next }
  }

  // Vertical gridline per second across all lanes (reference style).
  const laneGrid: React.CSSProperties = {
    backgroundImage:
      'linear-gradient(90deg, color-mix(in srgb, var(--line) 65%, transparent) 1px, transparent 1px)',
    backgroundSize: `${fps * ppf}px 100%`,
  }

  const contentFrame = Math.min(current, totalFrames - 1)
  const timeNow = fps > 0 ? current / fps : 0
  const timeTotal = fps > 0 ? totalFrames / fps : 0
  const menuKf = easingMenu ? keyframes[easingMenu.param]?.find((k) => k.frame === easingMenu.frame) : null

  return (
    <div className="timeline" ref={rootRef}>
      {/* drag handle: resize the timeline vertically */}
      <div
        className="tl-resize"
        onPointerDown={onResizeStart}
        title="Drag to resize the timeline"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline"
      >
        <span />
      </div>

      {/* ---------- transport (left · center · right) ---------- */}
      <div className="timeline-controls">
        <span className="tl-group tl-group--left">
          <span className="tl-transport">
            <button className="iconbtn" onClick={() => onSeek(0)} title="Jump to start" aria-label="Jump to start">
              <SkipBack size={13} />
            </button>
            <button className="iconbtn" onClick={() => onSeek(Math.max(0, current - 1))} title="Previous frame (←)" aria-label="Previous frame">
              <ChevronLeft size={14} />
            </button>
            <button className="tl-play" onClick={onTogglePlay} title="Play / pause (Space)">
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
            </button>
            <button className="iconbtn" onClick={() => onSeek(Math.min(totalFrames, current + 1))} title="Next frame (→)" aria-label="Next frame">
              <ChevronRight size={14} />
            </button>
            <button className="iconbtn" onClick={() => onSeek(totalFrames)} title="Jump to end" aria-label="Jump to end">
              <SkipForward size={13} />
            </button>
            <button
              className={`iconbtn${loop ? ' accent' : ''}`}
              onClick={() => setLoop(!loop)}
              title={loop ? 'Loop: on' : 'Loop: off'}
              aria-label="Toggle loop"
              aria-pressed={loop}
            >
              <Repeat size={13} />
            </button>
          </span>

          {selectedKf && (
            <span className="tl-selchip" title="Selected keyframe (Del removes it)">
              <Diamond size={9} fill="currentColor" />
              {PARAM_LABELS[selectedKf.param]} @ {selectedKf.frame + 1}
              <button
                className="iconbtn"
                onClick={() => onDeleteKf(selectedKf)}
                title="Delete keyframe (Del)"
                aria-label="Delete keyframe"
              >
                <Trash2 size={12} />
              </button>
            </span>
          )}
        </span>

        <span className="tl-group tl-group--center">
          <span className="tl-counter" title="Frame / total · time / duration">
            {String(contentFrame + 1).padStart(3, '0')}
            <span> / {String(totalFrames).padStart(3, '0')}</span>
            <span className="tl-time">
              {' '}| {timeNow.toFixed(2)}s / {timeTotal.toFixed(2)}s
            </span>
          </span>
          <span className="tl-field">
            FPS
            <NumberField value={fps} min={1} max={60} onChange={setFps} ariaLabel="Playback FPS" />
          </span>
          {!hasSequence && (
            <span className="tl-field">
              DUR
              <NumberField
                value={durationSeconds}
                min={1}
                max={120}
                onChange={setDurationSeconds}
                ariaLabel="Timeline duration in seconds"
              />
              s
            </span>
          )}
        </span>

        <span className="tl-group tl-group--right">
          <span className="tl-zoom">
            <button className="iconbtn" onClick={() => zoomAt(1 / 1.4, viewW / 2)} aria-label="Zoom timeline out" title="Zoom out (Ctrl+wheel)">
              <ZoomOut size={13} />
            </button>
            <button className="iconbtn" onClick={() => zoomAt(1.4, viewW / 2)} aria-label="Zoom timeline in" title="Zoom in (Ctrl+wheel)">
              <ZoomIn size={13} />
            </button>
            <span className="tl-zoomval">{Math.round(ppf * fps)}px/s</span>
            <button className="tl-fitbtn" onClick={fit} title="Fit timeline">
              Fit
            </button>
          </span>
          {/* Subtle background-work indicator — dot only, no text. */}
          <span
            className={`tl-workdot${buffering ? ' on' : ''}`}
            title={buffering ? 'Buffering frames…' : undefined}
            aria-hidden={!buffering}
          />
        </span>
      </div>

      {/* ---------- tracks ---------- */}
      <div className="tl-body">
      <div
        ref={scrollRef}
        className="tl-scroll"
        style={{ height: bodyH }}
        onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const t = e.target as HTMLElement
          if (t.closest('.tl-kf') || t.closest('.tl-seg') || t.closest('.tl-row-label') || t.closest('.tl-corner')) return
          onSelectKf(null)
          scrubbing.current = true
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          seekFromPointer(e.clientX)
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) seekFromPointer(e.clientX)
        }}
        onPointerUp={() => {
          scrubbing.current = false
        }}
        onPointerCancel={() => {
          scrubbing.current = false
        }}
      >
        <div className="tl-content" style={{ width: LABEL_W + virtualW }}>
          {/* sticky header: corner + ruler */}
          <div className="tl-head" style={{ height: RULER_H }}>
            <div className="tl-corner">
              <span>Property</span>
              <span className="tl-corner-kf">Keyframe</span>
            </div>
            <canvas
              ref={canvasRef}
              className="tl-ruler"
              style={{ width: viewW, height: RULER_H, left: LABEL_W }}
            />
          </div>

          {/* thumbnails row (sequences only) */}
          {thumbs && (
            <div className="tl-row tl-thumbrow" style={{ height: ROW_H }}>
              <div className="tl-row-label">Source</div>
              <div className="tl-lane tl-lane--thumbs" style={laneGrid}>{thumbs}</div>
            </div>
          )}

          {/* one row per keyframed parameter */}
          {paramRows.map((param) => {
            const { list, pos, prev, next } = rowNav(param)
            const kc = kfControl(param)
            const chipText = !kc.at ? 'Set key' : kc.dirty ? 'Save key' : 'Remove'
            return (
              <div key={param} className="tl-row" style={{ height: PARAM_ROW_H }}>
                <div className="tl-row-label tl-row-label--param">
                  <div className="tl-row-line1">
                    <Diamond size={8} className="tl-rowico" fill="currentColor" />
                    <span className="tl-rowname">{PARAM_LABELS[param]}</span>
                    <span className="tl-rownav">
                      <button
                        disabled={!prev}
                        onClick={() => {
                          if (prev) {
                            onSeek(prev.frame)
                            onSelectKf({ param, frame: prev.frame })
                          }
                        }}
                        aria-label={`Previous ${PARAM_LABELS[param]} keyframe`}
                        title="Previous keyframe"
                      >
                        <ChevronLeft size={10} strokeWidth={3} />
                      </button>
                      {pos}/{list.length}
                      <button
                        disabled={!next}
                        onClick={() => {
                          if (next) {
                            onSeek(next.frame)
                            onSelectKf({ param, frame: next.frame })
                          }
                        }}
                        aria-label={`Next ${PARAM_LABELS[param]} keyframe`}
                        title="Next keyframe"
                      >
                        <ChevronRight size={10} strokeWidth={3} />
                      </button>
                    </span>
                  </div>
                  {/* keyframe-mode button on its own line, clearly bordered */}
                  <button
                    type="button"
                    className={`tl-kfchip${kc.at ? ' at' : ''}${kc.dirty ? ' dirty' : ''}`}
                    onClick={kc.onToggle}
                    title={kfToggleTitle(kc.at, kc.dirty)}
                    aria-label={`${PARAM_LABELS[param]}: ${kfToggleTitle(kc.at, kc.dirty)}`}
                  >
                    <Diamond size={8} strokeWidth={2.5} fill={kc.at ? 'currentColor' : 'none'} />
                    {chipText}
                  </button>
                </div>
                <div className="tl-lane" style={laneGrid}>
                  {/* connecting lines between consecutive keyframes */}
                  {list.slice(0, -1).map((k, i) => {
                    const b = list[i + 1]
                    return (
                      <span
                        key={`line-${k.frame}`}
                        className={`tl-kfline${k.easing === 'hold' ? ' hold' : ''}`}
                        style={{ left: k.frame * ppf, width: (b.frame - k.frame) * ppf }}
                        aria-hidden
                      />
                    )
                  })}
                  {/* per-segment easing markers between keyframe pairs */}
                  {list.slice(0, -1).map((k, i) => {
                    const b = list[i + 1]
                    const mid = ((k.frame + b.frame) / 2) * ppf
                    return (
                      <button
                        key={`seg-${k.frame}`}
                        className="tl-seg"
                        style={{ left: mid }}
                        title={`Easing: ${EASINGS.find((e) => e.id === (k.easing ?? 'linear'))?.label} — click to change`}
                        aria-label={`Easing between frames ${k.frame + 1} and ${b.frame + 1}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          openEasingMenu(param, k.frame, e.currentTarget)
                        }}
                      >
                        {easingGlyph(k.easing)}
                      </button>
                    )
                  })}
                  {/* keyframe markers, aligned exactly with the playhead grid */}
                  {list.map((k) => (
                    <button
                      key={k.frame}
                      className={`tl-kf${
                        selectedKf?.param === param && selectedKf.frame === k.frame ? ' selected' : ''
                      }${k.easing === 'hold' ? ' hold' : ''}`}
                      style={{ left: k.frame * ppf }}
                      title={`${PARAM_LABELS[param]} @ frame ${k.frame + 1} — drag to move`}
                      aria-label={`Keyframe ${PARAM_LABELS[param]} frame ${k.frame + 1}`}
                      onPointerDown={(e) => beginKfDrag(e, param, k.frame)}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (suppressKfClick.current) {
                          suppressKfClick.current = false
                          return
                        }
                        onSelectKf({ param, frame: k.frame })
                      }}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* empty state */}
          {paramRows.length === 0 && !thumbs && (
            <div className="tl-row tl-row--empty" style={{ height: ROW_H }}>
              <div className="tl-row-label tl-row-label--empty">No keyframes</div>
              <div className="tl-lane tl-lane--empty" style={laneGrid}>
                <span>Click ◇ next to a parameter to animate it</span>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Playhead as a viewport overlay: it never scrolls over the
          label column / corner panel and always spans the visible
          track height, regardless of horizontal/vertical scrolling,
          zooming or timeline resizing. */}
      {(() => {
        const x = LABEL_W + current * ppf - scrollLeft
        if (x < LABEL_W - 1 || x > LABEL_W + viewW + 1) return null
        return (
          <div className="tl-playhead" style={{ left: x }} aria-hidden>
            <span className="tl-playhead-cap" />
          </div>
        )
      })()}
      </div>

      {/* per-segment easing menu */}
      {easingMenu && (
        <div className="tl-easemenu" style={{ left: easingMenu.left, bottom: easingMenu.bottom }}>
          {EASINGS.map((e) => {
            const active = (menuKf?.easing ?? 'linear') === e.id
            return (
              <button
                key={e.id}
                className={active ? 'active' : ''}
                onClick={() => {
                  onSetEasing({ param: easingMenu.param, frame: easingMenu.frame }, e.id)
                  setEasingMenu(null)
                }}
              >
                <span className="tl-easemenu-glyph">{easingGlyph(e.id)}</span>
                {e.label}
                {active && <Check size={12} strokeWidth={2.5} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
