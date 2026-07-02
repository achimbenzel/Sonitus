/* ============================================================
   Undo/redo for the project state: parameter settings AND
   keyframes share one history, so undoing never produces a
   mismatched timeline/parameter combination.

   Rapid changes coalesce: the first change in a burst snapshots
   the pre-change state, and after 400ms of quiet that snapshot
   becomes one undo step. This automatically turns a slider drag
   OR a keyframe drag (many rapid moves) into a single step.
   ============================================================ */

import { useCallback, useRef, useState } from 'react'
import type { DitherSettings, KeyframeMap } from '../types'

const MAX_HISTORY = 100
const COMMIT_MS = 400

export interface ProjectState {
  settings: DitherSettings
  keyframes: KeyframeMap
}

export interface ProjectHistory {
  settings: DitherSettings
  keyframes: KeyframeMap
  /** Patch settings (coalesced undo step). */
  update: (patch: Partial<DitherSettings>) => void
  /** Replace the keyframe map (coalesced undo step). */
  updateKeyframes: (next: KeyframeMap) => void
  /** Replace everything as a single undoable step (preset import,
   *  new project). */
  replaceAll: (next: ProjectState) => void
  /** Rewrite keyframes in current state AND all history entries
   *  WITHOUT creating an undo step (FPS remap: times are preserved,
   *  only derived frame indices change). */
  transformKeyframes: (fn: (kfs: KeyframeMap) => KeyframeMap) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useProjectHistory(initialSettings: DitherSettings): ProjectHistory {
  const initial: ProjectState = { settings: initialSettings, keyframes: {} }
  const [state, setState] = useState(initial)
  const current = useRef(initial)
  const past = useRef<ProjectState[]>([])
  const future = useRef<ProjectState[]>([])
  const pendingBase = useRef<ProjectState | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const [, bump] = useState(0)

  const apply = useCallback((next: ProjectState) => {
    current.current = next
    setState(next)
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

  const change = useCallback(
    (next: ProjectState) => {
      if (!pendingBase.current) pendingBase.current = current.current
      apply(next)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        commit()
        bump((v) => v + 1) // refresh canUndo
      }, COMMIT_MS)
    },
    [apply, commit],
  )

  const update = useCallback(
    (patch: Partial<DitherSettings>) => {
      change({ ...current.current, settings: { ...current.current.settings, ...patch } })
    },
    [change],
  )

  const updateKeyframes = useCallback(
    (next: KeyframeMap) => {
      change({ ...current.current, keyframes: next })
    },
    [change],
  )

  const replaceAll = useCallback(
    (next: ProjectState) => {
      commit()
      past.current.push(current.current)
      if (past.current.length > MAX_HISTORY) past.current.shift()
      future.current = []
      apply(next)
    },
    [apply, commit],
  )

  const transformKeyframes = useCallback(
    (fn: (kfs: KeyframeMap) => KeyframeMap) => {
      commit()
      // Apply to every state the user can reach via undo/redo, so no
      // history entry keeps stale frame indices.
      past.current = past.current.map((s) => ({ ...s, keyframes: fn(s.keyframes) }))
      future.current = future.current.map((s) => ({ ...s, keyframes: fn(s.keyframes) }))
      apply({ ...current.current, keyframes: fn(current.current.keyframes) })
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
    settings: state.settings,
    keyframes: state.keyframes,
    update,
    updateKeyframes,
    replaceAll,
    transformKeyframes,
    undo,
    redo,
    canUndo: past.current.length > 0 || pendingBase.current !== null,
    canRedo: future.current.length > 0,
  }
}
