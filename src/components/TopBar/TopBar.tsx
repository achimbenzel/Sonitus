import { useEffect, useRef, useState } from 'react'

export type ExportKind = 'png' | 'jpeg' | 'svg' | 'sequence'

interface TopBarProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onNewProject: () => void
  onSavePreset: () => void
  onLoadPreset: (file: File) => void
  onExport: (kind: ExportKind) => void
  hasFrame: boolean
  hasSequence: boolean
  busy: boolean
}

export function TopBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onNewProject,
  onSavePreset,
  onLoadPreset,
  onExport,
  hasFrame,
  hasSequence,
  busy,
}: TopBarProps) {
  const [exportOpen, setExportOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const presetInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!exportOpen) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [exportOpen])

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="dot" />
        SONITUS <span className="sub">/ DITHER STUDIO</span>
      </div>

      <div className="topbar-group">
        <button className="btn btn--sm" onClick={onNewProject} title="Clear project">
          New
        </button>
        <button
          className="btn btn--sm"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          ↩ Undo
        </button>
        <button
          className="btn btn--sm"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo ↪
        </button>
      </div>

      <div className="topbar-group">
        <button className="btn btn--sm" onClick={onSavePreset} title="Save all parameters as JSON">
          Save Preset
        </button>
        <button
          className="btn btn--sm"
          onClick={() => presetInputRef.current?.click()}
          title="Load parameters from JSON"
        >
          Load Preset
        </button>
        <input
          ref={presetInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onLoadPreset(f)
            e.target.value = ''
          }}
        />

        <div className="menu-wrap" ref={menuRef}>
          <button
            className="btn btn--sm btn--teal"
            onClick={() => setExportOpen((v) => !v)}
            disabled={!hasFrame}
          >
            Export ▾
          </button>
          {exportOpen && (
            <div className="menu">
              <button onClick={() => { setExportOpen(false); onExport('png') }}>
                PNG <span className="menu-hint">current frame</span>
              </button>
              <button onClick={() => { setExportOpen(false); onExport('jpeg') }}>
                JPEG <span className="menu-hint">current frame</span>
              </button>
              <button onClick={() => { setExportOpen(false); onExport('svg') }}>
                SVG <span className="menu-hint">vector rects</span>
              </button>
              <button
                disabled={!hasSequence}
                onClick={() => { setExportOpen(false); onExport('sequence') }}
              >
                PNG Sequence <span className="menu-hint">zip, all frames</span>
              </button>
            </div>
          )}
        </div>

        <span className="topbar-status">
          {busy ? (
            <>
              <span className="pulse" /> Processing
            </>
          ) : (
            'Ready'
          )}
        </span>
      </div>
    </header>
  )
}
