/* ============================================================
   Canvas viewport: zoom (wheel, cursor-centered), pan (drag),
   fit/100% controls, checkerboard for transparency, and three
   compare modes (dithered / original / draggable split).

   The dithered bitmap is at processing resolution and is drawn
   nearest-neighbor up to the source frame's dimensions, so the
   original and dithered images stay perfectly aligned in
   compare modes.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize } from 'lucide-react'
import type { CompareMode, SourceFrame } from '../../types'
import logoUrl from '../../assets/sonitos-logo-placeholder.svg'

interface ViewportProps {
  frame: SourceFrame | null
  processed: ImageBitmap | null
  original: ImageBitmap | null
  /** True when `processed` is a pre-composited output-resolution bitmap
   *  (post-dither soften): draw it smoothly instead of nearest. */
  processedSmooth: boolean
  compare: CompareMode
  setCompare: (m: CompareMode) => void
  holdOriginal: boolean
  onDropFiles: (files: File[]) => void
}

interface View {
  zoom: number
  panX: number
  panY: number
}

const MIN_ZOOM = 0.02
const MAX_ZOOM = 64

function makeCheckerPattern(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#0c1c23'
  ctx.fillRect(0, 0, 16, 16)
  ctx.fillStyle = '#132630'
  ctx.fillRect(0, 0, 8, 8)
  ctx.fillRect(8, 8, 8, 8)
  return c
}

export function Viewport({
  frame,
  processed,
  original,
  processedSmooth,
  compare,
  setCompare,
  holdOriginal,
  onDropFiles,
}: ViewportProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const patternRef = useRef<CanvasPattern | null>(null)
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 })
  const [splitPos, setSplitPos] = useState(0.5) // 0..1 of viewport width
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [panning, setPanning] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const fittedFor = useRef<string>('')

  /* ---------- sizing ---------- */

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    if (!frame || size.w === 0 || size.h === 0) return
    const pad = 48
    const zoom = Math.min(
      (size.w - pad) / frame.width,
      (size.h - pad) / frame.height,
      8,
    )
    const z = Math.max(MIN_ZOOM, zoom)
    setView({
      zoom: z,
      panX: (size.w - frame.width * z) / 2,
      panY: (size.h - frame.height * z) / 2,
    })
  }, [frame, size])

  // Fit whenever a new frame size appears (project load / frame dims change).
  useEffect(() => {
    if (!frame) return
    const key = `${frame.width}x${frame.height}`
    if (fittedFor.current !== key && size.w > 0) {
      fittedFor.current = key
      fit()
    }
  }, [frame, size, fit])

  const setZoom100 = useCallback(() => {
    if (!frame) return
    setView({
      zoom: 1,
      panX: (size.w - frame.width) / 2,
      panY: (size.h - frame.height) / 2,
    })
  }, [frame, size])

  /* ---------- external zoom controls (keyboard) ---------- */

  const zoomBy = useCallback((factor: number) => {
    setView((v) => {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
      // zoom around viewport center
      const cx = size.w / 2
      const cy = size.h / 2
      return {
        zoom: z,
        panX: cx - ((cx - v.panX) * z) / v.zoom,
        panY: cy - ((cy - v.panY) * z) / v.zoom,
      }
    })
  }, [size])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === '+' || e.key === '=') zoomBy(1.25)
      else if (e.key === '-' || e.key === '_') zoomBy(0.8)
      else if (e.key === '0') fit()
      else if (e.key === '1' && !e.ctrlKey && !e.metaKey) setZoom100()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [zoomBy, fit, setZoom100])

  /* ---------- wheel zoom (cursor centered) ---------- */

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0016)
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor))
        return {
          zoom: z,
          panX: mx - ((mx - v.panX) * z) / v.zoom,
          panY: my - ((my - v.panY) * z) / v.zoom,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* ---------- pan drag ---------- */

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as HTMLElement
    if (target.closest('.split-divider') || target.closest('.viewport-toolbar')) return
    panStart.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY }
    setPanning(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const start = panStart.current
    if (!start) return
    setView((v) => ({
      ...v,
      panX: start.panX + (e.clientX - start.x),
      panY: start.panY + (e.clientY - start.y),
    }))
  }
  const onPointerUp = () => {
    panStart.current = null
    setPanning(false)
  }

  /* ---------- split divider drag ---------- */

  const onSplitDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    const el = wrapRef.current
    if (!el) return
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      setSplitPos(Math.min(0.98, Math.max(0.02, (ev.clientX - rect.left) / rect.width)))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /* ---------- drag & drop import ---------- */

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onDropFiles(files)
  }

  /* ---------- drawing ---------- */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    if (!frame) return

    const { zoom, panX, panY } = view
    const dw = frame.width * zoom
    const dh = frame.height * zoom

    // Checkerboard under the image area (shows through transparency).
    if (!patternRef.current) {
      patternRef.current = ctx.createPattern(makeCheckerPattern(), 'repeat')
    }
    if (patternRef.current) {
      ctx.save()
      ctx.fillStyle = patternRef.current
      ctx.fillRect(panX, panY, dw, dh)
      ctx.restore()
    }

    const drawOriginal = () => {
      if (!original) return
      ctx.save()
      ctx.imageSmoothingEnabled = zoom < 1
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(original, panX, panY, dw, dh)
      ctx.restore()
    }
    const drawDithered = () => {
      if (!processed) return
      ctx.save()
      // Crisp dither bitmaps are low-res by design → nearest neighbor.
      // Softened composites are already at output resolution → smooth.
      ctx.imageSmoothingEnabled = processedSmooth
      if (processedSmooth) ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(processed, panX, panY, dw, dh)
      ctx.restore()
    }

    const showOriginalOnly = holdOriginal || compare === 'original'
    if (showOriginalOnly) {
      drawOriginal()
    } else if (compare === 'split') {
      const splitX = splitPos * size.w
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, splitX, size.h)
      ctx.clip()
      drawOriginal()
      ctx.restore()
      ctx.save()
      ctx.beginPath()
      ctx.rect(splitX, 0, size.w - splitX, size.h)
      ctx.clip()
      drawDithered()
      ctx.restore()
    } else {
      drawDithered()
    }
  }, [frame, processed, original, processedSmooth, view, size, compare, splitPos, holdOriginal])

  const zoomPct = Math.round(view.zoom * 100)

  return (
    <div
      ref={wrapRef}
      className={`viewport${panning ? ' panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <canvas ref={canvasRef} />

      {frame && (
        <div className="viewport-toolbar">
          <div className="vp-chipgroup">
            <button className="vp-chip vp-chip--icon" onClick={fit} title="Fit / reset view (0)">
              <Maximize size={12} /> Fit
            </button>
            <button className="vp-chip" onClick={setZoom100} title="Actual pixels (1)">100%</button>
            <span className="vp-readout">{zoomPct}%</span>
          </div>
          <div className="vp-chipgroup">
            <button
              className={`vp-chip${compare === 'dithered' && !holdOriginal ? ' active' : ''}`}
              onClick={() => setCompare('dithered')}
            >
              Dithered
            </button>
            <button
              className={`vp-chip${compare === 'original' || holdOriginal ? ' active' : ''}`}
              onClick={() => setCompare('original')}
            >
              Original
            </button>
            <button
              className={`vp-chip${compare === 'split' && !holdOriginal ? ' active' : ''}`}
              onClick={() => setCompare('split')}
            >
              Split
            </button>
          </div>
        </div>
      )}

      {frame && compare === 'split' && !holdOriginal && (
        <div
          className="split-divider"
          style={{ left: `${splitPos * 100}%` }}
          onPointerDown={onSplitDown}
        >
          <span className="split-handle">◂▸</span>
          <span className="split-labels">
            <span className="split-label left">Original</span>
            <span className="split-label right">Dithered</span>
          </span>
        </div>
      )}

      {frame && (
        <span className="viewport-hint">wheel zoom · drag pan · hold C = original</span>
      )}

      {!frame && (
        <div className={`vp-empty${dragOver ? ' dragover' : ''}`}>
          <div className="vp-empty-inner">
            <img src={logoUrl} alt="" className="vp-empty-logo" />
            <span className="vp-empty-title">Sonitus Dither Studio</span>
            <p>
              Drop an image, image sequence or MP4 here
              <br />
              or use the import panel on the right
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
