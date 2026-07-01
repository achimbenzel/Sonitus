/* ============================================================
   Undo/redo for parameter changes.

   Rapid changes (slider drags) coalesce: the first change in a
   burst snapshots the pre-change state, and after 400ms of quiet
   that snapshot becomes one undo step.
   ============================================================ */

import { useCallback, useRef, useState } from 'react'
import type { DitherSettings } from '../types'

const MAX_HISTORY = 100
const COMMIT_MS = 400

export interface SettingsHistory {
  settings: DitherSettings
  update: (patch: Partial<DitherSettings>) => void
  /** Replace everything as a single undoable step (preset import). */
  replaceAll: (next: DitherSettings) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useSettingsHistory(initial: DitherSettings): SettingsHistory {
  const [settings, setSettings] = useState(initial)
  const current = useRef(initial)
  const past = useRef<DitherSettings[]>([])
  const future = useRef<DitherSettings[]>([])
  const pendingBase = useRef<DitherSettings | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [, bump] = useState(0)

  const apply = useCallback((next: DitherSettings) => {
    current.current = next
    setSettings(next)
  }, [])

  const commit = useCallback(() => {
    window.clearTimeout(timer.current)
    const base = pendingBase.current
    pendingBase.current = null
    if (base && base !== current.current) {
      past.current.push(base)
      if (past.current.length > MAX_HISTORY) past.current.shift()
      future.current = []
    }
  }, [])

  const update = useCallback(
    (patch: Partial<DitherSettings>) => {
      if (!pendingBase.current) pendingBase.current = current.current
      apply({ ...current.current, ...patch })
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        commit()
        bump((v) => v + 1) // refresh canUndo
      }, COMMIT_MS)
    },
    [apply, commit],
  )

  const replaceAll = useCallback(
    (next: DitherSettings) => {
      commit()
      past.current.push(current.current)
      if (past.current.length > MAX_HISTORY) past.current.shift()
      future.current = []
      apply(next)
    },
    [apply, commit],
  )

  const undo = useCallback(() => {
    commit()
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(current.current)
    apply(prev)
  }, [apply, commit])

  const redo = useCallback(() => {
    commit()
    const next = future.current.pop()
    if (!next) return
    past.current.push(current.current)
    apply(next)
  }, [apply, commit])

  return {
    settings,
    update,
    replaceAll,
    undo,
    redo,
    canUndo: past.current.length > 0 || pendingBase.current !== null,
    canRedo: future.current.length > 0,
  }
}
