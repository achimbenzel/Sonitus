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

export function rgbToHex(c: RGB): string {
  return '#' + ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)
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

function samplePixels(data: Uint8ClampedArray): Uint32Array {
  const totalPx = data.length / 4
  const maxSamples = 32768
  const stride = Math.max(1, Math.ceil(totalPx / maxSamples))
  const samples: number[] = []
  for (let p = 0; p < totalPx; p += stride) {
    const i = p * 4
    if (data[i + 3] < 32) continue
    samples.push((data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
  }
  return Uint32Array.from(samples)
}

/** Median-cut boxes over the sample set (shared by the styles). */
function medianCutBoxes(px: Uint32Array, count: number): Box[] {
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
  return boxes
}

function boxMean(box: Box): RGB {
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
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
}

function saturationOf(v: number): number {
  const r = (v >> 16) & 255
  const g = (v >> 8) & 255
  const b = v & 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** Pick the box member with the extreme saturation (vibrant/muted). */
function boxBySaturation(box: Box, wantMax: boolean): RGB {
  let best = box.pixels[box.start]
  let bestS = saturationOf(best)
  for (let i = box.start + 1; i < box.end; i++) {
    const s = saturationOf(box.pixels[i])
    if (wantMax ? s > bestS : s < bestS) {
      bestS = s
      best = box.pixels[i]
    }
  }
  return [(best >> 16) & 255, (best >> 8) & 255, best & 255]
}

function dedupe(colors: RGB[]): RGB[] {
  const seen = new Set<number>()
  const out: RGB[] = []
  for (const c of colors) {
    const key = (c[0] << 16) | (c[1] << 8) | c[2]
    if (!seen.has(key)) {
      seen.add(key)
      out.push(c)
    }
  }
  return out
}

/** Extract up to `count` representative colors (median-cut means).
 *  Transparent pixels (alpha < 32) are ignored; sampling is strided
 *  so cost stays bounded for large inputs. */
export function medianCutPalette(data: Uint8ClampedArray, count: number): RGB[] {
  const px = samplePixels(data)
  if (px.length === 0) return [[0, 0, 0]]
  return dedupe(medianCutBoxes(px, count).map(boxMean))
}

export type GeneratablePaletteStyle = 'dominant' | 'average' | 'vibrant' | 'muted' | 'contrast'

/** Generate an image palette in one of several styles. */
export function generatePalette(
  data: Uint8ClampedArray,
  count: number,
  style: GeneratablePaletteStyle,
): RGB[] {
  const px = samplePixels(data)
  if (px.length === 0) return [[0, 0, 0]]

  if (style === 'contrast') {
    // Greedy farthest-point selection: start from the darkest sample,
    // then repeatedly add the sample farthest from all picked colors.
    const picked: number[] = []
    let darkest = px[0]
    let darkestSum = Infinity
    for (const v of px) {
      const sum = ((v >> 16) & 255) + ((v >> 8) & 255) + (v & 255)
      if (sum < darkestSum) {
        darkestSum = sum
        darkest = v
      }
    }
    picked.push(darkest)
    // Work on a strided subset so the O(count·n) loop stays cheap.
    const step = Math.max(1, Math.floor(px.length / 4096))
    while (picked.length < count) {
      let best = -1
      let bestD = -1
      for (let i = 0; i < px.length; i += step) {
        const v = px[i]
        const r = (v >> 16) & 255
        const g = (v >> 8) & 255
        const b = v & 255
        let minD = Infinity
        for (const q of picked) {
          const dr = r - ((q >> 16) & 255)
          const dg = g - ((q >> 8) & 255)
          const db = b - (q & 255)
          const d = dr * dr + dg * dg + db * db
          if (d < minD) minD = d
        }
        if (minD > bestD) {
          bestD = minD
          best = v
        }
      }
      if (best < 0 || bestD <= 0) break
      picked.push(best)
    }
    return dedupe(picked.map((v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255] as RGB))
  }

  const boxes = medianCutBoxes(px, count)
  if (style === 'vibrant') return dedupe(boxes.map((b) => boxBySaturation(b, true)))
  if (style === 'muted') return dedupe(boxes.map((b) => boxBySaturation(b, false)))
  if (style === 'average') {
    // One k-means refinement over the samples, seeded by the box means:
    // smoother, more averaged tones than raw median-cut.
    const means = boxes.map(boxMean)
    const sums = means.map(() => [0, 0, 0, 0])
    for (const v of px) {
      const r = (v >> 16) & 255
      const g = (v >> 8) & 255
      const b = v & 255
      let best = 0
      let bestD = Infinity
      for (let m = 0; m < means.length; m++) {
        const dr = r - means[m][0]
        const dg = g - means[m][1]
        const db = b - means[m][2]
        const d = dr * dr + dg * dg + db * db
        if (d < bestD) {
          bestD = d
          best = m
        }
      }
      sums[best][0] += r
      sums[best][1] += g
      sums[best][2] += b
      sums[best][3]++
    }
    return dedupe(
      sums
        .filter((s) => s[3] > 0)
        .map((s) => [
          Math.round(s[0] / s[3]),
          Math.round(s[1] / s[3]),
          Math.round(s[2] / s[3]),
        ] as RGB),
    )
  }
  // 'dominant'
  return dedupe(boxes.map(boxMean))
}
