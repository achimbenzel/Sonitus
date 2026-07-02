import { useRef, useState } from 'react'
import { Clapperboard, Download, FileArchive, Film, ImagePlus, Images, Layers, X } from 'lucide-react'
import type { DitherSettings, ExportKind, KeyframableParam, ProjectKind } from '../../types'
import { DEFAULT_SETTINGS } from '../../types'
import { ALGORITHMS, isErrorDiffusion } from '../../dither/algorithms/index'
import { MONO_PRESETS } from '../../dither/palette'
import { Section, SelectRow, SliderRow, ToggleRow, type KfControlProps } from './controls'
import { ColorField } from '../ui/ColorField'
import { KeyframeControl } from './controls'
import { NumberField } from '../ui/NumberField'

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
  onImportVideo: (file: File, extractFps: number) => void
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
  video: 'MP4 video',
}

const GROUP_LABEL = {
  'error-diffusion': 'Error Diffusion',
  ordered: 'Ordered',
  stochastic: 'Stochastic',
} as const

const ALGORITHM_OPTIONS = ALGORITHMS.map((a) => ({
  value: a.id,
  label: a.label,
  group: GROUP_LABEL[a.kind],
}))

export function Sidebar({
  settings,
  update,
  updateParam,
  kfControl,
  onImportImages,
  onImportVideo,
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
  const [extractFps, setExtractFps] = useState(12)

  const errorDiffusion = isErrorDiffusion(settings.algorithm)
  const mono = settings.paletteMode === 'mono'
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
            <Film size={14} /> MP4 Video
          </button>
        </div>
        <div className="inline-field">
          <span className="control-label">MP4 extract FPS</span>
          <NumberField
            value={extractFps}
            min={1}
            max={60}
            onChange={setExtractFps}
            ariaLabel="MP4 extract FPS"
          />
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
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
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
          accept="image/png,image/jpeg,.png,.jpg,.jpeg"
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
          accept="video/mp4,.mp4"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportVideo(f, extractFps)
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
          disabled={!mono}
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
        <SliderRow
          label="Pre-blur"
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
        <ToggleRow
          label="Invert"
          checked={settings.invert}
          onChange={(v) => update({ invert: v })}
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

        <SliderRow
          label="Palette size"
          value={settings.paletteSize}
          min={2}
          max={32}
          resetValue={d.paletteSize}
          disabled={mono}
          unit=" colors"
          onChange={(v) => update({ paletteSize: v })}
        />
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
        {/* Post-dither resampling: the very last pipeline step — rounds
            the enlarged dither pixels without changing dimensions. */}
        <ToggleRow
          label="Post-dither soften"
          checked={settings.postResample}
          onChange={(v) => update({ postResample: v })}
        />
        <SelectRow
          label="Resampling"
          value={settings.resampling}
          disabled={!settings.postResample}
          options={[
            { value: 'nearest', label: 'Nearest (crisp)' },
            { value: 'linear', label: 'Linear' },
            { value: 'soft', label: 'Soft' },
            { value: 'bleeding', label: 'Bleeding Soft' },
          ]}
          onChange={(v) => update({ resampling: v as DitherSettings['resampling'] })}
        />
        <div className="import-meta" style={{ marginTop: 0 }}>
          Output size: <b>
            {frameSize
              ? `${effRes * settings.pixelScale}×${(procHeight ?? 0) * settings.pixelScale}px`
              : '—'}
          </b>
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
