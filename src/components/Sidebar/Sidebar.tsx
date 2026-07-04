import { useRef, useState } from 'react'
import { Clapperboard, Download, FileArchive, Film, FolderOpen, ImagePlus, Images, Layers, Save, X } from 'lucide-react'
import type { DitherSettings, ExportKind, KeyframableParam, ProjectKind } from '../../types'
import { DEFAULT_SETTINGS } from '../../types'
import { ALGORITHMS, isErrorDiffusion } from '../../dither/algorithms/index'
import { MONO_PRESETS } from '../../dither/palette'
import { EffectRow, Section, SelectRow, SliderRow, ToggleRow, type KfControlProps } from './controls'
import { ColorField } from '../ui/ColorField'
import { KeyframeControl } from './controls'
import { NumberField } from '../ui/NumberField'
import { PaletteEditor } from './PaletteEditor'

const DPI_PRESETS = [72, 96, 150, 200, 300, 600]

interface SidebarProps {
  /** Evaluated (keyframe-aware) settings for display. */
  settings: DitherSettings
  /** Patch non-keyframable settings (history-tracked). */
  update: (patch: Partial<DitherSettings>) => void
  /** Set a keyframable parameter (routes to keyframe or base value). */
  updateParam: (param: KeyframableParam, value: number | string) => void
  /** Keyframe UI state + actions per parameter. */
  kfControl: (param: KeyframableParam) => KfControlProps
  onImportImages: (files: File[]) => void
  /** Import an MP4/WebM — the frame rate is auto-detected. */
  onImportVideo: (file: File) => void
  /** Save the current palette as a .sonitus-palette file. */
  onSavePalette: () => void
  /** Load a .sonitus-palette file (App asks replace/merge). */
  onLoadPalette: (file: File) => void
  onExport: (kind: ExportKind) => void
  projectKind: ProjectKind
  frameCount: number
  frameSize: { width: number; height: number } | null
  /** Inline export progress (sidebar-only feedback). */
  exportProgress: { label: string; value: number | null } | null
  onCancelExport: () => void
}

const KIND_LABEL: Record<ProjectKind, string> = {
  none: 'No source',
  image: 'Single image',
  sequence: 'Image sequence',
  video: 'Video / animation',
}

/* Dropdown sections come straight from the registry's group field. */
const ALGORITHM_OPTIONS = ALGORITHMS.map((a) => ({
  value: a.id,
  label: a.label,
  group: a.group,
}))

export function Sidebar({
  settings,
  update,
  updateParam,
  kfControl,
  onImportImages,
  onImportVideo,
  onSavePalette,
  onLoadPalette,
  onExport,
  projectKind,
  frameCount,
  frameSize,
  exportProgress,
  onCancelExport,
}: SidebarProps) {
  const imageInput = useRef<HTMLInputElement>(null)
  const sequenceInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const paletteInput = useRef<HTMLInputElement>(null)
  /** True while the user works with a non-preset DPI value. */
  const [dpiCustomMode, setDpiCustomMode] = useState(false)
  const dpiIsPreset = DPI_PRESETS.includes(settings.dpi)

  const errorDiffusion = isErrorDiffusion(settings.algorithm)
  const mono = settings.paletteMode === 'mono'
  const legacyImage = !mono && settings.colorMapping === 'legacy'
  const paletteImage = !mono && settings.colorMapping === 'current'
  const exporting = exportProgress !== null

  // Processing never upscales beyond the source width.
  const effRes = frameSize ? Math.min(settings.resolution, frameSize.width) : settings.resolution
  const procHeight = frameSize
    ? Math.max(1, Math.round((effRes * frameSize.height) / frameSize.width))
    : null
  const d = DEFAULT_SETTINGS

  return (
    <aside className="sidebar">
      {/* ---------- IMPORT ---------- */}
      <Section label="Import">
        <div className="import-btns">
          <button className="btn btn--sm" onClick={() => imageInput.current?.click()}>
            <ImagePlus size={14} /> Image
          </button>
          <button className="btn btn--sm" onClick={() => sequenceInput.current?.click()}>
            <Images size={14} /> Image Sequence
          </button>
          <button className="btn btn--sm" onClick={() => videoInput.current?.click()}>
            <Film size={14} /> Video (MP4/WebM)
          </button>
        </div>
        <div className="import-meta">
          Source: <b>{KIND_LABEL[projectKind]}</b>
          {frameCount > 0 && (
            <>
              <br />
              Frames: <b>{frameCount}</b>
            </>
          )}
          {frameSize && (
            <>
              <br />
              Size: <b>{frameSize.width}×{frameSize.height}</b>
            </>
          )}
        </div>

        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/bmp,image/gif,.png,.jpg,.jpeg,.webp,.bmp,.gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportImages([f])
            e.target.value = ''
          }}
        />
        <input
          ref={sequenceInput}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) onImportImages(files)
            e.target.value = ''
          }}
        />
        <input
          ref={videoInput}
          type="file"
          accept="video/mp4,video/webm,.mp4,.webm,.mov"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportVideo(f)
            e.target.value = ''
          }}
        />
      </Section>

      {/* ---------- DITHER ---------- */}
      <Section label="Dither">
        <SelectRow
          label="Algorithm"
          value={settings.algorithm}
          options={ALGORITHM_OPTIONS}
          onChange={(v) => update({ algorithm: v as DitherSettings['algorithm'] })}
        />
        {settings.algorithm === 'screen-halftone' && (
          <SliderRow
            label="Screen angle"
            value={settings.screenAngle}
            min={0}
            max={90}
            resetValue={d.screenAngle}
            unit="°"
            onChange={(v) => update({ screenAngle: v })}
          />
        )}
        <SliderRow
          label="Resolution"
          value={settings.resolution}
          min={8}
          max={1024}
          step={8}
          resetValue={d.resolution}
          unit="px"
          onChange={(v) => update({ resolution: v })}
        />
        <ToggleRow
          label="Serpentine scan"
          checked={settings.serpentine}
          disabled={!errorDiffusion}
          onChange={(v) => update({ serpentine: v })}
        />
        <SliderRow
          label="Grey levels"
          value={settings.greyLevels}
          min={2}
          max={16}
          resetValue={d.greyLevels}
          disabled={!mono && !legacyImage}
          kf={kfControl('greyLevels')}
          onChange={(v) => updateParam('greyLevels', v)}
        />
      </Section>

      {/* ---------- TONE ---------- */}
      <Section label="Tone">
        <SliderRow
          label="Brightness"
          value={settings.brightness}
          min={-100}
          max={100}
          resetValue={d.brightness}
          kf={kfControl('brightness')}
          onChange={(v) => updateParam('brightness', v)}
        />
        <SliderRow
          label="Contrast"
          value={settings.contrast}
          min={-100}
          max={100}
          resetValue={d.contrast}
          kf={kfControl('contrast')}
          onChange={(v) => updateParam('contrast', v)}
        />
        <SliderRow
          label="Midtones / Gamma"
          value={settings.gamma}
          min={0.2}
          max={3}
          step={0.05}
          decimals={2}
          resetValue={d.gamma}
          kf={kfControl('gamma')}
          onChange={(v) => updateParam('gamma', v)}
        />
        <SliderRow
          label="Threshold"
          value={settings.threshold}
          min={-100}
          max={100}
          resetValue={d.threshold}
          kf={kfControl('threshold')}
          onChange={(v) => updateParam('threshold', v)}
        />
        <ToggleRow
          label="Invert"
          checked={settings.invert}
          onChange={(v) => update({ invert: v })}
        />
      </Section>

      {/* ---------- EFFECTS (pre-dither chain) ---------- */}
      <Section label="Effects">
        <div className="fxnote">Applied top to bottom, before dithering</div>
        <SliderRow
          label="Blur"
          value={settings.preBlur}
          min={0}
          max={10}
          step={0.5}
          decimals={1}
          unit="px"
          resetValue={d.preBlur}
          kf={kfControl('preBlur')}
          onChange={(v) => updateParam('preBlur', v)}
        />
        <EffectRow
          label="Sharpen"
          on={settings.fxSharpenOn}
          value={settings.fxSharpen}
          min={0}
          max={100}
          resetValue={d.fxSharpen}
          onToggle={(on) => update({ fxSharpenOn: on })}
          onChange={(v) => update({ fxSharpen: v })}
        />
        <EffectRow
          label="Edge boost"
          on={settings.fxEdgeOn}
          value={settings.fxEdge}
          min={0}
          max={100}
          resetValue={d.fxEdge}
          onToggle={(on) => update({ fxEdgeOn: on })}
          onChange={(v) => update({ fxEdge: v })}
        />
        <EffectRow
          label="Glow"
          on={settings.fxGlowOn}
          value={settings.fxGlow}
          min={0}
          max={100}
          resetValue={d.fxGlow}
          onToggle={(on) => update({ fxGlowOn: on })}
          onChange={(v) => update({ fxGlow: v })}
        />
        <EffectRow
          label="Noise"
          on={settings.fxNoiseOn}
          value={settings.fxNoise}
          min={0}
          max={100}
          resetValue={d.fxNoise}
          onToggle={(on) => update({ fxNoiseOn: on })}
          onChange={(v) => update({ fxNoise: v })}
        />
        <EffectRow
          label="Posterize"
          on={settings.fxPosterizeOn}
          value={settings.fxPosterize}
          min={2}
          max={16}
          unit=" levels"
          resetValue={d.fxPosterize}
          onToggle={(on) => update({ fxPosterizeOn: on })}
          onChange={(v) => update({ fxPosterize: v })}
        />
        <EffectRow
          label="Contrast boost"
          on={settings.fxContrastOn}
          value={settings.fxContrast}
          min={0}
          max={100}
          resetValue={d.fxContrast}
          onToggle={(on) => update({ fxContrastOn: on })}
          onChange={(v) => update({ fxContrast: v })}
        />
      </Section>

      {/* ---------- PALETTE ---------- */}
      <Section label="Palette">
        <SelectRow
          label="Palette mode"
          value={settings.paletteMode}
          options={[
            { value: 'mono', label: 'Mono color' },
            { value: 'image', label: 'Image colors' },
          ]}
          onChange={(v) => update({ paletteMode: v as DitherSettings['paletteMode'] })}
        />
        <SelectRow
          label="Color mapping"
          value={settings.colorMapping}
          options={[
            { value: 'current', label: 'Current (Palette)' },
            { value: 'legacy', label: 'Legacy (RGB Levels)' },
          ]}
          onChange={(v) => update({ colorMapping: v as DitherSettings['colorMapping'] })}
        />

        <ColorField
          label="Highlight"
          value={settings.lightColor}
          disabled={!mono}
          onChange={(v) => updateParam('lightColor', v)}
          headSlot={<KeyframeControl {...kfControl('lightColor')} />}
        />
        <ColorField
          label="Shadow"
          value={settings.darkColor}
          disabled={!mono}
          onChange={(v) => updateParam('darkColor', v)}
          headSlot={<KeyframeControl {...kfControl('darkColor')} />}
        />

        <div className={`control${mono ? '' : ' disabled'}`}>
          <div className="control-head">
            <span className="control-label">Duotone presets</span>
          </div>
          <div className="swatch-row">
            {MONO_PRESETS.map((p) => (
              <button
                key={p.name}
                className="swatch"
                title={p.name}
                onClick={() => {
                  updateParam('lightColor', p.light)
                  updateParam('darkColor', p.dark)
                }}
              >
                <span className="sw-a" style={{ background: p.light }} />
                <span className="sw-b" style={{ background: p.dark }} />
              </button>
            ))}
          </div>
        </div>

        <SelectRow
          label="Image palette"
          value={settings.paletteStyle}
          disabled={!paletteImage}
          options={[
            { value: 'dominant', label: 'Dominant colors' },
            { value: 'average', label: 'Average colors' },
            { value: 'vibrant', label: 'Vibrant colors' },
            { value: 'muted', label: 'Muted colors' },
            { value: 'contrast', label: 'High contrast' },
            { value: 'custom', label: 'Custom palette' },
          ]}
          onChange={(v) => update({ paletteStyle: v as DitherSettings['paletteStyle'] })}
        />
        <SliderRow
          label="Palette size"
          value={settings.paletteSize}
          min={2}
          max={32}
          resetValue={d.paletteSize}
          disabled={!paletteImage || settings.paletteStyle === 'custom'}
          unit=" colors"
          onChange={(v) => update({ paletteSize: v })}
        />
        {paletteImage && settings.paletteStyle === 'custom' && (
          <PaletteEditor
            colors={settings.customPalette}
            onChange={(next) => update({ customPalette: next })}
          />
        )}
        {paletteImage && (
          <div className="export-btns" style={{ marginTop: 4 }}>
            <button
              className="btn btn--sm"
              onClick={onSavePalette}
              title="Save the current palette as a .sonitus-palette file"
            >
              <Save size={13} /> Save palette
            </button>
            <button
              className="btn btn--sm"
              onClick={() => paletteInput.current?.click()}
              title="Load a .sonitus-palette file (replace or merge)"
            >
              <FolderOpen size={13} /> Load palette
            </button>
            <input
              ref={paletteInput}
              type="file"
              accept=".sonitus-palette,.json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onLoadPalette(f)
                e.target.value = ''
              }}
            />
          </div>
        )}
      </Section>

      {/* ---------- EXPORT ---------- */}
      <Section label="Export">
        <SliderRow
          label="Pixel scale"
          value={settings.pixelScale}
          min={1}
          max={16}
          resetValue={d.pixelScale}
          unit="×"
          onChange={(v) => update({ pixelScale: v })}
        />
        <SelectRow
          label="Print DPI"
          value={dpiIsPreset && !dpiCustomMode ? String(settings.dpi) : 'custom'}
          options={[
            ...DPI_PRESETS.map((v) => ({ value: String(v), label: `${v} DPI` })),
            { value: 'custom', label: 'Custom…' },
          ]}
          onChange={(v) => {
            if (v === 'custom') {
              setDpiCustomMode(true)
            } else {
              setDpiCustomMode(false)
              update({ dpi: Number(v) })
            }
          }}
        />
        {(dpiCustomMode || !dpiIsPreset) && (
          <div className="inline-field">
            <span className="control-label">Custom DPI</span>
            <NumberField
              value={settings.dpi}
              min={10}
              max={1200}
              onChange={(v) => update({ dpi: v })}
              ariaLabel="Custom DPI"
            />
          </div>
        )}
        <div className="import-meta" style={{ marginTop: 0 }}>
          Output size: <b>
            {frameSize
              ? `${effRes * settings.pixelScale}×${(procHeight ?? 0) * settings.pixelScale}px`
              : '—'}
          </b>
          {frameSize && (
            <>
              <br />
              Print size: <b>
                {`${((effRes * settings.pixelScale) / settings.dpi).toFixed(2)}×${(((procHeight ?? 0) * settings.pixelScale) / settings.dpi).toFixed(2)}in`}
              </b>{' '}
              ·{' '}
              {`${(((effRes * settings.pixelScale) / settings.dpi) * 2.54).toFixed(1)}×${((((procHeight ?? 0) * settings.pixelScale) / settings.dpi) * 2.54).toFixed(1)}cm`}
            </>
          )}
        </div>

        <div className="export-btns">
          <button
            className="btn btn--sm"
            disabled={frameCount === 0 || exporting}
            onClick={() => onExport('png')}
          >
            <Download size={14} /> PNG
          </button>
          <button
            className="btn btn--sm"
            disabled={frameCount === 0 || exporting}
            onClick={() => onExport('jpeg')}
          >
            <Download size={14} /> JPEG
          </button>
          <button
            className="btn btn--sm"
            disabled={frameCount === 0 || exporting}
            onClick={() => onExport('svg')}
          >
            <Download size={14} /> SVG
          </button>
          <button
            className="btn btn--sm"
            disabled={frameCount === 0 || exporting}
            onClick={() => onExport('sequence')}
            title="Timeline as numbered PNG frames in a ZIP (keyframe animations included)"
          >
            <FileArchive size={14} /> Sequence
          </button>
          <button
            className="btn btn--sm"
            disabled={frameCount === 0 || exporting}
            onClick={() => onExport('mp4')}
            title="Timeline as H.264 MP4 (duration, FPS and keyframes apply)"
          >
            <Clapperboard size={14} /> MP4
          </button>
          <button
            className="btn btn--sm"
            disabled={frameCount === 0 || exporting}
            onClick={() => onExport('gif')}
            title="Timeline as animated GIF (duration, FPS and keyframes apply)"
          >
            <Clapperboard size={14} /> GIF
          </button>
          <button
            className="btn btn--sm"
            disabled={frameCount === 0 || exporting}
            onClick={() => onExport('cmyk')}
            title="Export screenprint separations: C/M/Y/K plates as PNGs in a ZIP (approximate RGB→CMYK conversion, no ICC profile)"
          >
            <Layers size={14} /> CMYK
          </button>
        </div>

        {exportProgress && (
          <div className="export-progress">
            <div className="export-progress-head">
              <span className="control-label">{exportProgress.label}</span>
              <button
                className="iconbtn"
                onClick={onCancelExport}
                aria-label="Cancel export"
                title="Cancel export"
              >
                <X size={12} />
              </button>
            </div>
            <div className="progress-track">
              <div
                className={`progress-fill${exportProgress.value === null ? ' indeterminate' : ''}`}
                style={
                  exportProgress.value === null
                    ? undefined
                    : { width: `${Math.round(exportProgress.value * 100)}%` }
                }
              />
            </div>
          </div>
        )}
      </Section>
    </aside>
  )
}
