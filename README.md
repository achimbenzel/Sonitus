# Sonitus — Dither Studio

A professional, browser-based image dithering app. Processes single images,
image sequences and MP4 video frames entirely client-side — no backend, no
paid APIs. Built as a clean web app (React + Vite + TypeScript) so it can be
wrapped in Electron later without changes.

**Fully offline:** all fonts (DM Sans, JetBrains Mono — bundled in
`src/assets/fonts/` with their OFL licenses), icons (lucide-react, bundled
from npm) and assets are local. The app makes zero external network requests
at runtime.

![stack](https://img.shields.io/badge/react-18-5fc6e8) ![stack](https://img.shields.io/badge/vite-5-46b3cc) ![stack](https://img.shields.io/badge/typescript-strict-5aa6e6)

## Install & run

```bash
npm install
npm run dev        # dev server (Chrome recommended)
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
```

### Desktop (Electron)

The web app doubles as a desktop app — the Electron layer lives entirely in
`electron/` and never touches the web code:

```bash
npm run electron:dev          # vite dev server + Electron window
npm run electron:start        # build, then run Electron against dist/
npm run electron:build        # package for the current platform
npm run electron:build:win    # Windows (NSIS installer)
npm run electron:build:mac    # macOS (dmg + zip)
npm run electron:build:linux  # Linux (AppImage + deb)
```

Packaging is configured in `electron-builder.yml`; app icon, appId and
macOS signing/notarization are marked with TODO comments there. The
renderer runs sandboxed with context isolation and no Node access.

## Architecture

The dithering engine is fully decoupled from the UI. Data flows in one
direction: source frame → downscale → worker pipeline → cached bitmap → canvas.

```
src/
├── App.tsx                     orchestrator: state, playback loop, shortcuts
├── types/                      all shared TypeScript types + defaults
├── assets/
│   ├── sonitos-logo-placeholder.svg   ← replace with the final logo
│   └── fonts/                  DM Sans + JetBrains Mono + OFL licenses
├── themes/uiStyles.ts          UI style registry + localStorage persistence
├── keyframes/keyframes.ts      keyframe storage, interpolation, navigation
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
│   ├── TopBar/                 desktop-style header: file/preset/history actions
│   ├── Viewport/               canvas, zoom/pan, compare modes, drag&drop
│   ├── Sidebar/                import, dither/tone/palette controls + Export section
│   ├── Timeline/               always-visible ruler timeline: ticks, playhead,
│   │                           scrub, Ctrl+wheel zoom, keyframe markers, thumbs
│   ├── ProgressOverlay/        import/export progress + cancel
│   ├── modals/                 Settings (UI styles, custom CSS) + About (licenses)
│   └── ui/                     Select, NumberField, Modal, IconButton primitives
├── utils/
│   ├── imageLoad.ts            image/sequence import, MP4 frame extraction
│   ├── export.ts               PNG/JPEG/SVG stills, zipped PNG sequences
│   ├── videoExport.ts          MP4 (WebCodecs + mp4-muxer) and GIF (gifenc)
│   └── presets.ts              JSON preset export + validated import
├── hooks/useSettingsHistory.ts undo/redo with drag coalescing
└── styles/
    ├── fonts.css               local @font-face declarations
    ├── theme.css               provided design tokens (base style)
    ├── app.css                 layout + custom controls
    └── themes.css              Light / Clean / XP style overrides
```

**UI styles:** Settings → UI style switches between Aqua Glass (default),
Aqua Light, Clean, Experience, Signal Core and Custom CSS (user CSS file).
The choice persists in localStorage; new themes are one registry entry in
`src/themes/uiStyles.ts` plus one CSS block in `src/styles/themes.css`.

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

**Color input** — unified control: swatch (opens the native eyedropper) +
validated HEX field (`#fff`, `#ff6600`, live swatch preview) with a compact
preset chip row underneath.

**Palette** — mono mode with highlight/shadow color pickers + presets
(B/W, off-white/black, green/black, orange/black, blue/cream) and multi-level
ramps; image mode with median-cut palette extraction (2–32 colors).

**Timeline** — always visible (default 12 FPS × 5 s when no sequence is
loaded), laid out like creative software: resize grip at the top edge
(height clamped + persisted), transport (skip/step/play/loop) on the left,
counter/FPS/duration centered, zoom cluster (± / px-per-second readout /
Fit) on the right. Sticky PROPERTY column with one row per keyframed
parameter (own keyframe toggle + ‹n/n› navigation), sticky ruler, per-second
gridlines, full-height playhead with knob cap, scrubbing, Ctrl+wheel
cursor-anchored zoom, vertically scrollable rows, compact tiled thumbnails.
The playhead range is [0, totalFrames]: position `totalFrames` is the exact
end (5 s × 12 fps = 60 frames, end = 5.00 s), and ruler, counter, playhead
and export all share this mapping.

**Keyframes** — animate brightness, contrast, gamma, threshold, pre-blur,
grey levels and both mono palette colors (resolution and pixel scale are
plain settings by design). Keyframes are only ever created or updated
**explicitly**: changing a parameter is a live edit (discarded when the
playhead moves); the diamond button creates a keyframe (no keyframe here),
saves the changed value (amber "dirty" state) or removes the keyframe
(unchanged). Markers can be **dragged** along their row — snapped to whole
frames, clamped to the timeline, easing preserved, overlaps refused.
Consecutive keyframes are connected by a line, and the bordered "/" · "~" ·
"□" chips below it open a per-segment easing menu (Linear, Ease In/Out/
In-Out — cubic — and Hold/Step). Numeric values interpolate through the
easing, colors interpolate in RGB, Hold steps.

**Export** — PNG / JPEG / SVG stills (SVG merges horizontal runs into
per-color paths), numbered PNG sequences (`frame_0001.png`, …, zipped — works
for imported sequences and for keyframe animations of a single image), MP4
(H.264 via WebCodecs, VP9-in-MP4 fallback), animated GIF, and CMYK
screenprint separations (four ink-coverage plates `_C/_M/_Y/_K` as PNGs in a
ZIP; naive RGB→CMYK, no ICC profile). Animated exports bake in timeline
duration, FPS, keyframes and easing, and render every frame onto one fixed
canvas (the maximum output size across the timeline) with the same
nearest-neighbor framing as the viewport — keyframed resolution/pixel scale
reads as chunkier pixels, never as a crop or zoom. Progress reports inline
in the sidebar Export section (cancellable).

**Post-dither resampling** — an optional final pipeline step (toggle +
method in the Export section): after dithering and after the pixel-scale
upscale, the enlarged dither pixels are softened/rounded (Linear / Soft /
Bleeding Soft — the latter adds a contrast pull for swollen, ink-like
shapes). Output dimensions and pattern size stay identical; with the toggle
off the result is bit-for-bit crisp. Applied identically in the viewport
preview and in PNG/JPEG, sequence, MP4, GIF and CMYK exports (SVG stays
vector-crisp). Included in presets.

**Presets** — full parameter set (incl. FPS/loop) exports as JSON with a
user-chosen name (used for the filename); import is validated field-by-field
with clear error messages and stays compatible with older, unnamed presets.

**Undo/redo** — parameter history with drag coalescing. Shortcuts: `Ctrl+Z`,
`Ctrl+Shift+Z` / `Ctrl+Y`, `Space` play/pause, `+`/`-` zoom, `0` fit,
`1` 100%, `←`/`→` frame step, hold `C` original. Shortcuts are suppressed
while typing in inputs.

## Limitations / future work

- **MP4 export needs WebCodecs H.264** (present in regular Chrome). Chromium
  builds without proprietary codecs fall back to VP9-in-MP4, which plays in
  Chrome/VLC but not in every desktop player.
- **GIF export re-quantizes each frame to ≤256 colors** — lossless for mono
  palettes, near-lossless for image-palette mode; large resolutions produce
  large files.
- **Keyframes are not yet stored in presets or undo history** — preset JSON
  covers the base parameters only, and Ctrl+Z does not revert keyframe edits.
- **CMYK separation is approximate**: the standard naive RGB→CMYK formula
  with maximum black generation, no ICC profile or dot-gain compensation.
  Fine for screenprint separations of already-dithered art; not a match for
  press-calibrated prepress output.

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
