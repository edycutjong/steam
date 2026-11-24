// Image primitives over plain typed arrays: grayscale, crop, area resampling, rotation, pixel hashes.

import { sha256Hex } from './sha256.ts'

/** 8-bit, one channel. */
export interface Gray {
  width: number
  height: number
  data: Uint8Array
}
/** 8-bit RGBA, row-major. */
export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}
export type Img = Gray | Rgba

const channelsOf = (img: Img): number => img.data.length / (img.width * img.height)

/** R2.1: integer luminance, rounded down. */
export function toGray(img: Rgba): Gray {
  const n = img.width * img.height
  const out = new Uint8Array(n)
  const d = img.data
  for (let i = 0; i < n; i++) out[i] = Math.floor((299 * d[i * 4]! + 587 * d[i * 4 + 1]! + 114 * d[i * 4 + 2]! + 500) / 1000)
  return { width: img.width, height: img.height, data: out }
}

/** Copy of the half-open window [x0,x1) x [y0,y1), clipped to the image. */
export function crop<T extends Img>(img: T, x0: number, y0: number, x1: number, y1: number): T {
  const c = channelsOf(img)
  x0 = Math.max(0, x0)
  y0 = Math.max(0, y0)
  x1 = Math.min(img.width, x1)
  y1 = Math.min(img.height, y1)
  const w = Math.max(0, x1 - x0)
  const h = Math.max(0, y1 - y0)
  const out = new Uint8Array(w * h * c)
  for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.width + x0) * c, ((y0 + y) * img.width + x0 + w) * c), y * w * c)
  return { ...img, width: w, height: h, data: out }
}

/** Area-averaging resample to w x h (R2.4). Exact box filter on fractional footprints. */
export function resampleArea<T extends Img>(img: T, w: number, h: number): T {
  const c = channelsOf(img)
  if (w === img.width && h === img.height) return { ...img, data: img.data.slice() }
  const out = new Uint8Array(w * h * c)
  const sx = img.width / w
  const sy = img.height / h
  const acc = new Float64Array(c)
  for (let y = 0; y < h; y++) {
    const fy0 = y * sy
    const fy1 = (y + 1) * sy
    for (let x = 0; x < w; x++) {
      const fx0 = x * sx
      const fx1 = (x + 1) * sx
      acc.fill(0)
      let wsum = 0
      for (let yy = Math.floor(fy0); yy < Math.min(img.height, Math.ceil(fy1)); yy++) {
        const wy = Math.min(yy + 1, fy1) - Math.max(yy, fy0)
        for (let xx = Math.floor(fx0); xx < Math.min(img.width, Math.ceil(fx1)); xx++) {
          const wx = Math.min(xx + 1, fx1) - Math.max(xx, fx0)
          const wt = wx * wy
          wsum += wt
          const p = (yy * img.width + xx) * c
          for (let k = 0; k < c; k++) acc[k]! += img.data[p + k]! * wt
        }
      }
      for (let k = 0; k < c; k++) out[(y * w + x) * c + k] = Math.round(acc[k]! / wsum)
    }
  }
  return { ...img, width: w, height: h, data: out }
}

/** R2.5: pixel-size constants are stated for 1600 px and scale with the frame width. */
export function scaleOf(frame: { width: number }): number {
  return frame.width / 1600
}

/**
 * Rotate `deg` clockwise (image y points down) about the centre, bilinear. Positive degrees turn a horizontal line
 * into one that descends to the right. Pixels that map outside the source take `fill`.
 */
export function rotate(g: Gray, deg: number, fill = 255): Gray {
  if (deg === 0) return { ...g, data: g.data.slice() }
  const a = (deg * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = (g.width - 1) / 2
  const cy = (g.height - 1) / 2
  const out = new Uint8Array(g.width * g.height)
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      const dx = x - cx
      const dy = y - cy
      // inverse rotation by -a
      const sxp = cx + dx * cos + dy * sin
      const syp = cy - dx * sin + dy * cos
      const x0 = Math.floor(sxp)
      const y0 = Math.floor(syp)
      if (x0 < 0 || y0 < 0 || x0 + 1 >= g.width || y0 + 1 >= g.height) {
        out[y * g.width + x] = sxp >= -0.5 && syp >= -0.5 && sxp <= g.width - 0.5 && syp <= g.height - 0.5 ? g.data[Math.min(g.height - 1, Math.max(0, Math.round(syp))) * g.width + Math.min(g.width - 1, Math.max(0, Math.round(sxp)))]! : fill
        continue
      }
      const fx = sxp - x0
      const fy = syp - y0
      const i = y0 * g.width + x0
      const v = g.data[i]! * (1 - fx) * (1 - fy) + g.data[i + 1]! * fx * (1 - fy) + g.data[i + g.width]! * (1 - fx) * fy + g.data[i + g.width + 1]! * fx * fy
      out[y * g.width + x] = Math.round(v)
    }
  }
  return { width: g.width, height: g.height, data: out }
}

/** R2.6: SHA-256 over width, height (big-endian u32) and the RGBA bytes, independent of PNG encoding. */
export function pixelSha256(img: Rgba): string {
  const buf = new Uint8Array(8 + img.data.length)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, img.width)
  dv.setUint32(4, img.height)
  buf.set(img.data, 8)
  return sha256Hex(buf)
}
