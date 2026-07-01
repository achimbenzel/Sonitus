import type { ProgressState } from '../../types'

interface ProgressOverlayProps {
  progress: ProgressState
  onCancel?: () => void
}

export function ProgressOverlay({ progress, onCancel }: ProgressOverlayProps) {
  const pct = progress.value === null ? null : Math.round(progress.value * 100)
  return (
    <div className="overlay">
      <div className="overlay-panel">
        <span className="overlay-label">
          <span className="pulse" />
          {progress.label}
        </span>
        <div className="progress-track">
          <div
            className={`progress-fill${pct === null ? ' indeterminate' : ''}`}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
        {pct !== null && <span className="overlay-pct">{pct}%</span>}
        {progress.cancellable && onCancel && (
          <button className="btn btn--sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
