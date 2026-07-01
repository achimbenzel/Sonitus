/* ============================================================
   Small priority worker pool for the dither worker.

   - Tasks carry a priority (preview > export > buffering) and a tag
     (the settings hash) so queued-but-stale work can be cancelled
     wholesale when parameters change.
   - Buffers are transferred, not copied.
   ============================================================ */

import type { PipelineSettings, RawImage } from '../types'

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export const PRIORITY = {
  PREVIEW: 0,
  EXPORT: 1,
  BUFFER: 2,
} as const

interface PoolTask {
  id: number
  tag: string
  priority: number
  seq: number
  payload: { width: number; height: number; buffer: ArrayBuffer; settings: PipelineSettings }
  resolve: (img: RawImage) => void
  reject: (err: Error) => void
}

interface PooledWorker {
  worker: Worker
  task: PoolTask | null
}

export class WorkerPool {
  private workers: PooledWorker[] = []
  private queue: PoolTask[] = []
  private nextId = 1
  private nextSeq = 1

  constructor(size?: number) {
    const n = size ?? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))
    for (let i = 0; i < n; i++) {
      const worker = new Worker(new URL('./ditherWorker.ts', import.meta.url), {
        type: 'module',
      })
      const pw: PooledWorker = { worker, task: null }
      worker.onmessage = (e) => this.onMessage(pw, e)
      worker.onerror = (e) => this.onError(pw, e)
      this.workers.push(pw)
    }
  }

  get size(): number {
    return this.workers.length
  }

  run(img: RawImage, settings: PipelineSettings, priority: number, tag: string): Promise<RawImage> {
    return new Promise<RawImage>((resolve, reject) => {
      this.queue.push({
        id: this.nextId++,
        tag,
        priority,
        seq: this.nextSeq++,
        payload: {
          width: img.width,
          height: img.height,
          buffer: img.data.buffer as ArrayBuffer,
          settings,
        },
        resolve,
        reject,
      })
      this.dispatch()
    })
  }

  /** Rejects queued (not yet running) tasks matching the predicate. */
  cancelQueued(predicate: (tag: string, priority: number) => boolean): void {
    const keep: PoolTask[] = []
    for (const t of this.queue) {
      if (predicate(t.tag, t.priority)) t.reject(new CancelledError())
      else keep.push(t)
    }
    this.queue = keep
  }

  cancelAll(): void {
    this.cancelQueued(() => true)
  }

  private dispatch(): void {
    while (this.queue.length > 0) {
      const idle = this.workers.find((w) => w.task === null)
      if (!idle) return
      let best = 0
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i]
        const b = this.queue[best]
        if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i
      }
      const task = this.queue.splice(best, 1)[0]
      idle.task = task
      idle.worker.postMessage(
        { id: task.id, ...task.payload },
        [task.payload.buffer],
      )
    }
  }

  private onMessage(pw: PooledWorker, e: MessageEvent): void {
    const task = pw.task
    pw.task = null
    if (task) {
      const msg = e.data as {
        id: number
        ok: boolean
        width?: number
        height?: number
        buffer?: ArrayBuffer
        error?: string
      }
      if (msg.ok && msg.buffer) {
        task.resolve({
          data: new Uint8ClampedArray(msg.buffer),
          width: msg.width!,
          height: msg.height!,
        })
      } else {
        task.reject(new Error(msg.error ?? 'worker error'))
      }
    }
    this.dispatch()
  }

  private onError(pw: PooledWorker, e: ErrorEvent): void {
    const task = pw.task
    pw.task = null
    task?.reject(new Error(e.message || 'worker crashed'))
    this.dispatch()
  }
}
