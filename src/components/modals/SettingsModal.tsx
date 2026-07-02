/* Settings window: UI style selector + file-based custom CSS.
   Custom CSS is loaded from a local .css file, cached in
   localStorage so it persists between sessions (fully offline),
   and can be saved back out or reset. */

import { useRef, useState } from 'react'
import { Check, FileDown, FileUp, Trash2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import {
  UI_STYLES,
  clearCustomCss,
  loadCustomCss,
  saveCustomCss,
} from '../../themes/uiStyles'
import { downloadBlob } from '../../utils/export'

interface SettingsModalProps {
  uiStyle: string
  onSelectStyle: (id: string) => void
  onClose: () => void
}

export function SettingsModal({ uiStyle, onSelectStyle, onClose }: SettingsModalProps) {
  const cssInputRef = useRef<HTMLInputElement>(null)
  const [customCss, setCustomCss] = useState(loadCustomCss)
  const [cssError, setCssError] = useState<string | null>(null)

  const loadCssFile = async (file: File) => {
    setCssError(null)
    if (file.size > 512 * 1024) {
      setCssError('CSS file is too large (max 512 KB)')
      return
    }
    const text = await file.text()
    saveCustomCss(text)
    setCustomCss(text)
    // Re-apply so the injected stylesheet refreshes immediately.
    onSelectStyle('custom')
  }

  const saveCssFile = () => {
    downloadBlob(new Blob([customCss], { type: 'text/css' }), 'sonitus-custom.css')
  }

  const resetCss = () => {
    clearCustomCss()
    setCustomCss('')
    setCssError(null)
    onSelectStyle('custom')
  }

  const cssBytes = new Blob([customCss]).size

  return (
    <Modal title="Settings" onClose={onClose}>
      <h4 className="modal-subhead">UI style</h4>
      <div className="style-grid" role="radiogroup" aria-label="UI style">
        {UI_STYLES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={uiStyle === s.id}
            className={`style-card${uiStyle === s.id ? ' selected' : ''}`}
            onClick={() => onSelectStyle(s.id)}
          >
            <span className="style-card-head">
              {s.label}
              {uiStyle === s.id && <Check size={13} strokeWidth={2.5} />}
            </span>
            <span className="style-card-desc">{s.description}</span>
          </button>
        ))}
      </div>

      {uiStyle === 'custom' && (
        <div className="customcss">
          <h4 className="modal-subhead">Custom CSS file</h4>
          <p className="modal-note">
            Load a local <code>.css</code> file to restyle the app on top of the default
            style. The file content is cached locally, so it keeps working offline and
            between sessions. Target the app with normal selectors, e.g.{' '}
            <code>.sidebar</code>, <code>.topbar</code>, or override tokens on{' '}
            <code>:root</code>.
          </p>
          <div className="customcss-actions">
            <button className="btn btn--sm" onClick={() => cssInputRef.current?.click()}>
              <FileUp size={13} /> Load CSS file
            </button>
            <button className="btn btn--sm" disabled={customCss === ''} onClick={saveCssFile}>
              <FileDown size={13} /> Save CSS file
            </button>
            <button className="btn btn--sm" disabled={customCss === ''} onClick={resetCss}>
              <Trash2 size={13} /> Reset
            </button>
          </div>
          <p className="modal-note customcss-status">
            {cssError ? (
              <span className="customcss-error">{cssError}</span>
            ) : customCss === '' ? (
              'No custom CSS loaded.'
            ) : (
              `Custom CSS active — ${(cssBytes / 1024).toFixed(1)} KB cached locally.`
            )}
          </p>
          <input
            ref={cssInputRef}
            type="file"
            accept=".css,text/css"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) loadCssFile(f)
              e.target.value = ''
            }}
          />
        </div>
      )}
    </Modal>
  )
}
