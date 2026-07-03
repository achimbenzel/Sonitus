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

Packaging is configured in `electron-builder.yml`; appId and macOS
signing/notarization are marked with TODO comments there. App icons:
`build/icon.ico` is the provided Sonitus .ico (Windows), `build/icon.png`
(Linux + dev window) and `build/icon.icns` (macOS, PNG-based) are rendered
from the Sonitus logo SVG. The renderer runs sandboxed with context
isolation and no Node access.

## Architecture

The dithering engine is fully decoupled from the UI. Data flows in one
direction: source frame → downscale → worker pipeline → cached bitmap → canvas.

```
src/
├── App.tsx                     orchestrator: state, playback loop, shortcuts
├── types/                      all shared TypeScript types + defaults
├── assets/
│   ├── sonitus.svg             the Sonitus logo (black source SVG, rendered
│   │                           as a CSS mask and tinted per theme via
│   │                           --logo-color — the file itself is untouched)
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
│   └── ui/                     Select, NumberField, ColorField, ColorPicker
│                               (app-styled picker popover), Modal, IconButton,
│                               AppLogo (CSS-mask logo) primitives
├── utils/
│   ├── imageLoad.ts            image/sequence import, MP4 frame extraction
│   ├── export.ts               PNG/JPEG/SVG stills, zipped PNG sequences,
│   │                           CMYK screenprint plates
│   ├── videoExport.ts          MP4 (WebCodecs + mp4-muxer) and GIF (gifenc)
│   ├── pngMeta.ts              tEXt metadata chunks for exported PNGs
│   └── presets.ts              .sonitus preset export + validated import
├── hooks/useSettingsHistory.ts combined settings+keyframe undo/redo history
└── styles/
    ├── fonts.css               local @font-face declarations
    ├── theme.css               provided design tokens (base style)
    ├── app.css                 layout + custom controls
    └── themes.css              Light / Clean / Experience / Signal Core overrides
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

**Color input** — unified control: swatch + validated HEX field (`#fff`,
`#ff6600`, live swatch preview) with a compact preset chip row underneath.
The swatch opens a fully **app-styled color picker** popover (no native
browser picker): saturation/value field, hue slider, R/G/B and HEX inputs,
and a screen eyedropper (EyeDropper API, Chrome/Electron). It stays open
through drags and edits, follows all five UI themes, and only closes on
outside click, Escape or the swatch toggle. The same picker drives the
custom-palette editor, whose entries reorder with Move up / Move down
arrows (disabled at the ends).

**Palette** — mono mode with highlight/shadow color pickers + presets
(B/W, off-white/black, green/black, orange/black, blue/cream) and multi-level
ramps; image mode with palette extraction (2–32 colors). The image palette
has selectable **styles**: Dominant (median-cut), Average (k-means refined),
Vibrant, Muted, High contrast, and **Custom** — a full palette editor
(add/remove colors, HEX editing, reordering). Extracted palettes are computed
**once** from the first frame and cached, so sequences and animations never
flicker; the cache refreshes only when the source or the palette settings
change.

**Color mapping** — two interpretation modes affecting every output
(viewport, stills, sequences, MP4/GIF, CMYK): **Current (Palette)** — the
default perceptual mapping onto the mono ramp or extracted palette — and
**Legacy (RGB Levels)**, faithful to the original Ditherstudio prototype:
Rec.601 luminance with the tone bias applied at quantization for mono, and
independent per-channel RGB level quantization for color. Stored in presets;
older presets load with the current mapping.

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
Keyframe timing is **FPS-independent**: the authoritative position is the
time in seconds (the frame number is derived), so a keyframe at 2.5 s stays
at 2.5 s when the project FPS changes — frames are re-snapped to the new
grid (colliding keyframes deduped) and the whole undo history is remapped
consistently.
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

**PNG metadata** — every exported PNG (stills, sequence frames, CMYK
plates) is stamped with standard `tEXt` chunks (`Software: Sonitus`,
`Creator Tool: Sonitus`, `Description: Created with Sonitus`), written by a
small dependency-free chunk injector (`utils/pngMeta.ts`); files stay valid
for common viewers and design tools.

**Presets** — full parameter set (incl. FPS/loop, color mapping, palette
style and custom palette) exports as a **`.sonitus`** file (plain JSON
inside) with a user-chosen name (used for the filename); import accepts
`.sonitus` and legacy `.json` presets, is validated field-by-field with
clear error messages and stays compatible with older presets — missing
fields fall back to safe defaults, removed fields (e.g. the old resampling
options) are ignored, and the derived image palette is never persisted.

**Undo/redo** — one combined history for parameters **and** keyframes:
adding/removing/moving a keyframe, value saves and easing changes all undo
with `Ctrl+Z`, and a marker drag collapses into a single undo step (drag
coalescing). Shortcuts: `Ctrl+Z`,
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
- **Keyframes are not stored in presets** — preset JSON covers the base
  parameters, FPS and palette configuration; keyframe animation data stays
  with the session.
- **CMYK separation is approximate**: the standard naive RGB→CMYK formula
  with maximum black generation, no ICC profile or dot-gain compensation.
  Fine for screenprint separations of already-dithered art; not a match for
  press-calibrated prepress output.
- **Legacy color mapping is a faithful re-implementation, not a pixel clone**
  of the old prototype: it reproduces its math (Rec.601 luminance, bias at
  quantization, per-channel RGB levels) inside the current pipeline, so
  surrounding features (pre-blur, exports) still apply.
- **Extracted image palettes come from the first frame** of a sequence (by
  design, to keep colors stable across frames); if a later frame introduces
  entirely new colors they map to the nearest existing palette entry — use a
  larger palette size or a custom palette in that case.
- **Changing FPS re-snaps keyframes to the new frame grid**; at lower FPS two
  keyframes can land on the same frame, in which case the later one wins
  (deduped deterministically).
- **macOS icon is a PNG-based `.icns`** (256 + 512 px entries rendered from
  the logo SVG) — accepted by macOS, but a designed multi-size `.icns` can
  replace `build/icon.icns` any time; Windows uses the provided multi-size
  `.ico` directly.
- **PNG metadata uses `tEXt` chunks** (the PNG-native standard read by
  exiftool, GIMP, ImageMagick etc.); full XMP metadata blocks are not
  written. JPEG/SVG/MP4/GIF exports carry no metadata.
- **The screen eyedropper needs the EyeDropper API** (Chrome and Electron
  have it); in browsers without it the button simply isn't shown.
- **MP4 extraction is seek-based** (fixed FPS you choose at import), not a
  demuxer — it's codec-agnostic and reliable in Chrome, but doesn't recover
  the exact original frame timing. A WebCodecs demuxer path can be added
  behind `utils/imageLoad.ts` later.
- Very large SVG exports (high resolution + noisy algorithms) can produce
  heavy files; resolution is capped at 1024 px to keep this manageable.
