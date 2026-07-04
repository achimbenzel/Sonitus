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
  /** Optional middle action (e.g. "Merge" next to "Replace"). */
  secondaryLabel?: string
  onSecondary?: () => void
  onClose: () => void
}

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  secondaryLabel,
  onSecondary,
  onClose,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="modal-note">{message}</p>
      <div className="modal-actions modal-actions--confirm">
        <button className="btn btn--sm" onClick={onClose} autoFocus>
          Cancel
        </button>
        {secondaryLabel && onSecondary && (
          <button
            className="btn btn--sm"
            onClick={() => {
              onSecondary()
              onClose()
            }}
          >
            {secondaryLabel}
          </button>
        )}
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
