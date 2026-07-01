/* ============================================================
   Dither worker: receives a downscaled RGBA buffer plus pipeline
   settings, runs the (CPU-heavy) dither pipeline off the main
   thread and transfers the result back.
   ============================================================ */

import { processImage } from '../dither/pipeline'
import type { PipelineSettings } from '../types'

interface WorkerRequest {
  id: number
  width: number
  height: number
  buffer: ArrayBuffer
  settings: PipelineSettings
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, width, height, buffer, settings } = e.data
  try {
    const out = processImage(
      { data: new Uint8ClampedArray(buffer), width, height },
      settings,
    )
    ;(self as unknown as Worker).postMessage(
      { id, ok: true, width: out.width, height: out.height, buffer: out.data.buffer },
      [out.data.buffer],
    )
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, ok: false, error: String(err) })
  }
}
