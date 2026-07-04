/* ============================================================
   Header bar: desktop-software style. Brand on the left, grouped
   icon actions (file / preset / history) and Settings + About on
   the right. Export lives in the sidebar, not here.
   ============================================================ */

import { useRef } from 'react'
import {
  FilePlus2,
  FolderOpen,
  Frame,
  Info,
  Redo2,
  Save,
  Settings as SettingsIcon,
  FileInput,
  Undo2,
} from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { AppLogo } from '../ui/AppLogo'

interface TopBarProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  /** Full reset: media, settings, keyframes, timeline, caches. */
  onNewFile: () => void
  /** Clear only the loaded media/canvas; settings stay. */
  onNewCanvas: () => void
  onOpen: () => void
  onSavePreset: () => void
  onLoadPreset: (file: File) => void
  onOpenSettings: () => void
  onOpenAbout: () => void
}

export function TopBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onNewFile,
  onNewCanvas,
  onOpen,
  onSavePreset,
  onLoadPreset,
  onOpenSettings,
  onOpenAbout,
}: TopBarProps) {
  const presetInputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <AppLogo size={22} className="topbar-logo" />
        SONITUS
      </div>

      <div className="topbar-group" role="toolbar" aria-label="File">
        <IconButton
          label="New file — reset everything (media, settings, keyframes, timeline)"
          onClick={onNewFile}
        >
          <FilePlus2 size={15} />
        </IconButton>
        <IconButton label="New canvas — clear the loaded media, keep all settings" onClick={onNewCanvas}>
          <Frame size={15} />
        </IconButton>
        <IconButton label="Open / import…" onClick={onOpen}>
          <FolderOpen size={15} />
        </IconButton>
      </div>

      <span className="topbar-sep" />

      <div className="topbar-group" role="toolbar" aria-label="Presets">
        <IconButton label="Save preset (.sonitus)" onClick={onSavePreset}>
          <Save size={15} />
        </IconButton>
        <IconButton
          label="Load preset (.sonitus / legacy .json)"
          onClick={() => presetInputRef.current?.click()}
        >
          <FileInput size={15} />
        </IconButton>
        <input
          ref={presetInputRef}
          type="file"
          accept=".sonitus,.json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onLoadPreset(f)
            e.target.value = ''
          }}
        />
      </div>

      <span className="topbar-sep" />

      <div className="topbar-group" role="toolbar" aria-label="History">
        <IconButton label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
          <Redo2 size={15} />
        </IconButton>
      </div>

      <span className="topbar-spacer" />

      <div className="topbar-group" role="toolbar" aria-label="Application">
        <IconButton label="Settings" onClick={onOpenSettings}>
          <SettingsIcon size={15} />
        </IconButton>
        <IconButton label="About" onClick={onOpenAbout}>
          <Info size={15} />
        </IconButton>
      </div>
    </header>
  )
}
