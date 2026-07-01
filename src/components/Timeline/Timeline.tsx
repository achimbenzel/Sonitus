/* ============================================================
   Timeline: thumbnails, scrubbing, playback controls, FPS, loop
   and per-frame buffer state (teal underline = processed & cached
   for the current settings). Background work is signalled only by
   a small unobtrusive dot — no text during playback.
   ============================================================ */

import { useEffect, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import type { SourceFrame } from '../../types'
import { NumberField } from '../ui/NumberField'

interface TimelineProps {
  frames: SourceFrame[]
  current: number
  onSeek: (index: number) => void
  playing: boolean
  onTogglePlay: () => void
  fps: number
  setFps: (v: number) => void
  loop: boolean
  setLoop: (v: boolean) => void
  buffered: (index: number) => boolean
  buffering: boolean
}

export function Timeline({
  frames,
  current,
  onSeek,
  playing,
  onTogglePlay,
  fps,
  setFps,
  loop,
  setLoop,
  buffered,
  buffering,
}: TimelineProps) {
  const stripRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)

  // Keep the current frame visible while playing / scrubbing.
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const el = strip.children[current] as HTMLElement | undefined
    if (!el) return
    const left = el.offsetLeft
    const right = left + el.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left - 8
    else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = right - strip.clientWidth + 8
    }
  }, [current])

  const indexFromPointer = (e: React.PointerEvent): number => {
    const strip = stripRef.current!
    const rect = strip.getBoundingClientRect()
    const x = e.clientX - rect.left + strip.scrollLeft
    const first = strip.children[0] as HTMLElement | undefined
    if (!first) return 0
    const stepW = first.offsetWidth + 4 // gap
    return Math.min(frames.length - 1, Math.max(0, Math.floor(x / stepW)))
  }

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <button className="tl-play" onClick={onTogglePlay} title="Play / pause (Space)">
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>

        <span className="tl-counter">
          {String(current + 1).padStart(3, '0')}
          <span> / {String(frames.length).padStart(3, '0')}</span>
        </span>

        <span className="tl-field">
          FPS
          <NumberField value={fps} min={1} max={60} onChange={setFps} ariaLabel="Playback FPS" />
        </span>

        <label className="toggle tl-field" style={{ cursor: 'pointer' }}>
          Loop
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          <span className="track" />
        </label>

        {/* Subtle background-work indicator — dot only, no text. */}
        <span
          className={`tl-workdot${buffering ? ' on' : ''}`}
          title={buffering ? 'Buffering frames…' : undefined}
          aria-hidden={!buffering}
        />
      </div>

      <div
        ref={stripRef}
        className="tl-strip"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.tl-frame')) return
          scrubbing.current = true
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          onSeek(indexFromPointer(e))
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) onSeek(indexFromPointer(e))
        }}
        onPointerUp={() => {
          scrubbing.current = false
        }}
      >
        {frames.map((f, i) => (
          <button
            key={f.id}
            className={`tl-frame${i === current ? ' current' : ''}`}
            onClick={() => onSeek(i)}
            onPointerDown={(e) => {
              // Allow scrub-through when dragging across thumbnails.
              scrubbing.current = true
              ;(e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId)
              onSeek(i)
            }}
            title={f.name}
          >
            <img src={f.thumb} alt={f.name} draggable={false} />
            <span className="num">{i + 1}</span>
            {buffered(i) && <span className="buf" />}
          </button>
        ))}
      </div>
    </div>
  )
}
