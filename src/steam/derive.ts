// One-time CPU derivation of the channel texture and the writing-head path.
// Pure: bytes in, typed arrays out. Runs in the browser, in Node and in vitest.

export interface PixelSource {
  /** RGBA bytes, length width * height * 4 (ImageData layout). */
  data: ArrayLike<number>
  width: number
  height: number
}

export interface Derived {
  /** RGBA, w*h*4. R channel alpha, G toi, B pressure, A hull feather. */
  chan: Uint8Array
  /** headBins * 2 floats: smoothed frontier centroid (x, y) in note px per toi bin. */
  head: Float32Array
  headBins: number
}

export const DILATE_PX = 2
export const SOFT_PX = 2
export const HEAD_BINS = 256
const PRESSURE_SCAN_BLEND = 0.12

function dilationOffsets(radius: number): Int32Array {
  const out: number[] = []
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) out.push(dx, dy)
    }
  }
  return Int32Array.from(out)
}

/** Channel alpha, toi and pressure. Writes R, G and B of `chan`. */
function deriveChannel(toi: PixelSource, note: PixelSource, chan: Uint8Array): void {
  const { width: w, height: h } = toi
  const t = toi.data
  const n = note.data
  const offs = dilationOffsets(DILATE_PX)
  const dil = new Float32Array(w * h)
  const press = new Float32Array(w * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let bestD = Infinity
      let bestT = 0
      let bestP = 0
      let maxA = 0
      for (let k = 0; k < offs.length; k += 2) {
        const xx = x + offs[k]
        const yy = y + offs[k + 1]
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const q = (yy * w + xx) * 4
        const a = t[q]
        if (a === 0) continue
        if (a > maxA) maxA = a
        const d = offs[k] * offs[k] + offs[k + 1] * offs[k + 1]
        const tt = t[q + 1]
        if (d < bestD || (d === bestD && tt < bestT)) {
          bestD = d
          bestT = tt
          bestP = t[q + 2]
        }
      }
      if (maxA === 0) continue
      dil[p] = maxA
      const o = p * 4
      chan[o + 1] = bestT
      const na = n[o + 3] / 255
      const luma = (0.2126 * n[o] + 0.7152 * n[o + 1] + 0.0722 * n[o + 2]) / 255
      const dark = (1 - luma) * na
      press[p] = (1 - PRESSURE_SCAN_BLEND) * bestP + PRESSURE_SCAN_BLEND * dark * 255
    }
  }

  // Separable box blur of the dilated alpha.
  const tmp = new Float32Array(w * h)
  const r = SOFT_PX
  const inv = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let k = -r; k <= r; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w) s += dil[row + xx]
      }
      tmp[row + x] = s * inv
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let k = -r; k <= r; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h) s += tmp[yy * w + x]
      }
      const p = y * w + x
      const inkA = t[p * 4]
      const o = p * 4
      chan[o] = Math.min(255, Math.max(inkA, Math.round(s * inv)))
      chan[o + 2] = Math.min(255, Math.max(0, Math.round(press[p])))
    }
  }
}

export function derive(toi: PixelSource, note: PixelSource): Derived {
  if (toi.width !== note.width || toi.height !== note.height) {
    throw new Error('derive: toi and note sizes differ')
  }
  const chan = new Uint8Array(toi.width * toi.height * 4)
  deriveChannel(toi, note, chan)
  return { chan, head: new Float32Array(HEAD_BINS * 2), headBins: HEAD_BINS }
}
