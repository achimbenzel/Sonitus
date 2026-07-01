# Sonitus — Dither Studio

A professional, browser-based image dithering app. Processes single images,
image sequences and MP4 video frames entirely client-side — no backend, no
paid APIs. Built as a clean web app (React + Vite + TypeScript) so it can be
wrapped in Electron later without changes.

![stack](https://img.shields.io/badge/react-18-5fc6e8) ![stack](https://img.shields.io/badge/vite-5-46b3cc) ![stack](https://img.shields.io/badge/typescript-strict-5aa6e6)

## Install & run

```bash
npm install
npm run dev        # dev server (Chrome recommended)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

## Architecture

The dithering engine is fully decoupled from the UI. Data flows in one
direction: source frame → downscale → worker pipeline → cached bitmap → canvas.

```
src/
├── App.tsx                     orchestrator: state, playback loop, shortcuts
├── types/                      all shared TypeScript types + defaults
├── dither/
│   ├── algorithms/
│   │   ├── kernels.ts          error-diffusion kernels (FS, JJN, Stucki, …)
│   │   ├── bayer.ts            recursive Bayer matrices (2/4/8/16)
│   │   ├── noise.ts            white noise, value noise, generated blue noise
│   │   └── index.ts            algorithm registry (UI + pipeline read this)
│   ├── palette.ts              hex utils, mono ramps, median-cut quantization
│   └── pipeline.ts             pure processing pipeline (DOM-free, testable)
├── workers/
│   ├── ditherWorker.ts         runs the pipeline off the main thread
│   └── workerPool.ts           priority queue + cancellation by settings tag
├── engine/
│   └── ProcessingEngine.ts     decode LRU, downscale, worker dispatch,
│                               byte-budgeted processed-frame cache
├── components/
│   ├── TopBar/                 project actions, undo/redo, presets, export
│   ├── Viewport/               canvas, zoom/pan, compare modes, drag&drop
│   ├── Sidebar/                import + all dither/tone/palette/export controls
│   ├── Timeline/               thumbnails, scrub, play/FPS/loop, buffer state
│   └── ProgressOverlay/        import/export progress + cancel
├── utils/
│   ├── imageLoad.ts            image/sequence import, MP4 frame extraction
│   ├── export.ts               PNG/JPEG/SVG stills, zipped PNG sequences
│   └── presets.ts              JSON preset export + validated import
├── hooks/useSettingsHistory.ts undo/redo with drag coalescing
└── styles/                     theme.css (provided design tokens) + app.css
```

**Key design decisions**

- **Pipeline is pure.** `dither/pipeline.ts` operates on plain
  `{data,width,height}` buffers with no DOM dependency, so it runs identically
  in workers and in headless tests. Adding an algorithm = one kernel/threshold
  source + one registry entry.
- **Workers own the heavy math.** A small pool (hardware-sized, max 4)
  processes frames with priorities: preview > export > timeline buffering.
  Buffers are transferred, never copied. Stale queued work is cancelled by
  settings-hash tag the moment a parameter changes.
- **Memory-bounded caches.** Source frames stay as `File`/`Blob` and are
  decoded through a small LRU; processed frames live in a byte-budgeted LRU
  (256 MB) keyed by `frameId + settingsHash`. Long sequences don't blow up
  memory, and scrubbing back over buffered frames is instant.
- **Playback buffers ahead.** While playing, upcoming frames are pre-processed
  in the background; playback stalls (with a “buffering” indicator) instead of
  dropping quality, and the buffer invalidates automatically when settings
  change.
- **Preview never blocks.** Slider changes are coalesced: one preview job in
  flight at a time, latest settings win. The UI thread only ever does a
  GPU downscale + small readback.

## Implemented features

**Viewport** — cursor-centered wheel zoom, drag pan, fit / 100% buttons,
checkerboard under transparency, compare modes (dithered / original /
draggable split with labels), hold **C** for original, drag & drop import.

**Import** — single image (PNG/JPG/JPEG), multi-file image sequences (natural
filename sort), MP4 via in-browser seek-extraction at a chosen FPS (capped at
600 frames, stored as compressed blobs), progress overlay for large imports.

**Dithering** — error diffusion (Floyd–Steinberg, JJN, Stucki, Atkinson,
Burkes, Sierra, Two-Row Sierra, Sierra Lite) with serpentine toggle; ordered
Bayer 2×2/4×4/8×8/16×16; stochastic (deterministic random threshold, generated
void-and-cluster blue noise, value noise). Resolution slider (internal
processing width), brightness / contrast / gamma / threshold / pre-blur /
invert, 2–16 grey levels, output pixel scale 1–16×.

**Palette** — mono mode with highlight/shadow color pickers + presets
(B/W, off-white/black, green/black, orange/black, blue/cream) and multi-level
ramps; image mode with median-cut palette extraction (2–32 colors).

**Timeline** — thumbnails with frame numbers, click/drag scrubbing, play/pause,
FPS input, loop toggle, buffered-frame indicators, real-time playback from the
processed-frame cache.

**Export** — PNG / JPEG / SVG stills (SVG merges horizontal runs into per-color
paths), zipped PNG sequence export with progress + cancel. All exports apply
the pixel scale multiplier.

**Presets** — full parameter set (incl. FPS/loop) exports as JSON; import is
validated field-by-field with clear error messages.

**Undo/redo** — parameter history with drag coalescing. Shortcuts: `Ctrl+Z`,
`Ctrl+Shift+Z` / `Ctrl+Y`, `Space` play/pause, `+`/`-` zoom, `0` fit,
`1` 100%, `←`/`→` frame step, hold `C` original. Shortcuts are suppressed
while typing in inputs.

## Limitations / future work

- **MP4 extraction is seek-based** (fixed FPS you choose at import), not a
  demuxer — it's codec-agnostic and reliable in Chrome, but doesn't recover
  the exact original frame timing. A WebCodecs demuxer path can be added
  behind `utils/imageLoad.ts` later.
- **Image-palette mode extracts a palette per frame**, which can flicker
  slightly across sequences; a project-wide locked palette is a natural
  extension.
- **No video export** (only PNG sequences); an ffmpeg.wasm or WebCodecs encode
  path would slot into `utils/export.ts`.
- Very large SVG exports (high resolution + noisy algorithms) can produce
  heavy files; resolution is capped at 1024 px to keep this manageable.
