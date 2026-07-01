/* Icon button used across the header and toolbars. */

import type { ReactNode } from 'react'

interface IconButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
  accent?: boolean
}

export function IconButton({ label, onClick, disabled, children, accent }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`iconbtn${accent ? ' accent' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  )
}
