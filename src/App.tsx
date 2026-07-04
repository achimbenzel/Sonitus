import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CompareMode,
  DitherSettings,
  EasingId,
  ExportKind,
  KeyframableParam,
  KeyframeRef,
  ProgressState,
  ProjectKind,
  SourceFrame,
} from './types'
import { DEFAULT_SETTINGS } from './types'
import { PRIORITY, ProcessingEngine } from './engine/ProcessingEngine'
import { useProjectHistory } from './hooks/useSettingsHistory'
import {
  evaluateSettings,
  hasKeyframeAt,
  hasKeyframes,
  moveKeyframe,
  nextKeyframe,
  prevKeyframe,
  remapKeyframesToFps,
  removeKeyframe,
  setKeyframe,
  setKeyframeEasing,
} from './keyframes/keyframes'
import { generatePalette, rgbToHex } from './dither/palette'
import { buildImageFrames, decodeAnimatedImage, extractVideoFrames } from './utils/imageLoad'
import { exportPaletteFile, mergePalettes, parsePaletteFile } from './utils/palettes'
import { exportCmykPlates, exportStill, exportSvg, type SequenceExportHandle } from './utils/export'
import { exportGif, exportMp4, exportPngSequence } from './utils/videoExport'
import { exportPreset, parsePreset } from './utils/presets'
import { applyUiStyle, loadUiStyle } from './themes/uiStyles'
import { TopBar } from './components/TopBar/TopBar'
import { Sidebar } from './components/Sidebar/Sidebar'
import { Viewport } from './components/Viewport/Viewport'
import { Timeline } from './components/Timeline/Timeline'
import { ProgressOverlay } from './components/ProgressOverlay/ProgressOverlay'
import { SettingsModal } from './components/modals/SettingsModal'
import { AboutModal } from './components/modals/AboutModal'
import { NameModal } from './components/modals/NameModal'
import { ConfirmModal } from './components/modals/ConfirmModal'
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

  const {
    settings,
    keyframes,
    update,
    updateKeyframes,
    replaceAll,
    transformKeyframes,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProjectHistory(DEFAULT_SETTINGS)

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
  const [selectedKf, setSelectedKf] = useState<KeyframeRef | null>(null)
  /** Cached image palette shared by all frames (prevents flicker). */
  const [imagePalette, setImagePalette] = useState<string[] | null>(null)
  const [processed, setProcessed] = useState<ImageBitmap | null>(null)
  const [original, setOriginal] = useState<ImageBitmap | null>(null)
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [bufferTick, setBufferTick] = useState(0)
  const [uiStyle, setUiStyle] = useState(loadUiStyle)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [presetNameOpen, setPresetNameOpen] = useState(false)
  const [paletteNameOpen, setPaletteNameOpen] = useState(false)
  /** Parsed palette file waiting for the replace/merge decision. */
  const [pendingPalette, setPendingPalette] = useState<{ name: string; colors: string[] } | null>(null)
  /** Pending destructive action awaiting the styled confirm dialog. */
  const [confirmAction, setConfirmAction] = useState<'new-file' | 'new-project' | 'close' | null>(null)
  const openInputRef = useRef<HTMLInputElement>(null)

  /* ---------- timeline geometry ---------- */

  // Sequences dictate the timeline length; otherwise fps × duration.
  const totalFrames =
    frames.length > 1 ? frames.length : Math.max(1, Math.round(fps * durationSeconds))

  // Keep the playhead inside the timeline when it shrinks. The playhead
  // position range is [0, totalFrames]: position totalFrames is the exact
  // end of the timeline (e.g. 5.00s), showing the last frame's content.
  useEffect(() => {
    setCurrent((c) => Math.min(c, totalFrames))
  }, [totalFrames])

  /** Timeline frame → source frame (sequences 1:1, stills repeat). */
  const sourceFrameAt = useCallback(
    (i: number): SourceFrame | null =>
      frames.length > 1 ? (frames[Math.min(i, frames.length - 1)] ?? null) : (frames[0] ?? null),
    [frames],
  )

  const frame = sourceFrameAt(current)

  /* ---------- keyframe-aware settings ---------- */

  /** Live edits to keyframed parameters. They preview immediately but
   *  are NEVER written to a keyframe automatically — only an explicit
   *  click on the keyframe toggle stores them. Cleared whenever the
   *  playhead moves. */
  const [paramOverrides, setParamOverrides] = useState<
    Partial<Record<KeyframableParam, number | string>>
  >({})

  /** The palette is only injected when it actually drives processing. */
  const usesImagePalette = settings.paletteMode === 'image' && settings.colorMapping === 'current'
  const imagePaletteRef = useRef<string[] | null>(null)
  imagePaletteRef.current = usesImagePalette ? imagePalette : null

  const effSettings = useMemo(() => {
    const evaluated = evaluateSettings(settings, keyframes, current)
    const keys = Object.keys(paramOverrides) as KeyframableParam[]
    const out = keys.length === 0 && !imagePaletteRef.current ? evaluated : { ...evaluated }
    for (const k of keys) {
      ;(out as Record<KeyframableParam, number | string>)[k] = paramOverrides[k]!
    }
    if (imagePaletteRef.current) out.resolvedPalette = imagePaletteRef.current
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, keyframes, current, paramOverrides, imagePalette, usesImagePalette])
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
    effSettings, paramOverrides,
  })
  stateRef.current = {
    settings, keyframes, frames, current, hash, generation, playing, fps, loop, totalFrames,
    effSettings, paramOverrides,
  }

  /** All playhead moves go through here so pending live overrides are
   *  dropped and the keyframed animation takes over again. */
  const seekTo = useCallback((pos: number) => {
    setParamOverrides((o) => (Object.keys(o).length > 0 ? {} : o))
    setCurrent(pos)
  }, [])

  const settingsAt = useCallback((i: number): DitherSettings => {
    const s = evaluateSettings(stateRef.current.settings, stateRef.current.keyframes, i)
    return imagePaletteRef.current ? { ...s, resolvedPalette: imagePaletteRef.current } : s
  }, [])

  /* ---------- image palette generation (cached, no flicker) ---------- */

  const refFrame = frames[0] ?? null
  useEffect(() => {
    if (!usesImagePalette) {
      setImagePalette(null)
      return
    }
    if (settings.paletteStyle === 'custom') {
      setImagePalette(settings.customPalette.length >= 2 ? settings.customPalette : null)
      return
    }
    if (!refFrame) {
      setImagePalette(null)
      return
    }
    let stale = false
    ;(async () => {
      // Sample the first frame small — plenty for palette extraction.
      const bmp = await engine.decodeSource(refFrame)
      const pw = Math.min(160, bmp.width)
      const ph = Math.max(1, Math.round((pw * bmp.height) / bmp.width))
      const c = new OffscreenCanvas(pw, ph)
      const ctx = c.getContext('2d', { willReadFrequently: true })!
      ctx.drawImage(bmp, 0, 0, pw, ph)
      const data = ctx.getImageData(0, 0, pw, ph).data
      const count = Math.min(32, Math.max(2, Math.round(settings.paletteSize)))
      const style = settings.paletteStyle as Exclude<DitherSettings['paletteStyle'], 'custom'>
      const palette = generatePalette(data, count, style).map(rgbToHex)
      if (!stale) setImagePalette(palette)
    })().catch(() => {
      if (!stale) setImagePalette(null)
    })
    return () => {
      stale = true
    }
  }, [
    engine,
    refFrame,
    usesImagePalette,
    settings.paletteStyle,
    settings.paletteSize,
    // join → stable identity while editing other settings
    settings.customPalette.join(','),
  ])

  /* ---------- UI style ---------- */

  useEffect(() => {
    applyUiStyle(uiStyle)
  }, [uiStyle])

  const showToast = useCallback((message: string, error = false) => {
    setToast({ message, error })
    window.setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 4500)
  }, [])

  /* ---------- keyframe editing ---------- */

  /** Changing a parameter never creates or updates a keyframe.
   *  Animated params get a live override; plain params edit the base. */
  const updateParam = useCallback(
    (param: KeyframableParam, value: number | string) => {
      const { keyframes: kfs } = stateRef.current
      if (hasKeyframes(kfs, param)) {
        setParamOverrides((o) => ({ ...o, [param]: value }))
      } else {
        update({ [param]: value } as Partial<DitherSettings>)
      }
    },
    [update],
  )

  /** Explicit keyframe action:
   *  - no keyframe here      → create one with the current live value
   *  - keyframe + changed    → save the changed value into it
   *  - keyframe + unchanged  → remove it */
  const toggleKf = useCallback(
    (param: KeyframableParam) => {
      const { keyframes: kfs, current: cur, settings: base, paramOverrides: ov, fps: curFps } =
        stateRef.current
      const override = ov[param]
      if (hasKeyframeAt(kfs, param, cur)) {
        const stored = kfs[param]!.find((k) => k.frame === cur)!.value
        if (override !== undefined && override !== stored) {
          updateKeyframes(setKeyframe(kfs, param, cur, override, curFps))
        } else {
          updateKeyframes(removeKeyframe(kfs, param, cur))
        }
      } else {
        const value = override !== undefined ? override : evaluateSettings(base, kfs, cur)[param]
        updateKeyframes(setKeyframe(kfs, param, cur, value, curFps))
      }
      // The live value is now stored (or discarded with the keyframe).
      setParamOverrides((o) => {
        if (!(param in o)) return o
        const next = { ...o }
        delete next[param]
        return next
      })
    },
    [updateKeyframes],
  )

  const kfControl = useCallback(
    (param: KeyframableParam): KfControlProps => {
      const prev = prevKeyframe(keyframes, param, current)
      const next = nextKeyframe(keyframes, param, current)
      const at = hasKeyframeAt(keyframes, param, current)
      const override = paramOverrides[param]
      const stored = at ? keyframes[param]!.find((k) => k.frame === current)!.value : undefined
      return {
        has: hasKeyframes(keyframes, param),
        at,
        dirty: at && override !== undefined && override !== stored,
        canPrev: prev !== null,
        canNext: next !== null,
        onToggle: () => toggleKf(param),
        onPrev: () => {
          if (prev !== null) seekTo(prev)
        },
        onNext: () => {
          if (next !== null) seekTo(next)
        },
      }
    },
    [keyframes, current, paramOverrides, toggleKf, seekTo],
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

  const setEasing = useCallback(
    (ref: KeyframeRef, easing: EasingId) => {
      updateKeyframes(setKeyframeEasing(stateRef.current.keyframes, ref.param, ref.frame, easing))
    },
    [updateKeyframes],
  )

  const deleteKeyframe = useCallback(
    (ref: KeyframeRef) => {
      updateKeyframes(removeKeyframe(stateRef.current.keyframes, ref.param, ref.frame))
      setSelectedKf(null)
    },
    [updateKeyframes],
  )

  /** Drag-move: keeps value + easing; overlaps are refused upstream.
   *  Rapid moves during one drag coalesce into a single undo step. */
  const moveKf = useCallback(
    (param: KeyframableParam, from: number, to: number) => {
      updateKeyframes(moveKeyframe(stateRef.current.keyframes, param, from, to, stateRef.current.fps))
      setSelectedKf((sel) =>
        sel && sel.param === param && sel.frame === from ? { param, frame: to } : sel,
      )
    },
    [updateKeyframes],
  )

  /** FPS changes keep keyframes at their time positions: frame indices
   *  are recomputed everywhere (incl. undo history) without creating
   *  an undo step, so no state combination is ever inconsistent. */
  const changeFps = useCallback(
    (newFps: number) => {
      const oldFps = stateRef.current.fps
      if (newFps === oldFps) return
      transformKeyframes((kfs) => remapKeyframesToFps(kfs, oldFps, newFps))
      setSelectedKf((sel) =>
        sel ? { ...sel, frame: Math.max(0, Math.round((sel.frame / oldFps) * newFps)) } : sel,
      )
      setFps(newFps)
    },
    [transformKeyframes],
  )

  /* ---------- preview processing (throttled, never blocks UI) ---------- */

  const previewInFlight = useRef(false)
  const previewDirty = useRef(false)

  const kickPreview = useCallback(() => {
    const { frames: fr, current: cur, hash: h, generation: gen, effSettings: eff } = stateRef.current
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
      .getProcessed(f, eff, PRIORITY.PREVIEW, gen)
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
      // Position range is [0, total]; `total` is the exact end. Looping
      // wraps at the end boundary, non-loop parks the playhead on it.
      let nextPos = cur + 1
      let stopAfter = false
      if (nextPos >= total) {
        if (curLoop) {
          nextPos = 0 // looped playback wraps at the end boundary
        } else if (cur >= total) {
          setPlaying(false)
          return
        } else {
          nextPos = total
          stopAfter = true
        }
      }
      const contentIdx = Math.min(nextPos, total - 1)
      const nextFrame = fr.length > 1 ? fr[Math.min(contentIdx, fr.length - 1)] : fr[0]
      const ready =
        !nextFrame ||
        engine.isCached(nextFrame, engine.settingsHash(settingsAt(contentIdx)))
      if (ready) {
        setBuffering(false)
        acc = Math.min(acc - frameDur, frameDur) // don't spiral after a stall
        setCurrent(nextPos)
        if (stopAfter) setPlaying(false)
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
    setPlaying((p) => {
      // Starting playback discards pending live overrides so the
      // keyframed animation plays back exactly as stored.
      if (!p) setParamOverrides((o) => (Object.keys(o).length > 0 ? {} : o))
      return !p
    })
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
        (f) =>
          /image\/(png|jpeg|webp|bmp|gif)/.test(f.type) ||
          /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name),
      )
      if (valid.length === 0) {
        showToast('No supported image files found (PNG/JPG/WebP/BMP/GIF)', true)
        return
      }
      setProgress({ label: valid.length > 1 ? 'Importing sequence' : 'Importing image', value: 0 })
      try {
        // A single GIF/WebP may be animated: decode all frames and run
        // it on the timeline at the clip's own frame rate.
        if (valid.length === 1 && /gif|webp/i.test(valid[0].type + valid[0].name)) {
          const animated = await decodeAnimatedImage(valid[0], (v) =>
            setProgress({ label: 'Decoding animation', value: v }),
          )
          if (animated) {
            loadFrames(animated.frames, 'video')
            changeFps(animated.fps)
            if (!animated.fpsDetected) {
              showToast(`Could not read the animation speed — using ${animated.fps} fps`, true)
            }
            return
          }
        }
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
    [loadFrames, showToast, changeFps],
  )

  const importVideo = useCallback(
    async (file: File) => {
      setProgress({ label: 'Extracting video frames', value: 0 })
      try {
        // The extractor measures the video's own frame rate and samples
        // at exactly that rate — the timeline then matches the source.
        const result = await extractVideoFrames(file, (v) =>
          setProgress({ label: 'Extracting video frames', value: v }),
        )
        loadFrames(result.frames, 'video')
        changeFps(result.fps)
        if (!result.fpsDetected) {
          showToast(`Could not detect the video frame rate — using ${result.fps} fps`, true)
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Video import failed', true)
      } finally {
        setProgress(null)
      }
    },
    [loadFrames, showToast, changeFps],
  )

  const onDropFiles = useCallback(
    (files: File[]) => {
      const video = files.find((f) => f.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(f.name))
      if (video) importVideo(video)
      else importImages(files)
    },
    [importImages, importVideo],
  )

  /* New File: clear the canvas/source, keep settings + keyframes. */
  const doNewFile = useCallback(() => {
    loadFrames([], 'none')
  }, [loadFrames])

  const newFile = useCallback(() => {
    if (frames.length > 0) setConfirmAction('new-file')
    else doNewFile()
  }, [frames.length, doNewFile])

  /* New Project: clear source AND reset every parameter + keyframes. */
  const doNewProject = useCallback(() => {
    loadFrames([], 'none')
    replaceAll({ settings: DEFAULT_SETTINGS, keyframes: {} })
    setSelectedKf(null)
    setFps(12)
    setDurationSeconds(5)
    setLoop(true)
    setCompare('dithered')
  }, [loadFrames, replaceAll])

  const newProject = useCallback(() => {
    if (frames.length > 0 || canUndo || hasAnyKeyframe) setConfirmAction('new-project')
    else doNewProject()
  }, [frames.length, canUndo, hasAnyKeyframe, doNewProject])

  /* ---------- window-close guard ----------
     With work loaded, closing must not be silent. In Electron the
     close is cancelled via beforeunload and the styled dialog below
     takes over ("save before closing"); in the plain browser the
     standard leave-page prompt appears (browsers do not allow custom
     UI at that point). */
  const workRef = useRef(false)
  workRef.current = frames.length > 0 || canUndo || hasAnyKeyframe
  const allowClose = useRef(false)
  useEffect(() => {
    const isElectron = /electron/i.test(navigator.userAgent)
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowClose.current || !workRef.current) return
      e.preventDefault()
      e.returnValue = ''
      if (isElectron) setConfirmAction('close')
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

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
        } else if (kind === 'cmyk') {
          setExportProgress({ label: 'Exporting CMYK plates', value: null })
          await exportCmykPlates(engine, f, still)
        } else {
          const handle: SequenceExportHandle = { cancelled: false }
          exportHandle.current = handle
          if (kind === 'sequence') {
            setExportProgress({ label: 'Exporting sequence', value: 0 })
            await exportPngSequence({
              engine,
              frames: fr,
              totalFrames: total,
              fps: curFps,
              settingsAt,
              onProgress: (v) => setExportProgress({ label: 'Exporting sequence', value: v }),
              handle,
            })
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

  const savePreset = useCallback(
    (name: string) => {
      const { settings: s, fps: curFps, loop: curLoop } = stateRef.current
      exportPreset(s, curFps, curLoop, name)
    },
    [],
  )

  const loadPreset = useCallback(
    async (file: File) => {
      try {
        const parsed = parsePreset(await file.text())
        replaceAll({ settings: parsed.settings, keyframes: stateRef.current.keyframes })
        changeFps(parsed.fps)
        setLoop(parsed.loop)
        showToast(`Preset "${parsed.name}" applied`)
      } catch (err) {
        showToast(`Invalid preset: ${err instanceof Error ? err.message : 'unknown error'}`, true)
      }
    },
    [replaceAll, showToast, changeFps],
  )

  /* ---------- palette files ---------- */

  /** Colors the palette file is written from: the custom palette when
   *  editing one, otherwise the currently extracted image palette. */
  const currentPaletteColors = useCallback((): string[] => {
    const s = stateRef.current.settings
    if (s.paletteStyle === 'custom') return s.customPalette
    return imagePaletteRef.current ?? s.customPalette
  }, [])

  const savePalette = useCallback(
    (name: string) => {
      const s = stateRef.current.settings
      exportPaletteFile(name, currentPaletteColors(), `${s.paletteMode}/${s.paletteStyle}`)
    },
    [currentPaletteColors],
  )

  const loadPalette = useCallback(
    async (file: File) => {
      try {
        setPendingPalette(parsePaletteFile(await file.text()))
      } catch (err) {
        showToast(`Invalid palette: ${err instanceof Error ? err.message : 'unknown error'}`, true)
      }
    },
    [showToast],
  )

  const applyPalette = useCallback(
    (colors: string[]) => {
      update({
        paletteMode: 'image',
        colorMapping: 'current',
        paletteStyle: 'custom',
        customPalette: colors.slice(0, 32),
      })
    },
    [update],
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
        seekTo(Math.min(stateRef.current.totalFrames, stateRef.current.current + 1))
      } else if (e.key === 'ArrowLeft' && stateRef.current.totalFrames > 1) {
        seekTo(Math.max(0, stateRef.current.current - 1))
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
  }, [undo, redo, togglePlay, seekTo])

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
        onSavePreset={() => setPresetNameOpen(true)}
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
          onSavePalette={() => setPaletteNameOpen(true)}
          onLoadPalette={loadPalette}
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
        onSeek={(i) => seekTo(Math.min(totalFrames, Math.max(0, i)))}
        kfControl={kfControl}
        playing={playing}
        onTogglePlay={togglePlay}
        fps={fps}
        setFps={changeFps}
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
        onMoveKf={moveKf}
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
      {presetNameOpen && (
        <NameModal
          title="Save Preset"
          note={
            <>
              Name your preset. It is saved as a <b>.sonitus</b> file (JSON inside) and the
              name is stored in the file and used as the filename.
            </>
          }
          ctaLabel="Save Preset"
          placeholder="Dither Preset"
          onSave={savePreset}
          onClose={() => setPresetNameOpen(false)}
        />
      )}
      {paletteNameOpen && (
        <NameModal
          title="Save Palette"
          note={
            <>
              Name your palette. It is saved as a <b>.sonitus-palette</b> file (JSON inside)
              containing the color list, and can be loaded back or merged later.
            </>
          }
          ctaLabel="Save Palette"
          placeholder="Sonitus Palette"
          onSave={savePalette}
          onClose={() => setPaletteNameOpen(false)}
        />
      )}
      {pendingPalette && (
        <ConfirmModal
          title="Load Palette"
          message={
            <>
              Load <b>{pendingPalette.name}</b> ({pendingPalette.colors.length} colors)?
              <b> Replace</b> switches the custom palette to these colors;
              <b> Merge</b> appends the new colors to the current palette (up to 32).
            </>
          }
          confirmLabel="Replace"
          onConfirm={() => applyPalette(pendingPalette.colors)}
          secondaryLabel="Merge"
          onSecondary={() =>
            applyPalette(mergePalettes(currentPaletteColors(), pendingPalette.colors))
          }
          onClose={() => setPendingPalette(null)}
        />
      )}
      {confirmAction === 'new-file' && (
        <ConfirmModal
          title="New File"
          message={
            <>
              This clears the current source. If you want to keep your work,
              save a preset or export the result before continuing.
            </>
          }
          confirmLabel="Clear source"
          onConfirm={doNewFile}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'new-project' && (
        <ConfirmModal
          title="New Project"
          message={
            <>
              This clears the source and resets every setting and keyframe.
              If you want to keep your work, save a preset or export the
              result before continuing.
            </>
          }
          confirmLabel="Reset project"
          onConfirm={doNewProject}
          onClose={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'close' && (
        <ConfirmModal
          title="Close Window"
          message={
            <>
              You have unsaved work. Save a preset or export the result
              before closing — closing the window discards everything.
            </>
          }
          confirmLabel="Close anyway"
          onConfirm={() => {
            allowClose.current = true
            window.close()
          }}
          onClose={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}
