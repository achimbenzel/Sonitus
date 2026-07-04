/* ============================================================
   PNG metadata: inject standard tEXt chunks marking files as
   created with Sonitus. Pure byte manipulation — no dependency,
   fully offline. The chunks are inserted right after IHDR, which
   keeps the file a valid PNG for every common viewer/design tool
   (unknown ancillary chunks are skipped by decoders).
   ============================================================ */

/** Metadata stamped into every exported PNG. */
export const PNG_METADATA: ReadonlyArray<readonly [string, string]> = [
  ['Software', 'Sonitus'],
  ['Creator Tool', 'Sonitus'],
  ['Description', 'Created with Sonitus'],
]

/* CRC-32 (as required by the PNG spec), small table-driven variant. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** One tEXt chunk: length + "tEXt" + keyword \0 text + CRC.
 *  Keyword/text must be Latin-1; ours are plain ASCII. */
function textChunk(keyword: string, text: string): Uint8Array {
  const payload = `${keyword}\0${text}`
  const data = new Uint8Array(4 + 4 + payload.length + 4)
  const view = new DataView(data.buffer)
  view.setUint32(0, payload.length)
  data[4] = 0x74 // t
  data[5] = 0x45 // E
  data[6] = 0x58 // X
  data[7] = 0x74 // t
  for (let i = 0; i < payload.length; i++) data[8 + i] = payload.charCodeAt(i) & 0xff
  view.setUint32(8 + payload.length, crc32(data.subarray(4, 8 + payload.length)))
  return data
}

/** pHYs chunk: physical pixel density. PNG stores pixels per METER;
 *  1 inch = 0.0254 m, so ppm = round(dpi / 0.0254). */
function physChunk(dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  const data = new Uint8Array(4 + 4 + 9 + 4)
  const view = new DataView(data.buffer)
  view.setUint32(0, 9)
  data[4] = 0x70 // p
  data[5] = 0x48 // H
  data[6] = 0x59 // Y
  data[7] = 0x73 // s
  view.setUint32(8, ppm)
  view.setUint32(12, ppm)
  data[16] = 1 // unit: meter
  view.setUint32(17, crc32(data.subarray(4, 17)))
  return data
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Returns a copy of the PNG bytes with the Sonitus tEXt chunks (and,
 *  when `dpi` is given, a pHYs density chunk) inserted after IHDR.
 *  Non-PNG input is returned unchanged. */
export function stampPngBytes(bytes: Uint8Array, dpi?: number): Uint8Array {
  if (bytes.length < 33 || PNG_SIG.some((b, i) => bytes[i] !== b)) return bytes
  // IHDR is required to be the first chunk: signature (8) +
  // length (4) + type (4) + data (IHDR length) + CRC (4).
  const ihdrLen = new DataView(bytes.buffer, bytes.byteOffset).getUint32(8)
  const insertAt = 8 + 8 + ihdrLen + 4
  if (insertAt > bytes.length) return bytes
  const chunks = PNG_METADATA.map(([k, v]) => textChunk(k, v))
  if (dpi && dpi > 0) chunks.unshift(physChunk(dpi))
  const extra = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(bytes.length + extra)
  out.set(bytes.subarray(0, insertAt), 0)
  let off = insertAt
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  out.set(bytes.subarray(insertAt), off)
  return out
}

/** Blob version for direct PNG downloads. */
export async function stampPngBlob(blob: Blob, dpi?: number): Promise<Blob> {
  const stamped = stampPngBytes(new Uint8Array(await blob.arrayBuffer()), dpi)
  return new Blob([stamped], { type: 'image/png' })
}

/** Sets the JFIF density fields of a canvas-encoded JPEG to `dpi`.
 *  If the file has no JFIF APP0 (unusual for canvas output), one is
 *  inserted right after SOI. Non-JPEG input is returned unchanged. */
export async function stampJpegDpi(blob: Blob, dpi: number): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return blob
  const d = Math.min(65535, Math.max(1, Math.round(dpi)))
  // JFIF APP0 directly after SOI: FF E0 len 'JFIF\0' vv vv units xd xd yd yd ...
  if (
    bytes.length >= 18 &&
    bytes[2] === 0xff && bytes[3] === 0xe0 &&
    bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0
  ) {
    const out = bytes.slice()
    out[13] = 1 // density unit: dots per inch
    out[14] = d >> 8
    out[15] = d & 0xff
    out[16] = d >> 8
    out[17] = d & 0xff
    return new Blob([out], { type: 'image/jpeg' })
  }
  // No JFIF header — insert a minimal one.
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
    1, d >> 8, d & 0xff, d >> 8, d & 0xff, 0, 0,
  ])
  const out = new Uint8Array(bytes.length + app0.length)
  out.set(bytes.subarray(0, 2), 0)
  out.set(app0, 2)
  out.set(bytes.subarray(2), 2 + app0.length)
  return new Blob([out], { type: 'image/jpeg' })
}
