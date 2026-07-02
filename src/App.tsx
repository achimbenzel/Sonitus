import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompareMode,
  DitherSettings,
  EasingId,
  ExportKind,
  KeyframableParam,
  KeyframeMap,
  KeyframeRef,
  ProgressState,
  ProjectKind,
  SourceFrame,
} from './types'
import { DEFAULT_SETTINGS } from './types'
import { PRIORITY, ProcessingEngine } from './engine/ProcessingEngine'
import { useSettingsHistory } from './hooks/useSettingsHistory'
import {
  evaluateSettings,
  hasKeyframeAt,
  hasKeyframes,
  nextKeyframe,
  prevKeyframe,
  removeKeyframe,
  setKeyframe,
  setKeyframeEasing,
} from './keyframes/keyframes'
import { buildImageFrames, extractVideoFrames } from './utils/imageLoad'
import { exportSequence, exportStill, exportSvg, type SequenceExportHandle } from './utils/export'
import { exportGif, exportMp4 } from './utils/videoExport'
import { exportPreset, parsePreset } from './utils/presets'
import { applyUiStyle, loadUiStyle } from './themes/uiStyles'
import { TopBar } from './components/TopBar/TopBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { Viewport } from './components/Viewport/Viewport'
import { Timeline } from './components/Timeline/Timeline'
import { ProgressOverlay } from './components/ProgressOverlay/ProgressOverlay'
import { SettingsModal } from './components/modals/SettingsModal'
import { AboutModal } from './components/modals/AboutModal'
import type { KfControlProps } from './components/Sidebar/controls'

interface Toast {
  message: string
  error: boolean
}

interface ExportProgress {
  label: string
  value: number | null
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
  const [durationSeconds, setDurationSeconds] = useState(5)
  const [loop, setLoop] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [compare, setCompare] = useState<CompareMode>('dithered')
  const [holdOriginal, setHoldOriginal] = useState(false)
  const [keyframes, setKeyframes] = useState<KeyframeMap>({})
  const [selectedKf, setSelectedKf] = useState<KeyframeRef | null>(null)
  const [processed, setProcessed] = useState<ImageBitmap | null>(null)
  const [original, setOriginal] = useState<ImageBitmap | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [bufferTick, setBufferTick] = useState(0)
  const [uiStyle, setUiStyle] = useState(loadUiStyle)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const openInputRef = useRef<HTMLInputElement>(null)

  /* ---------- timeline geometry ---------- */

  // Sequences dictate the timeline length; otherwise fps × duration.
  const totalFrames =
    frames.length > 1 ? frames.length : Math.max(1, Math.round(fps * durationSeconds))

  // Keep the playhead inside the timeline when it shrinks.
  useEffect(() => {
    setCurrent((c) => Math.min(c, totalFrames - 1))
  }, [totalFrames])

  /** Timeline frame → source frame (sequences 1:1, stills repeat). */
  const sourceFrameAt = useCallback(
    (i: number): SourceFrame | null =>
      frames.length > 1 ? (frames[Math.min(i, frames.length - 1)] ?? null) : (frames[0] ?? null),
    [frames],
  )

  const frame = sourceFrameAt(current)

  /* ---------- keyframe-aware settings ---------- */

  const effSettings = useMemo(
    () => evaluateSettings(settings, keyframes, current),
    [settings, keyframes, current],
  )
  const hash = useMemo(() => engine.settingsHash(effSettings), [engine, effSettings])
  /** Cancellation generation: changes when base settings or keyframes
   *  change, but NOT when the playhead moves (buffered frames of a
   *  keyframed timeline have different hashes on purpose). */
  const generation = useMemo(
    () => engine.settingsHash(settings) + '§' + JSON.stringify(keyframes),
    [engine, settings, keyframes],
  )

  /* Refs mirroring state, for callbacks that must read latest values. */
  const stateRef = useRef({
    settings, keyframes, frames, current, hash, generation, playing, fps, loop, totalFrames,
  })
  stateRef.current = {
    settings, keyframes, frames, current, hash, generation, playing, fps, loop, totalFrames,
  }

  const settingsAt = useCallback(
    (i: number): DitherSettings =>
      evaluateSettings(stateRef.current.settings, stateRef.current.keyframes, i),
    [],
  )

  /* ---------- UI style ---------- */

  useEffect(() => {
    applyUiStyle(uiStyle)
  }, [uiStyle])

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, error })
    window.setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 4500)
  }, [])

  /* ---------- keyframe editing ---------- */

  const updateParam = useCallback(
    (param: KeyframableParam, value: number | string) => {
      const { keyframes: kfs, current: cur } = stateRef.current
      if (hasKeyframes(kfs, param)) {
        // Animated parameter: edits write a keyframe at the playhead.
        setKeyframes(setKeyframe(kfs, param, cur, value))
      } else {
        update({ [param]: value } as Partial<DitherSettings>)
      }
    },
    [update],
  )

  const toggleKf = useCallback((param: KeyframableParam) => {
    const { keyframes: kfs, current: cur, settings: base } = stateRef.current
    if (hasKeyframeAt(kfs, param, cur)) {
      setKeyframes(removeKeyframe(kfs, param, cur))
    } else {
      const value = evaluateSettings(base, kfs, cur)[param]
      setKeyframes(setKeyframe(kfs, param, cur, value))
    }
  }, [])

  const kfControl = useCallback(
    (param: KeyframableParam): KfControlProps => {
      const prev = prevKeyframe(keyframes, param, current)
      const next = nextKeyframe(keyframes, param, current)
      return {
        has: hasKeyframes(keyframes, param),
        at: hasKeyframeAt(keyframes, param, current),
        canPrev: prev !== null,
        canNext: next !== null,
        onToggle: () => toggleKf(param),
        onPrev: () => {
          if (prev !== null) setCurrent(prev)
        },
        onNext: () => {
          if (next !== null) setCurrent(next)
        },
      }
    },
    [keyframes, current, toggleKf],
  )

  const hasAnyKeyframe = useMemo(
    () => Object.values(keyframes).some((list) => (list?.length ?? 0) > 0),
    [keyframes],
  )

  // Drop a stale selection when its keyframe disappears.
  useEffect(() => {
    if (selectedKf && !hasKeyframeAt(keyframes, selectedKf.param, selectedKf.frame)) {
      setSelectedKf(null)
    }
  }, [keyframes, selectedKf])

  const setEasing = useCallback((ref: KeyframeRef, easing: EasingId) => {
    setKeyframes((kfs) => setKeyframeEasing(kfs, ref.param, ref.frame, easing))
  }, [])

  const deleteKeyframe = useCallback((ref: KeyframeRef) => {
    setKeyframes((kfs) => removeKeyframe(kfs, ref.param, ref.frame))
    setSelectedKf(null)
  }, [])

  /* ---------- preview processing (throttled, never blocks UI) ---------- */

  const previewInFlight = useRef(false)
  const previewDirty = useRef(false)

  const kickPreview = useCallback(() => {
    const { frames: fr, current: cur, hash: h, generation: gen } = stateRef.current
    const f = fr.length > 1 ? fr[Math.min(cur, fr.length - 1)] : fr[0]
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
      .getProcessed(f, settingsAt(cur), PRIORITY.PREVIEW, gen)
      .then((bmp) => {
        // Only display if this result still matches the live state.
        const now = stateRef.current
        if (now.hash === h && (now.frames.length > 1 ? now.frames[Math.min(now.current, now.frames.length - 1)] : now.frames[0])?.id === f.id) {
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
  }, [engine, settingsAt])

  useEffect(() => {
    engine.invalidatePending(generation)
    kickPreview()
  }, [engine, hash, generation, frame?.id, kickPreview])

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
    if (frames.length === 0 || totalFrames < 2) return
    const ahead = playing ? Math.max(12, Math.min(fps * 2, 48)) : 4
    for (let i = 1; i <= ahead; i++) {
      const idx = loop ? (current + i) % totalFrames : current + i
      if (idx >= totalFrames) break
      const f = sourceFrameAt(idx)
      if (!f) break
      const s = evaluateSettings(settings, keyframes, idx)
      if (!engine.isCached(f, engine.settingsHash(s))) {
        engine.getProcessed(f, s, PRIORITY.BUFFER, generation).catch(() => {})
      }
    }
  }, [engine, frames, sourceFrameAt, current, generation, settings, keyframes, playing, fps, loop, totalFrames])

  /* ---------- playback loop ---------- */

  useEffect(() => {
    if (!playing || totalFrames < 2) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      acc += now - last
      last = now
      const { fps: curFps, loop: curLoop, current: cur, frames: fr, totalFrames: total } = stateRef.current
      const frameDur = 1000 / curFps
      if (acc < frameDur) return
      const nextIdx = cur + 1 >= total ? (curLoop ? 0 : -1) : cur + 1
      if (nextIdx === -1) {
        setPlaying(false)
        return
      }
      const nextFrame = fr.length > 1 ? fr[Math.min(nextIdx, fr.length - 1)] : fr[0]
      const ready =
        !nextFrame ||
        engine.isCached(nextFrame, engine.settingsHash(settingsAt(nextIdx)))
      if (ready) {
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
  }, [playing, totalFrames, engine, settingsAt])

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

  /* New File: clear the canvas/source, keep settings + keyframes. */
  const newFile = useCallback(() => {
    if (frames.length > 0 && !window.confirm('Clear the current source?')) return
    loadFrames([], 'none')
  }, [frames.length, loadFrames])

  /* New Project: clear source AND reset every parameter + keyframes. */
  const newProject = useCallback(() => {
    if (
      (frames.length > 0 || canUndo || hasAnyKeyframe) &&
      !window.confirm('Start a new project? This clears the source and resets all settings.')
    ) {
      return
    }
    loadFrames([], 'none')
    replaceAll(DEFAULT_SETTINGS)
    setKeyframes({})
    setSelectedKf(null)
    setFps(12)
    setDurationSeconds(5)
    setLoop(true)
    setCompare('dithered')
  }, [frames.length, canUndo, hasAnyKeyframe, loadFrames, replaceAll])

  /* ---------- export ---------- */

  const exportHandle = useRef<SequenceExportHandle | null>(null)

  const handleExport = useCallback(
    async (kind: ExportKind) => {
      const { frames: fr, current: cur, totalFrames: total, fps: curFps } = stateRef.current
      const f = fr.length > 1 ? fr[Math.min(cur, fr.length - 1)] : fr[0]
      if (!f) return
      const still = settingsAt(cur)
      try {
        if (kind === 'png' || kind === 'jpeg') {
          setExportProgress({ label: `Exporting ${kind.toUpperCase()}`, value: null })
          await exportStill(engine, f, still, kind)
        } else if (kind === 'svg') {
          setExportProgress({ label: 'Exporting SVG', value: null })
          await exportSvg(engine, f, still)
        } else {
          const handle: SequenceExportHandle = { cancelled: false }
          exportHandle.current = handle
          if (kind === 'sequence') {
            setExportProgress({ label: 'Exporting sequence', value: 0 })
            await exportSequence(engine, fr, settingsAt, (v) =>
              setExportProgress({ label: 'Exporting sequence', value: v }),
            handle)
          } else if (kind === 'mp4') {
            setExportProgress({ label: 'Encoding MP4', value: 0 })
            await exportMp4({
              engine,
              frames: fr,
              totalFrames: total,
              fps: curFps,
              settingsAt,
              onProgress: (v) => setExportProgress({ label: 'Encoding MP4', value: v }),
              handle,
            })
          } else {
            setExportProgress({ label: 'Encoding GIF', value: 0 })
            await exportGif({
              engine,
              frames: fr,
              totalFrames: total,
              fps: curFps,
              settingsAt,
              onProgress: (v) => setExportProgress({ label: 'Encoding GIF', value: v }),
              handle,
            })
          }
          if (handle.cancelled) showToast('Export cancelled')
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Export failed', true)
      } finally {
        setExportProgress(null)
        exportHandle.current = null
      }
    },
    [engine, settingsAt, showToast],
  )

  const cancelExport = useCallback(() => {
    if (exportHandle.current) exportHandle.current.cancelled = true
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
        if (stateRef.current.totalFrames > 1) {
          e.preventDefault()
          togglePlay()
        }
      } else if (e.key.toLowerCase() === 'c' && !mod && !e.repeat) {
        setHoldOriginal(true)
      } else if (e.key === 'ArrowRight' && stateRef.current.totalFrames > 1) {
        setCurrent((c) => Math.min(stateRef.current.totalFrames - 1, c + 1))
      } else if (e.key === 'ArrowLeft' && stateRef.current.totalFrames > 1) {
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
      const f = sourceFrameAt(index)
      if (!f) return false
      return engine.isCached(f, engine.settingsHash(evaluateSettings(settings, keyframes, index)))
    },
    [engine, sourceFrameAt, settings, keyframes],
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
          settings={effSettings}
          update={update}
          updateParam={updateParam}
          kfControl={kfControl}
          onImportImages={importImages}
          onImportVideo={importVideo}
          onExport={handleExport}
          projectKind={projectKind}
          frameCount={frames.length}
          frameSize={frame ? { width: frame.width, height: frame.height } : null}
          exportProgress={exportProgress}
          onCancelExport={cancelExport}
        />
      </div>

      <Timeline
        frames={frames}
        totalFrames={totalFrames}
        current={current}
        onSeek={(i) => setCurrent(Math.min(totalFrames - 1, Math.max(0, i)))}
        playing={playing}
        onTogglePlay={togglePlay}
        fps={fps}
        setFps={setFps}
        durationSeconds={durationSeconds}
        setDurationSeconds={setDurationSeconds}
        loop={loop}
        setLoop={setLoop}
        bufferedAt={bufferedAt}
        buffering={buffering}
        bufferTick={bufferTick}
        keyframes={keyframes}
        selectedKf={selectedKf}
        onSelectKf={setSelectedKf}
        onSetEasing={setEasing}
        onDeleteKf={deleteKeyframe}
      />

      {progress && <ProgressOverlay progress={progress} />}
      {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.message}</div>}

      {settingsOpen && (
        <SettingsModal
          uiStyle={uiStyle}
          onSelectStyle={(id) => {
            setUiStyle(id as typeof uiStyle)
            applyUiStyle(id)
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
