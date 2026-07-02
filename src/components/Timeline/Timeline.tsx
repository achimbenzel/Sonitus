/* ============================================================
   Timeline — creative-software layout (modelled on the
   Ditherfield reference):

   ┌ transport ─ play/step controls · counter · FPS/DUR · easing ┐
   ├ PROPERTY column │ ruler with time markers ──────────────────┤
   │ Source          │ (compact thumbnails for sequences)        │
   │ ◆ Brightness ‹› │ ─────◆──────────◆─────                    │
   │ ◆ Contrast   ‹› │ ──◆────────◆──────────                    │
   └──────────────────────────────────────────────────────────────┘

   - One row per keyframed parameter; rows scroll vertically,
     time scrolls horizontally — both in a single container with
     sticky header (ruler) and sticky label column.
   - The playhead spans all rows and stays visible while scrolling.
   - Clicking a keyframe selects it; the transport then shows an
     easing dropdown (Linear / Ease In / Out / In-Out / Hold) and
     a delete button for the selected keyframe.
   - Scrubbing: drag anywhere on the ruler or an empty lane spot.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
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
import { Select } from '../ui/Select'

const LABEL_W = 176
const RULER_H = 28
const ROW_H = 26
const MAX_BODY_H = 186
const MIN_PPF = 0.5
const MAX_PPF = 40

const EASING_OPTIONS = EASINGS.map((e) => ({ value: e.id, label: e.label }))

interface TimelineProps {
  frames: SourceFrame[]
  totalFrames: number
  current: number
  onSeek: (index: number) => void
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
}

/** Largest "nice" step (1/2/5×10ⁿ) keeping labels ≥ minPx apart. */
function pickLabelStep(pxPerUnit: number, minPx: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) {
    if (s * pxPerUnit >= minPx) return s
  }
  return 1000
}

function formatTime(frame: number, fps: number): string {
  const t = fps > 0 ? frame / fps : 0
  return `${t.toFixed(2)}s`
}

export function Timeline({
  frames,
  totalFrames,
  current,
  onSeek,
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
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ppf, setPpf] = useState(8) // pixels per frame
  const [viewW, setViewW] = useState(0) // ruler viewport width (excl. labels)
  const [scrollLeft, setScrollLeft] = useState(0)
  const scrubbing = useRef(false)
  const fittedFor = useRef(-1)

  const hasSequence = frames.length > 1
  const paramRows = KEYFRAMABLE_PARAMS.filter((p) => (keyframes[p]?.length ?? 0) > 0)
  const virtualW = Math.max(1, Math.ceil(totalFrames * ppf))

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
    setPpf(Math.min(20, Math.max(MIN_PPF, (viewW - 12) / totalFrames)))
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
      onSeek(Math.min(totalFrames - 1, Math.max(0, Math.floor(x / ppf))))
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
    const last = Math.min(totalFrames - 1, Math.ceil((scrollLeft + viewW) / ppf))

    // Minor frame ticks when zoomed in enough to resolve them.
    if (ppf >= 4) {
      ctx.fillStyle = colTick
      ctx.globalAlpha = 0.5
      for (let f = first; f <= last; f++) {
        if (f % fps === 0) continue
        ctx.fillRect(Math.round(f * ppf - scrollLeft), RULER_H - 7, 1, 5)
      }
      ctx.globalAlpha = 1
    }

    // Second ticks with time labels.
    ctx.font = '600 8.5px "JetBrains Mono", monospace'
    ctx.textBaseline = 'top'
    const secStep = pickLabelStep(ppf * fps, 56)
    for (let s = Math.floor(first / fps); s * fps <= last + fps; s++) {
      if (s % secStep !== 0) continue
      const f = s * fps
      if (f > totalFrames) break
      const x = Math.round(f * ppf - scrollLeft)
      ctx.fillStyle = colTick
      ctx.fillRect(x, RULER_H - 12, 1, 12)
      ctx.fillStyle = colTextStrong
      ctx.fillText(`${s}s`, x + 4, 3)
    }

    // Frame-number labels when zoomed far in.
    if (ppf >= 26) {
      ctx.fillStyle = colText
      for (let f = first; f <= last; f++) {
        if (f % fps === 0) continue
        ctx.fillText(String(f + 1), Math.round(f * ppf - scrollLeft) + 3, RULER_H - 22)
      }
    }

    // Buffered strip along the bottom (subtle).
    if (frames.length > 0) {
      ctx.fillStyle = colBuffer
      ctx.globalAlpha = 0.75
      let runStart = -1
      for (let f = first; f <= last + 1; f++) {
        const buffered = f <= last && bufferedAt(f)
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
          style={{ left: f * ppf, width: tileFrames * ppf }}
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

  const selectedList = selectedKf ? keyframes[selectedKf.param] ?? [] : []
  const selectedKeyframe = selectedKf
    ? selectedList.find((k) => k.frame === selectedKf.frame) ?? null
    : null

  return (
    <div className="timeline">
      {/* ---------- transport ---------- */}
      <div className="timeline-controls">
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
          <button className="iconbtn" onClick={() => onSeek(Math.min(totalFrames - 1, current + 1))} title="Next frame (→)" aria-label="Next frame">
            <ChevronRight size={14} />
          </button>
          <button className="iconbtn" onClick={() => onSeek(totalFrames - 1)} title="Jump to end" aria-label="Jump to end">
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

        <span className="tl-counter" title="Frame / total · time / duration">
          {String(current + 1).padStart(3, '0')}
          <span> / {String(totalFrames).padStart(3, '0')}</span>
          <span className="tl-time">
            {' '}· {formatTime(current, fps)} / {formatTime(totalFrames, fps)}
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

        {selectedKf && selectedKeyframe && (
          <span className="tl-easing">
            <Diamond size={9} className="tl-easing-ico" fill="currentColor" />
            <span className="tl-easing-label">
              {PARAM_LABELS[selectedKf.param]} @ {selectedKf.frame + 1}
            </span>
            <span className="tl-easing-select">
              <Select
                compact
                value={selectedKeyframe.easing ?? 'linear'}
                options={EASING_OPTIONS}
                onChange={(v) => onSetEasing(selectedKf, v as EasingId)}
                ariaLabel="Keyframe easing"
              />
            </span>
            <button
              className="iconbtn"
              onClick={() => onDeleteKf(selectedKf)}
              title="Delete keyframe"
              aria-label="Delete keyframe"
            >
              <Trash2 size={12} />
            </button>
          </span>
        )}

        <span className="tl-zoom">
          <button className="iconbtn" onClick={() => zoomAt(1 / 1.4, viewW / 2)} aria-label="Zoom timeline out" title="Zoom out (Ctrl+wheel)">
            <ZoomOut size={13} />
          </button>
          <button className="iconbtn" onClick={() => zoomAt(1.4, viewW / 2)} aria-label="Zoom timeline in" title="Zoom in (Ctrl+wheel)">
            <ZoomIn size={13} />
          </button>
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
      </div>

      {/* ---------- tracks ---------- */}
      <div
        ref={scrollRef}
        className="tl-scroll"
        style={{ maxHeight: MAX_BODY_H }}
        onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          const t = e.target as HTMLElement
          if (t.closest('.tl-kf') || t.closest('.tl-row-label') || t.closest('.tl-corner')) return
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
            <div className="tl-corner">Property</div>
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
              <div className="tl-lane tl-lane--thumbs">{thumbs}</div>
            </div>
          )}

          {/* one row per keyframed parameter */}
          {paramRows.map((param) => {
            const { list, pos, prev, next } = rowNav(param)
            return (
              <div key={param} className="tl-row" style={{ height: ROW_H }}>
                <div className="tl-row-label">
                  <Diamond size={8} className="tl-rowico" fill="currentColor" />
                  {PARAM_LABELS[param]}
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
                <div className="tl-lane">
                  {list.map((k) => (
                    <button
                      key={k.frame}
                      className={`tl-kf${
                        selectedKf?.param === param && selectedKf.frame === k.frame ? ' selected' : ''
                      }${k.easing === 'hold' ? ' hold' : ''}`}
                      style={{ left: k.frame * ppf + ppf / 2 }}
                      title={`${PARAM_LABELS[param]} @ frame ${k.frame + 1} · ${
                        EASINGS.find((e) => e.id === (k.easing ?? 'linear'))?.label
                      }`}
                      aria-label={`Keyframe ${PARAM_LABELS[param]} frame ${k.frame + 1}`}
                      onClick={(e) => {
                        e.stopPropagation()
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
              <div className="tl-lane tl-lane--empty">
                <span>Click ◇ next to a parameter to animate it</span>
              </div>
            </div>
          )}

          {/* playhead spans all rows */}
          <div className="tl-playhead" style={{ left: LABEL_W + current * ppf }}>
            <span className="tl-playhead-cap" />
          </div>
        </div>
      </div>
    </div>
  )
}
