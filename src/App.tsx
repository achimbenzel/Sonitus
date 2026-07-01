import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompareMode,
  ExportKind,
  ProgressState,
  ProjectKind,
  SourceFrame,
} from './types'
import { DEFAULT_SETTINGS } from './types'
import { PRIORITY, ProcessingEngine } from './engine/ProcessingEngine'
import { useSettingsHistory } from './hooks/useSettingsHistory'
import { buildImageFrames, extractVideoFrames } from './utils/imageLoad'
import { exportSequence, exportStill, exportSvg, type SequenceExportHandle } from './utils/export'
import { exportPreset, parsePreset } from './utils/presets'
import { applyUiStyle, loadUiStyle } from './themes/uiStyles'
import { TopBar } from './components/TopBar/TopBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { Viewport } from './components/Viewport/Viewport'
import { Timeline } from './components/Timeline/Timeline'
import { ProgressOverlay } from './components/ProgressOverlay/ProgressOverlay'
import { SettingsModal } from './components/modals/SettingsModal'
import { AboutModal } from './components/modals/AboutModal'

interface Toast {
  message: string
  error: boolean
}

export default function App() {
  const engineRef = useRef<ProcessingEngine | null>(null)
  if (!engineRef.current) engineRef.current = new ProcessingEngine()
  const engine = engineRef.current

  const { settings, update, replaceAll, undo, redo, canUndo, canRedo } =
    useSettingsHistory(DEFAULT_SETTINGS)

  const [frames, setFrames] = useState<SourceFrame[]>([])
  const [projectKind, setProjectKind] = useState<ProjectKind>('none')
  const [current, setCurrent] = useState(0)
  const [fps, setFps] = useState(12)
  const [loop, setLoop] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [compare, setCompare] = useState<CompareMode>('dithered')
  const [holdOriginal, setHoldOriginal] = useState(false)
  const [processed, setProcessed] = useState<ImageBitmap | null>(null)
  const [original, setOriginal] = useState<ImageBitmap | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [, setBufferTick] = useState(0)
  const [uiStyle, setUiStyle] = useState(loadUiStyle)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const openInputRef = useRef<HTMLInputElement>(null)

  const hash = useMemo(() => engine.settingsHash(settings), [engine, settings])
  const frame = frames[current] ?? null

  /* Refs mirroring state, for callbacks that must read latest values. */
  const stateRef = useRef({ settings, frames, current, hash, playing, fps, loop })
  stateRef.current = { settings, frames, current, hash, playing, fps, loop }

  /* ---------- UI style ---------- */

  useEffect(() => {
    applyUiStyle(uiStyle)
  }, [uiStyle])

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, error })
    window.setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 4500)
  }, [])

  /* ---------- preview processing (throttled, never blocks UI) ---------- */

  const previewInFlight = useRef(false)
  const previewDirty = useRef(false)

  const kickPreview = useCallback(() => {
    const { frames: fr, current: cur, settings: s, hash: h } = stateRef.current
    const f = fr[cur]
    if (!f) {
      setProcessed(null)
      return
    }
    if (previewInFlight.current) {
      previewDirty.current = true
      return
    }
    previewInFlight.current = true
    engine
      .getProcessed(f, s, PRIORITY.PREVIEW)
      .then((bmp) => {
        // Only display if this result still matches the live state.
        const now = stateRef.current
        if (now.frames[now.current]?.id === f.id && now.hash === h) {
          setProcessed(bmp)
        }
      })
      .catch(() => {})
      .finally(() => {
        previewInFlight.current = false
        if (previewDirty.current) {
          previewDirty.current = false
          kickPreview()
        }
      })
  }, [engine])

  useEffect(() => {
    engine.invalidatePending(hash)
    kickPreview()
  }, [engine, hash, frame?.id, kickPreview])

  /* ---------- original (compare) decode ---------- */

  useEffect(() => {
    if (!frame) {
      setOriginal(null)
      return
    }
    let stale = false
    engine
      .decodeSource(frame)
      .then((bmp) => {
        if (!stale) setOriginal(bmp)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [engine, frame])

  /* ---------- buffer / prefetch ahead of playback ---------- */

  useEffect(() => engine.onProcessed(() => setBufferTick((v) => v + 1)), [engine])

  useEffect(() => {
    if (frames.length < 2) return
    const ahead = playing ? Math.max(12, Math.min(fps * 2, 48)) : 4
    for (let i = 1; i <= ahead; i++) {
      const idx = loop ? (current + i) % frames.length : current + i
      if (idx >= frames.length) break
      const f = frames[idx]
      if (!engine.isCached(f, hash)) {
        engine.getProcessed(f, settings, PRIORITY.BUFFER).catch(() => {})
      }
    }
  }, [engine, frames, current, hash, settings, playing, fps, loop])

  /* ---------- playback loop ---------- */

  useEffect(() => {
    if (!playing || frames.length < 2) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      acc += now - last
      last = now
      const { fps: curFps, loop: curLoop, current: cur, frames: fr, hash: h } = stateRef.current
      const frameDur = 1000 / curFps
      if (acc < frameDur) return
      const nextIdx = cur + 1 >= fr.length ? (curLoop ? 0 : -1) : cur + 1
      if (nextIdx === -1) {
        setPlaying(false)
        return
      }
      const nextFrame = fr[nextIdx]
      if (engine.isCached(nextFrame, h)) {
        setBuffering(false)
        acc = Math.min(acc - frameDur, frameDur) // don't spiral after a stall
        setCurrent(nextIdx)
      } else {
        // Stall until workers catch up; keep the accumulator primed.
        setBuffering(true)
        acc = frameDur
      }
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      setBuffering(false)
    }
  }, [playing, frames.length, engine])

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p)
  }, [])

  /* ---------- imports ---------- */

  const loadFrames = useCallback(
    (newFrames: SourceFrame[], kind: ProjectKind) => {
      engine.clearAll()
      setPlaying(false)
      setFrames(newFrames)
      setProjectKind(kind)
      setCurrent(0)
      setProcessed(null)
      setOriginal(null)
    },
    [engine],
  )

  const importImages = useCallback(
    async (files: File[]) => {
      const valid = files.filter(
        (f) => /image\/(png|jpeg)/.test(f.type) || /\.(png|jpe?g)$/i.test(f.name),
      )
      if (valid.length === 0) {
        showToast('No PNG/JPG files found in selection', true)
        return
      }
      setProgress({ label: valid.length > 1 ? 'Importing sequence' : 'Importing image', value: 0 })
      try {
        const newFrames = await buildImageFrames(valid, (v) =>
          setProgress({ label: valid.length > 1 ? 'Importing sequence' : 'Importing image', value: v }),
        )
        loadFrames(newFrames, valid.length > 1 ? 'sequence' : 'image')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Import failed', true)
      } finally {
        setProgress(null)
      }
    },
    [loadFrames, showToast],
  )

  const importVideo = useCallback(
    async (file: File, extractFps: number) => {
      setProgress({ label: 'Extracting video frames', value: 0 })
      try {
        const newFrames = await extractVideoFrames(file, extractFps, (v) =>
          setProgress({ label: 'Extracting video frames', value: v }),
        )
        loadFrames(newFrames, 'video')
        setFps(extractFps)
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Video import failed', true)
      } finally {
        setProgress(null)
      }
    },
    [loadFrames, showToast],
  )

  const onDropFiles = useCallback(
    (files: File[]) => {
      const video = files.find((f) => f.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(f.name))
      if (video) importVideo(video, 12)
      else importImages(files)
    },
    [importImages, importVideo],
  )

  /* New File: clear the canvas/source, keep settings. */
  const newFile = useCallback(() => {
    if (frames.length > 0 && !window.confirm('Clear the current source?')) return
    loadFrames([], 'none')
  }, [frames.length, loadFrames])

  /* New Project: clear source AND reset every parameter. */
  const newProject = useCallback(() => {
    if (
      (frames.length > 0 || canUndo) &&
      !window.confirm('Start a new project? This clears the source and resets all settings.')
    ) {
      return
    }
    loadFrames([], 'none')
    replaceAll(DEFAULT_SETTINGS)
    setFps(12)
    setLoop(true)
    setCompare('dithered')
  }, [frames.length, canUndo, loadFrames, replaceAll])

  /* ---------- export ---------- */

  const seqHandle = useRef<SequenceExportHandle | null>(null)

  const handleExport = useCallback(
    async (kind: ExportKind) => {
      const { frames: fr, current: cur, settings: s } = stateRef.current
      const f = fr[cur]
      if (!f) return
      try {
        if (kind === 'png' || kind === 'jpeg') {
          setProgress({ label: `Exporting ${kind.toUpperCase()}`, value: null })
          await exportStill(engine, f, s, kind)
        } else if (kind === 'svg') {
          setProgress({ label: 'Exporting SVG', value: null })
          await exportSvg(engine, f, s)
        } else {
          const handle: SequenceExportHandle = { cancelled: false }
          seqHandle.current = handle
          setProgress({ label: 'Exporting sequence', value: 0, cancellable: true })
          await exportSequence(engine, fr, s, (v) =>
            setProgress({ label: 'Exporting sequence', value: v, cancellable: true }),
          handle)
          if (handle.cancelled) showToast('Sequence export cancelled')
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Export failed', true)
      } finally {
        setProgress(null)
        seqHandle.current = null
      }
    },
    [engine, showToast],
  )

  const cancelProgress = useCallback(() => {
    if (seqHandle.current) seqHandle.current.cancelled = true
  }, [])

  /* ---------- presets ---------- */

  const savePreset = useCallback(() => {
    const { settings: s, fps: curFps, loop: curLoop } = stateRef.current
    exportPreset(s, curFps, curLoop)
  }, [])

  const loadPreset = useCallback(
    async (file: File) => {
      try {
        const parsed = parsePreset(await file.text())
        replaceAll(parsed.settings)
        setFps(parsed.fps)
        setLoop(parsed.loop)
        showToast('Preset applied')
      } catch (err) {
        showToast(`Invalid preset: ${err instanceof Error ? err.message : 'unknown error'}`, true)
      }
    },
    [replaceAll, showToast],
  )

  /* ---------- keyboard shortcuts ---------- */

  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return (
        !!t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if ((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) {
        e.preventDefault()
        redo()
      } else if (e.key === ' ') {
        if (stateRef.current.frames.length > 1) {
          e.preventDefault()
          togglePlay()
        }
      } else if (e.key.toLowerCase() === 'c' && !mod && !e.repeat) {
        setHoldOriginal(true)
      } else if (e.key === 'ArrowRight' && stateRef.current.frames.length > 1) {
        setCurrent((c) => Math.min(stateRef.current.frames.length - 1, c + 1))
      } else if (e.key === 'ArrowLeft' && stateRef.current.frames.length > 1) {
        setCurrent((c) => Math.max(0, c - 1))
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c') setHoldOriginal(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [undo, redo, togglePlay])

  /* ---------- render ---------- */

  const bufferedAt = useCallback(
    (index: number) => {
      const f = frames[index]
      return f ? engine.isCached(f, hash) : false
    },
    [engine, frames, hash],
  )

  return (
    <div className="app">
      <TopBar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onNewFile={newFile}
        onNewProject={newProject}
        onOpen={() => openInputRef.current?.click()}
        onSavePreset={savePreset}
        onLoadPreset={loadPreset}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
      />

      {/* Header "Open / Import" — accepts images, sequences and MP4. */}
      <input
        ref={openInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,video/mp4,.png,.jpg,.jpeg,.mp4"
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onDropFiles(files)
          e.target.value = ''
        }}
      />

      <div className="app-main">
        <Viewport
          frame={frame}
          processed={processed}
          original={original}
          compare={compare}
          setCompare={setCompare}
          holdOriginal={holdOriginal}
          onDropFiles={onDropFiles}
        />
        <Sidebar
          settings={settings}
          update={update}
          onImportImages={importImages}
          onImportVideo={importVideo}
          onExport={handleExport}
          projectKind={projectKind}
          frameCount={frames.length}
          frameSize={frame ? { width: frame.width, height: frame.height } : null}
          exporting={progress !== null}
        />
      </div>

      {frames.length > 1 && (
        <Timeline
          frames={frames}
          current={current}
          onSeek={(i) => setCurrent(i)}
          playing={playing}
          onTogglePlay={togglePlay}
          fps={fps}
          setFps={setFps}
          loop={loop}
          setLoop={setLoop}
          buffered={bufferedAt}
          buffering={buffering}
        />
      )}

      {progress && <ProgressOverlay progress={progress} onCancel={cancelProgress} />}
      {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.message}</div>}

      {settingsOpen && (
        <SettingsModal
          uiStyle={uiStyle}
          onSelectStyle={(id) => {
            setUiStyle(id)
            applyUiStyle(id)
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
