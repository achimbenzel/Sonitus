/* Small dialog asking for a preset name before saving. */

import { useState } from 'react'
import { Save } from 'lucide-react'
import { Modal } from '../ui/Modal'

interface PresetNameModalProps {
  onSave: (name: string) => void
  onClose: () => void
}

export function PresetNameModal({ onSave, onClose }: PresetNameModalProps) {
  const [name, setName] = useState('')

  const save = () => {
    onSave(name)
    onClose()
  }

  return (
    <Modal title="Save Preset" onClose={onClose}>
      <p className="modal-note">
        Name your preset. The name is stored in the JSON file and used as the filename.
      </p>
      <input
        type="text"
        className="preset-name-input"
        value={name}
        autoFocus
        maxLength={64}
        placeholder="Dither Preset"
        aria-label="Preset name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
        }}
      />
      <div className="modal-actions">
        <button className="btn btn--sm btn--teal" onClick={save}>
          <Save size={13} /> Save Preset
        </button>
      </div>
    </Modal>
  )
}
