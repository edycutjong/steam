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
  /** w*h. The scan's own continuous ink alpha (the toi map's R, 133 levels on the hero note), uploaded as the mipmapped `uInk`. */
  ink: Uint8Array
  /** w*h*2. R the ink alpha, G alpha times time-of-ink: mip-blurred, G/R is the mean time-of-ink of the neighbourhood (the halo's wipe gate). */
  inkRG: Uint8Array
  /** headBins * 2 floats: smoothed frontier centroid (x, y) in note px per toi bin. */
  head: Float32Array
  headBins: number
}

/** Channel follows the scan's own alpha: no growth, one texel of softening (D6). */
export const DILATE_PX = 0
export const SOFT_PX = 1
/**
 * Weight of the blur shoulder in channel alpha (D12). The blur only feeds the faint outer shoulder used by the
 * rim and bloom taps. Weighted this low, the pixels next to a solid stroke (blur about 0.67) stay at about 0.23,
 * under the clear band of `clearCurve`, so the revealed channel does not grow past the scan's own ink.
 */
export const SHOULDER = 0.35
export const TOI_REACH_PX = DILATE_PX + SOFT_PX + 1
export const HULL_DILATE_PX = 6
export const HULL_FEATHER_PX = 24
export const HEAD_BINS = 256
export const HEAD_SMOOTH_BINS = 7
/** Neighbour bins farther than this (note px) are not averaged in, so the head does not glide between lines. */
export const HEAD_JUMP_PX = 120
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
  // Toi and pressure reach as far as the blurred alpha halo (plus one texel for bilinear
  // sampling), so no pixel with alpha > 0 has toi 0 and shows before its stroke is written.
  const offsT = dilationOffsets(TOI_REACH_PX)
  const reach2 = DILATE_PX * DILATE_PX
  const dil = new Float32Array(w * h)
  const press = new Float32Array(w * h)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let bestD = Infinity
      let bestT = 0
      let bestP = 0
      let maxA = 0
      for (let k = 0; k < offsT.length; k += 2) {
        const xx = x + offsT[k]
        const yy = y + offsT[k + 1]
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const q = (yy * w + xx) * 4
        const a = t[q]
        if (a === 0) continue
        const d = offsT[k] * offsT[k] + offsT[k + 1] * offsT[k + 1]
        if (d <= reach2 && a > maxA) maxA = a
        const tt = t[q + 1]
        if (d < bestD || (d === bestD && tt < bestT)) {
          bestD = d
          bestT = tt
          bestP = t[q + 2]
        }
      }
      if (bestD === Infinity) continue
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
      chan[o] = Math.min(255, Math.max(inkA, Math.round(s * inv * SHOULDER)))
      chan[o + 2] = Math.min(255, Math.max(0, Math.round(press[p])))
    }
  }
}

const INF = 1e9

/** Two-pass 3-4 chamfer distance from ink pixels, in px (never below the Euclidean distance by more than rounding). */
function chamferFromInk(toi: PixelSource): Float32Array {
  const { width: w, height: h } = toi
  const d = new Float32Array(w * h)
  for (let p = 0; p < w * h; p++) d[p] = toi.data[p * 4] > 0 ? 0 : INF
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let v = d[p]
      if (x > 0) v = Math.min(v, d[p - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[p - w] + 3)
        if (x > 0) v = Math.min(v, d[p - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[p - w + 1] + 4)
      }
      d[p] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x
      let v = d[p]
      if (x < w - 1) v = Math.min(v, d[p + 1] + 3)
      if (y < h - 1) {
        v = Math.min(v, d[p + w] + 3)
        if (x < w - 1) v = Math.min(v, d[p + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[p + w - 1] + 4)
      }
      d[p] = v
    }
  }
  for (let p = 0; p < w * h; p++) d[p] = d[p] / 3
  return d
}

/** Writes the hull feather into the A channel. */
function deriveHull(toi: PixelSource, chan: Uint8Array): void {
  const { width: w, height: h } = toi
  const dist = chamferFromInk(toi)
  for (let p = 0; p < w * h; p++) {
    const outside = Math.max(0, dist[p] - HULL_DILATE_PX)
    const x = Math.min(1, outside / HULL_FEATHER_PX)
    const smooth = x * x * (3 - 2 * x)
    chan[p * 4 + 3] = Math.round((1 - smooth) * 255)
  }
}

function deriveHead(toi: PixelSource): Float32Array {
  const { width: w, height: h } = toi
  const sw = new Float64Array(HEAD_BINS)
  const sx = new Float64Array(HEAD_BINS)
  const sy = new Float64Array(HEAD_BINS)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const a = toi.data[o]
      if (a === 0) continue
      const bin = Math.min(HEAD_BINS - 1, toi.data[o + 1])
      sw[bin] += a
      sx[bin] += a * (x + 0.5)
      sy[bin] += a * (y + 0.5)
    }
  }
  const raw = new Float32Array(HEAD_BINS * 2)
  const have = new Uint8Array(HEAD_BINS)
  for (let b = 0; b < HEAD_BINS; b++) {
    if (sw[b] > 0) {
      raw[b * 2] = sx[b] / sw[b]
      raw[b * 2 + 1] = sy[b] / sw[b]
      have[b] = 1
    }
  }
  // Empty bins carry the previous bin; leading empties take the first non-empty bin.
  let first = -1
  for (let b = 0; b < HEAD_BINS; b++) {
    if (have[b]) {
      first = b
      break
    }
  }
  if (first < 0) return new Float32Array(HEAD_BINS * 2).fill(0)
  for (let b = 0; b < first; b++) {
    raw[b * 2] = raw[first * 2]
    raw[b * 2 + 1] = raw[first * 2 + 1]
  }
  for (let b = first + 1; b < HEAD_BINS; b++) {
    if (!have[b]) {
      raw[b * 2] = raw[(b - 1) * 2]
      raw[b * 2 + 1] = raw[(b - 1) * 2 + 1]
    }
  }
  const out = new Float32Array(HEAD_BINS * 2)
  const half = (HEAD_SMOOTH_BINS - 1) / 2
  for (let b = 0; b < HEAD_BINS; b++) {
    let ax = 0
    let ay = 0
    let c = 0
    for (let k = -half; k <= half; k++) {
      const q = b + k
      if (q < 0 || q >= HEAD_BINS) continue
      if (Math.hypot(raw[q * 2] - raw[b * 2], raw[q * 2 + 1] - raw[b * 2 + 1]) > HEAD_JUMP_PX) continue
      ax += raw[q * 2]
      ay += raw[q * 2 + 1]
      c++
    }
    out[b * 2] = ax / c
    out[b * 2 + 1] = ay / c
  }
  return out
}

export function derive(toi: PixelSource, note: PixelSource): Derived {
  if (toi.width !== note.width || toi.height !== note.height) {
    throw new Error('derive: toi and note sizes differ')
  }
  const chan = new Uint8Array(toi.width * toi.height * 4)
  deriveChannel(toi, note, chan)
  deriveHull(toi, chan)
  const ink = new Uint8Array(toi.width * toi.height)
  const inkRG = new Uint8Array(ink.length * 2)
  for (let p = 0; p < ink.length; p++) {
    ink[p] = toi.data[p * 4]
    inkRG[2 * p] = ink[p]
    inkRG[2 * p + 1] = Math.round((ink[p] * toi.data[p * 4 + 1]) / 255)
  }
  return { chan, ink, inkRG, head: deriveHead(toi), headBins: HEAD_BINS }
}
