import { useRef, useState } from 'react'
import type { DitherSettings, ProjectKind } from '../../types'
import { ALGORITHMS, isErrorDiffusion } from '../../dither/algorithms/index'
import { MONO_PRESETS } from '../../dither/palette'
import { ColorRow, Section, SelectRow, SliderRow, ToggleRow } from './controls'
import type { ExportKind } from '../TopBar/TopBar'

interface SidebarProps {
  settings: DitherSettings
  update: (patch: Partial<DitherSettings>) => void
  onImportImages: (files: File[]) => void
  onImportVideo: (file: File, extractFps: number) => void
  onExport: (kind: ExportKind) => void
  projectKind: ProjectKind
  frameCount: number
  frameSize: { width: number; height: number } | null
}

const KIND_LABEL: Record<ProjectKind, string> = {
  none: 'No source',
  image: 'Single image',
  sequence: 'Image sequence',
  video: 'MP4 video',
}

export function Sidebar({
  settings,
  update,
  onImportImages,
  onImportVideo,
  onExport,
  projectKind,
  frameCount,
  frameSize,
}: SidebarProps) {
  const imageInput = useRef<HTMLInputElement>(null)
  const sequenceInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const [extractFps, setExtractFps] = useState(12)

  const errorDiffusion = isErrorDiffusion(settings.algorithm)
  const mono = settings.paletteMode === 'mono'

  // Processing never upscales beyond the source width.
  const effRes = frameSize ? Math.min(settings.resolution, frameSize.width) : settings.resolution
  const procHeight = frameSize
    ? Math.max(1, Math.round((effRes * frameSize.height) / frameSize.width))
    : null

  return (
    <aside className="sidebar">
      {/* ---------- IMPORT ---------- */}
      <Section label="Import" variant="teal">
        <div className="import-btns">
          <button className="btn btn--sm" onClick={() => imageInput.current?.click()}>
            Upload Image
          </button>
          <button className="btn btn--sm" onClick={() => sequenceInput.current?.click()}>
            Upload Image Sequence
          </button>
          <button className="btn btn--sm" onClick={() => videoInput.current?.click()}>
            Upload MP4
          </button>
        </div>
        <div className="inline-field">
          <span className="control-label">MP4 extract FPS</span>
          <input
            type="number"
            min={1}
            max={60}
            value={extractFps}
            onChange={(e) => setExtractFps(Math.min(60, Math.max(1, Number(e.target.value) || 12)))}
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
      <Section label="Dither" variant="deep">
        <SelectRow
          label="Algorithm"
          value={settings.algorithm}
          onChange={(v) => update({ algorithm: v as DitherSettings['algorithm'] })}
        >
          <optgroup label="Error Diffusion">
            {ALGORITHMS.filter((a) => a.kind === 'error-diffusion').map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </optgroup>
          <optgroup label="Ordered">
            {ALGORITHMS.filter((a) => a.kind === 'ordered').map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </optgroup>
          <optgroup label="Stochastic">
            {ALGORITHMS.filter((a) => a.kind === 'stochastic').map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </optgroup>
        </SelectRow>

        <SliderRow
          label="Resolution"
          value={settings.resolution}
          min={8}
          max={1024}
          step={8}
          format={(v) => (frameSize && procHeight ? `${Math.min(v, frameSize.width)}×${procHeight}px` : `${v}px`)}
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
          disabled={!mono}
          onChange={(v) => update({ greyLevels: v })}
        />
        <SliderRow
          label="Pixel scale"
          value={settings.pixelScale}
          min={1}
          max={16}
          format={(v) => `${v}×`}
          onChange={(v) => update({ pixelScale: v })}
        />
      </Section>

      {/* ---------- TONE ---------- */}
      <Section label="Tone" variant="cyan">
        <SliderRow
          label="Brightness"
          value={settings.brightness}
          min={-100}
          max={100}
          onChange={(v) => update({ brightness: v })}
        />
        <SliderRow
          label="Contrast"
          value={settings.contrast}
          min={-100}
          max={100}
          onChange={(v) => update({ contrast: v })}
        />
        <SliderRow
          label="Midtones / Gamma"
          value={settings.gamma}
          min={0.2}
          max={3}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => update({ gamma: v })}
        />
        <SliderRow
          label="Threshold"
          value={settings.threshold}
          min={-100}
          max={100}
          onChange={(v) => update({ threshold: v })}
        />
        <SliderRow
          label="Pre-blur"
          value={settings.preBlur}
          min={0}
          max={10}
          step={0.5}
          format={(v) => `${v}px`}
          onChange={(v) => update({ preBlur: v })}
        />
        <ToggleRow
          label="Invert"
          checked={settings.invert}
          onChange={(v) => update({ invert: v })}
        />
      </Section>

      {/* ---------- PALETTE ---------- */}
      <Section label="Palette" variant="ink">
        <SelectRow
          label="Palette mode"
          value={settings.paletteMode}
          onChange={(v) => update({ paletteMode: v as DitherSettings['paletteMode'] })}
        >
          <option value="mono">Mono color</option>
          <option value="image">Image colors</option>
        </SelectRow>

        <ColorRow
          label="Highlight color"
          value={settings.lightColor}
          disabled={!mono}
          onChange={(v) => update({ lightColor: v })}
        />
        <ColorRow
          label="Shadow color"
          value={settings.darkColor}
          disabled={!mono}
          onChange={(v) => update({ darkColor: v })}
        />

        <div className={`control${mono ? '' : ' disabled'}`}>
          <div className="control-head">
            <span className="control-label">Presets</span>
          </div>
          <div className="swatch-row">
            {MONO_PRESETS.map((p) => (
              <button
                key={p.name}
                className="swatch"
                title={p.name}
                onClick={() => update({ lightColor: p.light, darkColor: p.dark })}
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
          disabled={mono}
          format={(v) => `${v} colors`}
          onChange={(v) => update({ paletteSize: v })}
        />
      </Section>

      {/* ---------- EXPORT ---------- */}
      <Section label="Export" variant="teal">
        <div className="export-btns">
          <button className="btn btn--sm" disabled={frameCount === 0} onClick={() => onExport('png')}>
            PNG
          </button>
          <button className="btn btn--sm" disabled={frameCount === 0} onClick={() => onExport('jpeg')}>
            JPEG
          </button>
          <button className="btn btn--sm" disabled={frameCount === 0} onClick={() => onExport('svg')}>
            SVG
          </button>
          <button className="btn btn--sm" disabled={frameCount < 2} onClick={() => onExport('sequence')}>
            Sequence
          </button>
        </div>
        <div className="import-meta">
          Output: <b>
            {frameSize
              ? `${effRes * settings.pixelScale}×${(procHeight ?? 0) * settings.pixelScale}px`
              : '—'}
          </b>
        </div>
      </Section>
    </aside>
  )
}
