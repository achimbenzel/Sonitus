/* Settings window: UI style selector + custom CSS editor.
   The chosen style is persisted in localStorage (see themes/uiStyles). */

import { useState } from 'react'
import { Check } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { UI_STYLES, loadCustomCss, saveCustomCss } from '../../themes/uiStyles'

interface SettingsModalProps {
  uiStyle: string
  onSelectStyle: (id: string) => void
  onClose: () => void
}

export function SettingsModal({ uiStyle, onSelectStyle, onClose }: SettingsModalProps) {
  const [customCss, setCustomCss] = useState(loadCustomCss)
  const [applied, setApplied] = useState(false)

  const applyCss = () => {
    saveCustomCss(customCss)
    // Re-apply the style so the injected stylesheet refreshes.
    onSelectStyle('custom')
    setApplied(true)
    window.setTimeout(() => setApplied(false), 1600)
  }

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
          <h4 className="modal-subhead">Custom CSS</h4>
          <p className="modal-note">
            Applied on top of the default style. Target the app with normal selectors,
            e.g. <code>.sidebar</code>, <code>.topbar</code>, or override tokens on <code>:root</code>.
          </p>
          <textarea
            className="customcss-input"
            spellCheck={false}
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
            placeholder={':root {\n  --accent: #ff8800;\n}'}
          />
          <div className="modal-actions">
            <button className="btn btn--sm btn--teal" onClick={applyCss}>
              {applied ? 'Applied ✓' : 'Apply CSS'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
