/* ============================================================
   Timeline — always visible, creative-software style.

   - Canvas ruler with second/frame ticks, adaptive labels,
     keyframe diamonds and a buffered-frames strip
   - Playhead with scrub (drag anywhere on the track)
   - Zoom: Ctrl+wheel (cursor-anchored) or the zoom buttons;
     plain wheel scrolls horizontally
   - Sequences render compact tiled thumbnails under the ruler
   - Background work is signalled only by a small pulsing dot
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Diamond, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react'
import type { SourceFrame } from '../../types'
import { NumberField } from '../ui/NumberField'

const RULER_H = 42
const THUMB_H = 30
const MIN_PPF = 0.5
const MAX_PPF = 40

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
  keyframeFrames: number[]
  /** Bumped whenever cached/processed state changes (redraw trigger). */
  bufferTick: number
}

/** Largest "nice" step (1/2/5×10ⁿ frames) that keeps labels ≥ minPx apart. */
function pickLabelStep(ppf: number, minPx: number): number {
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  for (const s of steps) {
    if (s * ppf >= minPx) return s
  }
  return 1000
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
  keyframeFrames,
  bufferTick,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ppf, setPpf] = useState(8) // pixels per frame
  const [viewW, setViewW] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)
  const scrubbing = useRef(false)
  const fittedFor = useRef(-1)

  const hasSequence = frames.length > 1
  const showThumbs = hasSequence
  const contentH = RULER_H + (showThumbs ? THUMB_H + 4 : 0)
  const virtualW = Math.max(1, Math.ceil(totalFrames * ppf))

  /* ---------- sizing / initial fit ---------- */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Fit the whole timeline into view when its length changes.
  useEffect(() => {
    if (viewW === 0 || totalFrames === fittedFor.current) return
    fittedFor.current = totalFrames
    setPpf(Math.min(20, Math.max(MIN_PPF, (viewW - 16) / totalFrames)))
  }, [totalFrames, viewW])

  /* ---------- zoom ---------- */

  const zoomAt = useCallback(
    (factor: number, anchorViewportX: number) => {
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
    },
    [],
  )

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left)
      } else {
        // Editors scroll the timeline horizontally with a plain wheel.
        el.scrollLeft += e.deltaY + e.deltaX
      }
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
      const x = clientX - rect.left + el.scrollLeft
      onSeek(Math.min(totalFrames - 1, Math.max(0, Math.floor(x / ppf))))
    },
    [onSeek, ppf, totalFrames],
  )

  /* ---------- keep playhead visible while playing ---------- */

  useEffect(() => {
    const el = scrollRef.current
    if (!el || scrubbing.current) return
    const x = current * ppf
    if (x < el.scrollLeft + 8 || x > el.scrollLeft + el.clientWidth - 16) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.15)
    }
  }, [current, ppf])

  /* ---------- ruler drawing ---------- */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewW === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(viewW * dpr)
    canvas.height = Math.round(RULER_H * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, viewW, RULER_H)

    const css = getComputedStyle(document.documentElement)
    const colTick = css.getPropertyValue('--line-strong').trim() || '#2c5566'
    const colText = css.getPropertyValue('--ink-dim').trim() || '#6f8b95'
    const colTextStrong = css.getPropertyValue('--ink-soft').trim() || '#a9c4cd'
    const colAccent = css.getPropertyValue('--sky-blue').trim() || '#5fc6e8'
    const colBuffer = css.getPropertyValue('--sq-peach').trim() || '#54d6cf'

    const first = Math.max(0, Math.floor(scrollLeft / ppf))
    const last = Math.min(totalFrames - 1, Math.ceil((scrollLeft + viewW) / ppf))

    // Frame ticks (minor) when zoomed in enough to resolve them.
    if (ppf >= 4) {
      ctx.fillStyle = colTick
      for (let f = first; f <= last; f++) {
        const x = Math.round(f * ppf - scrollLeft)
        ctx.globalAlpha = f % fps === 0 ? 0 : 0.55
        ctx.fillRect(x, 16, 1, 5)
      }
      ctx.globalAlpha = 1
    }

    // Second ticks (major) with time labels.
    ctx.font = '600 8.5px "JetBrains Mono", monospace'
    ctx.textBaseline = 'top'
    // Step (in whole seconds) so that labels stay at least ~56px apart.
    const secStep = pickLabelStep(ppf * fps, 56)
    for (let s = Math.floor(first / fps); s * fps <= last + fps; s += 1) {
      if (s % secStep !== 0) continue
      const f = s * fps
      if (f > totalFrames) break
      const x = Math.round(f * ppf - scrollLeft)
      ctx.fillStyle = colTick
      ctx.fillRect(x, 12, 1, 10)
      ctx.fillStyle = colTextStrong
      ctx.fillText(`${s}s`, x + 4, 2)
    }

    // Frame-number labels between second marks when zoomed far in.
    if (ppf >= 26) {
      ctx.fillStyle = colText
      for (let f = first; f <= last; f++) {
        if (f % fps === 0) continue
        const x = Math.round(f * ppf - scrollLeft)
        ctx.fillText(String(f + 1), x + 3, 12)
      }
    }

    // Keyframe lane: diamonds.
    const kfY = 30
    ctx.fillStyle = colAccent
    for (const f of keyframeFrames) {
      if (f < first - 1 || f > last + 1) continue
      const x = f * ppf - scrollLeft + ppf / 2
      ctx.save()
      ctx.translate(x, kfY)
      ctx.rotate(Math.PI / 4)
      ctx.fillRect(-3.2, -3.2, 6.4, 6.4)
      ctx.restore()
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
  }, [viewW, scrollLeft, ppf, totalFrames, fps, keyframeFrames, frames.length, bufferedAt, bufferTick])

  /* ---------- thumbnails (tiled, compact) ---------- */

  let thumbs: JSX.Element[] | null = null
  if (showThumbs && ppf > 0) {
    const tileW = Math.max(1, Math.round(40 / ppf)) // frames per tile
    thumbs = []
    for (let f = 0; f < totalFrames; f += tileW) {
      const src = frames[Math.min(f, frames.length - 1)]
      thumbs.push(
        <img
          key={f}
          src={src.thumb}
          alt=""
          draggable={false}
          style={{ left: f * ppf, width: tileW * ppf }}
        />,
      )
    }
  }

  const timeSec = fps > 0 ? current / fps : 0
  const kfSorted = keyframeFrames
  const prevKf = [...kfSorted].reverse().find((f) => f < current)
  const nextKf = kfSorted.find((f) => f > current)

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button className="tl-play" onClick={onTogglePlay} title="Play / pause (Space)">
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>

        <span className="tl-counter" title="Frame / total · time">
          {String(current + 1).padStart(3, '0')}
          <span> / {String(totalFrames).padStart(3, '0')}</span>
          <span className="tl-time"> · {timeSec.toFixed(2)}s</span>
        </span>

        <span className="tl-field">
          FPS
          <NumberField value={fps} min={1} max={60} onChange={setFps} ariaLabel="Playback FPS" />
        </span>

        {!hasSequence ? (
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
        ) : (
          <span className="tl-field">{(totalFrames / fps).toFixed(1)}s</span>
        )}

        <label className="toggle tl-field" style={{ cursor: 'pointer' }}>
          Loop
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          <span className="track" />
        </label>

        {kfSorted.length > 0 && (
          <span className="tl-kfjump" title="Jump between keyframes">
            <button
              className="iconbtn"
              disabled={prevKf === undefined}
              onClick={() => prevKf !== undefined && onSeek(prevKf)}
              aria-label="Previous keyframe"
              title="Previous keyframe"
            >
              <ChevronLeft size={13} />
            </button>
            <Diamond size={9} className="tl-kfjump-ico" />
            <button
              className="iconbtn"
              disabled={nextKf === undefined}
              onClick={() => nextKf !== undefined && onSeek(nextKf)}
              aria-label="Next keyframe"
              title="Next keyframe"
            >
              <ChevronRight size={13} />
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
        </span>

        {/* Subtle background-work indicator — dot only, no text. */}
        <span
          className={`tl-workdot${buffering ? ' on' : ''}`}
          title={buffering ? 'Buffering frames…' : undefined}
          aria-hidden={!buffering}
        />
      </div>

      <div
        ref={scrollRef}
        className="tl-scroll"
        onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
        onPointerDown={(e) => {
          if (e.button !== 0) return
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
        <div className="tl-content" style={{ width: virtualW, height: contentH }}>
          <canvas ref={canvasRef} className="tl-ruler" style={{ width: viewW, height: RULER_H }} />
          {thumbs && <div className="tl-thumbs">{thumbs}</div>}
          <div className="tl-playhead" style={{ left: current * ppf }}>
            <span className="tl-playhead-cap" />
          </div>
        </div>
      </div>
    </div>
  )
}
