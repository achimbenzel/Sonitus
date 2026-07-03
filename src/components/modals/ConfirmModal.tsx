/* App-styled confirmation dialog — replaces the native confirm()
   popup so destructive actions (clear source, reset project, close
   the window) look like every other Sonitus window. */

import type { ReactNode } from 'react'
import { Modal } from '../ui/Modal'

interface ConfirmModalProps {
  title: string
  message: ReactNode
  /** Label of the destructive/confirming button. */
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmModal({ title, message, confirmLabel, onConfirm, onClose }: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal-note">{message}</p>
      <div className="modal-actions modal-actions--confirm">
        <button className="btn btn--sm" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button
          className="btn btn--sm btn--teal"
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
