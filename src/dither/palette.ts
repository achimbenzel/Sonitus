/* ============================================================
   Palette helpers: hex parsing, mono ramps, mono presets and
   median-cut color quantization for image-palette mode.
   ============================================================ */

export type RGB = readonly [number, number, number]

export function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const v = parseInt(h, 16)
  if (h.length !== 6 || Number.isNaN(v)) return [0, 0, 0]
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** Ramp of `levels` colors interpolated from dark → light.
 *  Level index 0 renders shadows, index levels-1 renders highlights. */
export function monoRamp(darkHex: string, lightHex: string, levels: number): RGB[] {
  const dark = hexToRgb(darkHex)
  const light = hexToRgb(lightHex)
  const out: RGB[] = []
  for (let i = 0; i < levels; i++) {
    const t = levels === 1 ? 1 : i / (levels - 1)
    out.push([
      Math.round(dark[0] + (light[0] - dark[0]) * t),
      Math.round(dark[1] + (light[1] - dark[1]) * t),
      Math.round(dark[2] + (light[2] - dark[2]) * t),
    ])
  }
  return out
}

export interface MonoPreset {
  name: string
  light: string
  dark: string
}

export const MONO_PRESETS: MonoPreset[] = [
  { name: 'Black / White', light: '#ffffff', dark: '#000000' },
  { name: 'Off-White / Black', light: '#e8e3dc', dark: '#141210' },
  { name: 'Green / Black', light: '#4af17a', dark: '#03170a' },
  { name: 'Orange / Black', light: '#ffb02e', dark: '#160b00' },
  { name: 'Blue / Cream', light: '#f4ead8', dark: '#1c3fae' },
]

/* ---------- Median-cut quantization ---------- */

interface Box {
  pixels: Uint32Array // packed 0xRRGGBB samples
  start: number
  end: number // exclusive
}

function channelRange(px: Uint32Array, start: number, end: number, shift: number): number {
  let min = 255
  let max = 0
  for (let i = start; i < end; i++) {
    const v = (px[i] >> shift) & 255
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min
}

/** Extract up to `count` representative colors from an image with
 *  median-cut. Transparent pixels (alpha < 32) are ignored. Sampling
 *  is strided so cost stays bounded for large inputs. */
export function medianCutPalette(
  data: Uint8ClampedArray,
  count: number,
): RGB[] {
  const totalPx = data.length / 4
  const maxSamples = 32768
  const stride = Math.max(1, Math.ceil(totalPx / maxSamples))

  const samples: number[] = []
  for (let p = 0; p < totalPx; p += stride) {
    const i = p * 4
    if (data[i + 3] < 32) continue
    samples.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
  }
  if (samples.length === 0) return [[0, 0, 0]]

  const px = Uint32Array.from(samples)
  const boxes: Box[] = [{ pixels: px, start: 0, end: px.length }]

  while (boxes.length < count) {
    // Split the box with the largest channel range (weighted by size).
    let bestBox = -1
    let bestScore = 0
    let bestShift = 16
    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b]
      if (box.end - box.start < 2) continue
      for (const shift of [16, 8, 0]) {
        const range = channelRange(box.pixels, box.start, box.end, shift)
        const score = range * Math.log2(box.end - box.start + 1)
        if (score > bestScore) {
          bestScore = score
          bestBox = b
          bestShift = shift
        }
      }
    }
    if (bestBox < 0) break

    const box = boxes[bestBox]
    const sub = box.pixels.subarray(box.start, box.end)
    const sorted = Uint32Array.from(sub).sort(
      (a, b) => (((a >> bestShift) & 255) - ((b >> bestShift) & 255)),
    )
    sub.set(sorted)
    const mid = box.start + ((box.end - box.start) >> 1)
    boxes.splice(bestBox, 1, { pixels: box.pixels, start: box.start, end: mid }, {
      pixels: box.pixels,
      start: mid,
      end: box.end,
    })
  }

  const seen = new Set<number>()
  const out: RGB[] = []
  for (const box of boxes) {
    let r = 0
    let g = 0
    let b = 0
    const n = box.end - box.start
    for (let i = box.start; i < box.end; i++) {
      const v = box.pixels[i]
      r += (v >> 16) & 255
      g += (v >> 8) & 255
      b += v & 255
    }
    const color: [number, number, number] = [
      Math.round(r / n),
      Math.round(g / n),
      Math.round(b / n),
    ]
    const key = (color[0] << 16) | (color[1] << 8) | color[2]
    if (!seen.has(key)) {
      seen.add(key)
      out.push(color)
    }
  }
  return out
}
