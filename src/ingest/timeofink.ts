// Skeleton, traced path and reveal times (R22). "A path traced from the ink, left to right": it is a sort of skeleton
// pixels by sheared column, not the writer's pen order, and nothing here says otherwise.

import { labelComponents } from './components.ts'

/** Zhang-Suen thinning. Out-of-image pixels count as background. */
export function zhangSuen(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) img[i] = mask[i] ? 1 : 0
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]!)
  const del: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1)
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let A = 0
          for (let k = 0; k < 8; k++) if (seq[k] === 0 && seq[k + 1] === 1) A++
          if (A !== 1) continue
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
          del.push(y * w + x)
        }
      if (del.length) {
        changed = true
        for (const i of del) img[i] = 0
      }
    }
  }
  return img
}

export interface GroupInput {
  /** Line index; groups are ordered by it. */
  line: number
  /** The note's owned pixels in this line, in crop coordinates (w*h, 0/1). */
  mask: Uint8Array
  /** Vertical middle of the line's core band, in crop rows. */
  yMid: number
}

export interface PathPoint {
  /** Index into `Trace.groups`. */
  group: number
  x: number
  y: number
  /** Sheared column x - s (yMid - y). */
  xp: number
  t: number
}

export interface TraceGroup {
  line: number
  yMid: number
  /** Least and greatest sheared column of the skeleton. */
  lo: number
  hi: number
  /** [t0, t1] of this group. */
  t: [number, number]
  skeletonPx: number
  /** Skeleton pixels of this group, in path order. */
  sk: { x: Int32Array; y: Int32Array; xp: Float64Array; t: Float64Array }
}

export interface Trace {
  groups: TraceGroup[]
  /** All skeleton pixels sorted by (group, x', y). */
  path: PathPoint[]
  /** Sum of group widths (hi - lo), at least 1. */
  totalWidth: number
  s: number
}

/** R22.1, R22.2. */
export function tracePath(inputs: GroupInput[], w: number, h: number, s: number): Trace {
  const ordered = [...inputs].sort((a, b) => a.line - b.line)
  const skel = ordered.map((g) => zhangSuen(g.mask, w, h))
  const raw = ordered.map((g, gi) => {
    const pts: { x: number; y: number; xp: number }[] = []
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (skel[gi]![y * w + x]) pts.push({ x, y, xp: x - s * (g.yMid - y) })
    pts.sort((a, b) => a.xp - b.xp || a.y - b.y || a.x - b.x)
    return pts
  })
  const widths = raw.map((p) => (p.length ? p[p.length - 1]!.xp - p[0]!.xp : 0))
  const total = Math.max(1, widths.reduce((a, b) => a + b, 0))
  const groups: TraceGroup[] = []
  const path: PathPoint[] = []
  let offset = 0
  raw.forEach((pts, gi) => {
    const lo = pts.length ? pts[0]!.xp : 0
    const hi = pts.length ? pts[pts.length - 1]!.xp : 0
    const sk = { x: new Int32Array(pts.length), y: new Int32Array(pts.length), xp: new Float64Array(pts.length), t: new Float64Array(pts.length) }
    pts.forEach((p, k) => {
      const t = (offset + (p.xp - lo)) / total
      sk.x[k] = p.x
      sk.y[k] = p.y
      sk.xp[k] = p.xp
      sk.t[k] = t
      path.push({ group: gi, x: p.x, y: p.y, xp: p.xp, t })
    })
    groups.push({ line: ordered[gi]!.line, yMid: ordered[gi]!.yMid, lo, hi, t: [offset / total, (offset + widths[gi]!) / total], skeletonPx: pts.length, sk })
    offset += widths[gi]!
  })
  return { groups, path, totalWidth: total, s }
}

/** Time of the skeleton pixel nearest to (x, y) in group `gi`; ties go to the lower x', then the lower y (R22.3). */
export function nearestTime(tr: Trace, gi: number, x: number, y: number): number {
  const g = tr.groups[gi]!
  const n = g.skeletonPx
  if (n === 0) return g.t[0]
  let best = 0
  let bd = Infinity
  for (let k = 0; k < n; k++) {
    const d = (g.sk.x[k]! - x) ** 2 + (g.sk.y[k]! - y) ** 2
    // skeleton arrays are already sorted by (x', y), so the first minimum is the tie winner
    if (d < bd) {
      bd = d
      best = k
    }
  }
  return g.sk.t[best]!
}

export interface TimeMap {
  /** Reveal time in [0, 1] per mask pixel, NaN elsewhere. */
  t: Float32Array
  /** Group index per mask pixel, -1 elsewhere. */
  group: Int16Array
}

/** R22.3: each mask pixel takes the time of its nearest skeleton pixel in its own group; skeleton-free pieces take their centroid's. */
export function timeMap(tr: Trace, inputs: GroupInput[], w: number, h: number, s: number): TimeMap {
  const ordered = [...inputs].sort((a, b) => a.line - b.line)
  const t = new Float32Array(w * h).fill(NaN)
  const group = new Int16Array(w * h).fill(-1)
  ordered.forEach((g, gi) => {
    const tg = tr.groups[gi]!
    const lab = labelComponents(g.mask, w, h)
    const pieceHasSk = new Set<number>()
    for (let k = 0; k < tg.skeletonPx; k++) pieceHasSk.add(lab.label[tg.sk.y[k]! * w + tg.sk.x[k]!]!)
    const centroid = new Map<number, number>()
    for (const id of lab.ids) if (!pieceHasSk.has(id)) centroid.set(id, 0)
    if (centroid.size) {
      const sum = new Map<number, number>()
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const id = lab.label[y * w + x]!
          if (centroid.has(id)) sum.set(id, (sum.get(id) ?? 0) + (x - s * (g.yMid - y)))
        }
      for (const id of centroid.keys()) {
        const xpc = sum.get(id)! / lab.size.get(id)!
        const raw = tg.skeletonPx ? tg.t[0] + ((xpc - tg.lo) / tr.totalWidth) : tg.t[0]
        centroid.set(id, Math.min(tg.t[1], Math.max(tg.t[0], raw)))
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!g.mask[y * w + x]) continue
        const id = lab.label[y * w + x]!
        t[y * w + x] = centroid.has(id) ? centroid.get(id)! : nearestTime(tr, gi, x, y)
        group[y * w + x] = gi
      }
  })
  return { t, group }
}

/**
 * Times for every pixel of `support` (the pixels that will carry alpha): mask pixels by `timeMap`; other pixels
 * (the thin shell) take the time of the nearest mask pixel's group and its nearest skeleton pixel (ties: lower group,
 * then the first found in raster order). Pixels farther than `reach` from any mask pixel get NaN.
 */
export function revealTimes(tr: Trace, inputs: GroupInput[], w: number, h: number, s: number, support: Uint8Array, reach = 3): TimeMap {
  const base = timeMap(tr, inputs, w, h, s)
  const t = base.t.slice()
  const group = base.group.slice()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!support[i] || group[i]! >= 0) continue
      let bd = Infinity
      let bg = -1
      for (let dy = -reach; dy <= reach; dy++)
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const g = base.group[ny * w + nx]!
          if (g < 0) continue
          const d = dx * dx + dy * dy
          if (d < bd || (d === bd && g < bg)) (bd = d, (bg = g))
        }
      if (bg >= 0) {
        group[i] = bg
        t[i] = nearestTime(tr, bg, x, y)
      }
    }
  return { t, group }
}

// ---------------------------------------------------------------------------------------------------------------
// Note build (R21, R23): mask, support, alpha from the scan's own darkness, toi.png

import { ALPHA_DARKNESS_RANGE, NOTE_FAINT_REACH_PX, NOTE_MARGIN_PX, PAPER_WINDOW } from './constants.ts'
import type { Gray, Rgba } from './image.ts'
import type { Bands, NoteOwnership, Ownership } from './masks.ts'
import type { PartAlignment } from './align.ts'
import { assignWords } from './align.ts'
import { collectLinePixels, type LinePixels } from './runs.ts'

/** Chebyshev dilation by `r` pixels (separable max). */
export function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m.slice()
  const tmp = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r) && !v; k++) v = m[y * w + k]!
      tmp[y * w + x] = v
    }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r) && !v; k++) v = tmp[k * w + x]!
      out[y * w + x] = v
    }
  return out
}

/**
 * Local paper estimate (R21.2): the median gray of the pixels in a `win` x `win` window that are not within 2 px of
 * raw ink. Windows with fewer than 10 such pixels take the crop-wide median of them.
 */
export function paperEstimate(gray: Gray, rawInkCrop: Uint8Array, win = PAPER_WINDOW): { paper: Float32Array; median: number } {
  const { width: w, height: h } = gray
  const excl = dilate(rawInkCrop, w, h, 2)
  const all = new Uint32Array(256)
  let nAll = 0
  for (let i = 0; i < w * h; i++) if (!excl[i]) (all[gray.data[i]!]!++, nAll++)
  const medOf = (hist: Uint32Array, n: number): number => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!
      if (acc * 2 >= n) return v
    }
    return 255
  }
  const globalMedian = nAll ? medOf(all, nAll) : 255
  const r = win >> 1
  const paper = new Float32Array(w * h)
  const hist = new Uint32Array(256)
  for (let y = 0; y < h; y++) {
    hist.fill(0)
    let n = 0
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h - 1, y + r)
    const addCol = (x: number, sign: 1 | -1): void => {
      for (let yy = y0; yy <= y1; yy++) {
        const i = yy * w + x
        if (excl[i]) continue
        hist[gray.data[i]!]! += sign
        n += sign
      }
    }
    for (let x = 0; x <= Math.min(w - 1, r - 1); x++) addCol(x, 1)
    for (let x = 0; x < w; x++) {
      if (x + r < w) addCol(x + r, 1)
      if (x - r - 1 >= 0) addCol(x - r - 1, -1)
      paper[y * w + x] = n >= 10 ? medOf(hist, n) : globalMedian
    }
  }
  return { paper, median: globalMedian }
}

export interface BuiltPart extends PartAlignment {
  /** True when the whole owned line is quoted or the fallback to whole lines applies. */
  whole: boolean
}

export interface NoteBuildInput {
  noteId: string
  step: number
  span: string
  shownText: string
  granularity: 'words' | 'lines'
  alignment: 'auto' | 'curator' | 'lines'
  /** Credit string from source.json. */
  credit: string
  scan: Rgba
  gray: Gray
  /** `gray < T_sauvola` over the page (R6.3). */
  raw: Uint8Array
  /** Every binarised ink pixel of the page, owned or not (R6.2): what faint pixels must keep 1 px away from. */
  pageInk: Uint8Array
  own: Ownership
  bands: Bands
  s: number
  resampled: boolean
  parts: BuiltPart[]
  /** The note's crop mask from `cropSource` (the bundle's crop source). Absent: built here from `parts`, the same ownership mask. */
  mask?: Uint8Array
  ownership: NoteOwnership
}

export interface NoteGroupJson {
  line: number
  rect: [number, number, number, number]
  coreBand: [number, number]
  t: [number, number]
  inkPx: number
  words: { from: number; to: number } | 'line'
}

/** notes/note-<id>.json without `verifyUrl`, which bundle.ts adds from `pageBox` (R23.3). */
export interface NoteCore {
  noteId: string
  step: number
  span: string
  shownText: string
  granularity: 'words' | 'lines'
  alignment: 'auto' | 'curator' | 'lines'
  source: string
  pageBox: [number, number, number, number]
  size: [number, number]
  resampled: boolean
  groups: NoteGroupJson[]
  splitShare: number
  splitStatus: 'auto' | 'reviewed' | 'failed'
}

export interface BuiltNote {
  core: NoteCore
  /** note-<id>.png: scan RGB, alpha = continuous ink darkness. */
  png: Rgba
  /** note-<id>.toi.png: R alpha, G reveal time, B density. */
  toi: Rgba
  /** Page-size 0/1 mask of the note's owned ink. */
  mask: Uint8Array
  /** Crop-size mask per group, for P6. */
  groups: GroupInput[]
  trace: Trace
  /** Crop-size 0/1 of the pixels with alpha > 0. */
  support: Uint8Array
  pageBox: [number, number, number, number]
}

const gaussian2d = (src: Float32Array, w: number, h: number, sigma: number): Float32Array => {
  const r = Math.ceil(3 * sigma)
  const k: number[] = []
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)))
  const ks = k.reduce((a, b) => a + b, 0)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) if (x + i >= 0 && x + i < w) s += src[y * w + x + i]! * k[i + r]!
      tmp[y * w + x] = s / ks
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) if (y + i >= 0 && y + i < h) s += tmp[(y + i) * w + x]! * k[i + r]!
      out[y * w + x] = s / ks
    }
  return out
}

/**
 * The note mask in the page frame: owned ink of the quoted lines, inside the word regions of aligned parts (R21.1).
 */
export function noteMask(own: Ownership, bands: Bands, s: number, parts: BuiltPart[], linePixels?: LinePixels[]): Uint8Array {
  const { width: w, height: h } = own
  const lp = linePixels ?? collectLinePixels(own.owner, w, h, bands.cores.length)
  const mask = new Uint8Array(w * h)
  for (const p of parts) {
    const px = lp[p.line]!
    const yMid = (bands.cores[p.line]![0] + bands.cores[p.line]![1]) / 2
    const word = p.whole ? null : assignWords(px, yMid, s, p.boundaries)
    for (let i = 0; i < px.xs.length; i++) {
      if (word && (word[i]! < p.fromWord || word[i]! > p.toWord)) continue
      mask[px.ys[i]! * w + px.xs[i]!] = 1
    }
  }
  return mask
}

/**
 * R21, R22, R23 with the continuous-alpha rule of design 3.6.
 *
 * Support (where alpha may be non-zero) = the mask, plus non-ink pixels within NOTE_FAINT_REACH_PX (2) of the mask
 * that are more than 1 px from any ink pixel outside the mask. Alpha there is the scan's own darkness,
 * clip((paper - gray) / D, 0, 1) with D = max(90, paper median - 1st percentile of the mask's gray), so the pen's
 * pressure variation and the faint hairlines survive. RGB under alpha > 0 is the scan's own.
 */
export function buildNote(inp: NoteBuildInput): BuiltNote {
  const { own, bands, scan } = inp
  const W = own.width
  const H = own.height
  const mask = inp.mask ?? noteMask(own, bands, inp.s, inp.parts)
  let x0 = W
  let y0 = H
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) throw new Error(`note ${inp.noteId}: the quoted words own no ink`)
  const px0 = Math.max(0, x0 - NOTE_MARGIN_PX)
  const py0 = Math.max(0, y0 - NOTE_MARGIN_PX)
  const px1 = Math.min(W, x1 + 1 + NOTE_MARGIN_PX)
  const py1 = Math.min(H, y1 + 1 + NOTE_MARGIN_PX)
  const cw = px1 - px0
  const ch = py1 - py0
  const cropOf = (src: Uint8Array): Uint8Array => {
    const o = new Uint8Array(cw * ch)
    for (let y = 0; y < ch; y++) o.set(src.subarray((y + py0) * W + px0, (y + py0) * W + px0 + cw), y * cw)
    return o
  }
  const gray: Gray = { width: cw, height: ch, data: cropOf(inp.gray.data) }
  const m = cropOf(mask)
  const inkC = new Uint8Array(cw * ch)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) inkC[y * cw + x] = own.owner[(y + py0) * W + x + px0]! >= 0 || inp.pageInk[(y + py0) * W + x + px0] ? 1 : 0
  const other = new Uint8Array(cw * ch)
  for (let i = 0; i < other.length; i++) other[i] = inkC[i]! && !m[i] ? 1 : 0
  const near1 = dilate(other, cw, ch, 1)
  const reach = dilate(m, cw, ch, NOTE_FAINT_REACH_PX)
  const support = new Uint8Array(cw * ch)
  for (let i = 0; i < support.length; i++) support[i] = m[i]! || (reach[i]! && !inkC[i]! && !near1[i]!) ? 1 : 0

  const { paper, median } = paperEstimate(gray, cropOf(inp.raw))
  const maskGray: number[] = []
  for (let i = 0; i < m.length; i++) if (m[i]) maskGray.push(gray.data[i]!)
  maskGray.sort((a, b) => a - b)
  const dark = maskGray[Math.floor(0.01 * (maskGray.length - 1))]!
  const D = Math.max(ALPHA_DARKNESS_RANGE, median - dark)
  const alpha = new Uint8Array(cw * ch)
  for (let i = 0; i < alpha.length; i++) if (support[i]) alpha[i] = Math.round(255 * Math.min(1, Math.max(0, (paper[i]! - gray.data[i]!) / D)))
  // The support is the set where alpha may be non-zero; pixels with alpha 0 drop out of it.
  const live = new Uint8Array(cw * ch)
  for (let i = 0; i < live.length; i++) live[i] = alpha[i]! > 0 ? 1 : 0

  // Paper colour for RGB under alpha 0: the per-channel median of the crop's non-ink pixels.
  const excl = dilate(cropOf(inp.raw), cw, ch, 2)
  const chan: number[][] = [[], [], []]
  for (let i = 0; i < excl.length; i++)
    if (!excl[i]) {
      const o = ((Math.floor(i / cw) + py0) * W + (i % cw) + px0) * 4
      for (let c = 0; c < 3; c++) chan[c]!.push(scan.data[o + c]!)
    }
  const paperRgb = chan.map((a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1]! : 255))
  const png: Rgba = { width: cw, height: ch, data: new Uint8Array(cw * ch * 4) }
  for (let i = 0; i < cw * ch; i++) {
    const o = ((Math.floor(i / cw) + py0) * W + (i % cw) + px0) * 4
    for (let c = 0; c < 3; c++) png.data[i * 4 + c] = live[i] ? scan.data[o + c]! : paperRgb[c]!
    png.data[i * 4 + 3] = alpha[i]!
  }

  // Groups, trace, times
  const groupInputs: GroupInput[] = []
  const lines = [...new Set(inp.parts.map((p) => p.line))].sort((a, b) => a - b)
  for (const line of lines) {
    const gm = new Uint8Array(cw * ch)
    for (let i = 0; i < gm.length; i++) {
      const gx = (i % cw) + px0
      const gy = Math.floor(i / cw) + py0
      if (m[i] && own.owner[gy * W + gx] === line) gm[i] = 1
    }
    groupInputs.push({ line, mask: gm, yMid: (bands.cores[line]![0] + bands.cores[line]![1]) / 2 - py0 })
  }
  const trace = tracePath(groupInputs, cw, ch, inp.s)
  const rt = revealTimes(trace, groupInputs, cw, ch, inp.s, live)
  const dens = new Float32Array(cw * ch)
  for (let i = 0; i < dens.length; i++) dens[i] = alpha[i]! / 255
  const blur = gaussian2d(dens, cw, ch, 2)
  let bmax = 0
  for (let i = 0; i < blur.length; i++) if (live[i] && blur[i]! > bmax) bmax = blur[i]!
  const toi: Rgba = { width: cw, height: ch, data: new Uint8Array(cw * ch * 4) }
  for (let i = 0; i < cw * ch; i++) {
    if (!live[i]) continue
    toi.data[i * 4] = alpha[i]!
    toi.data[i * 4 + 1] = Math.round(255 * rt.t[i]!)
    toi.data[i * 4 + 2] = Math.round((255 * blur[i]!) / bmax)
    toi.data[i * 4 + 3] = 255
  }

  const groups: NoteGroupJson[] = groupInputs.map((g, gi) => {
    let gx0 = cw
    let gy0 = ch
    let gx1 = -1
    let gy1 = -1
    let n = 0
    for (let i = 0; i < g.mask.length; i++)
      if (g.mask[i]) {
        const x = i % cw
        const y = Math.floor(i / cw)
        n++
        gx0 = Math.min(gx0, x)
        gx1 = Math.max(gx1, x)
        gy0 = Math.min(gy0, y)
        gy1 = Math.max(gy1, y)
      }
    const part = inp.parts.find((p) => p.line === g.line)!
    return {
      line: g.line,
      rect: [gx0, gy0, gx1 + 1, gy1 + 1],
      coreBand: [bands.cores[g.line]![0] - py0, bands.cores[g.line]![1] - py0],
      t: [trace.groups[gi]!.t[0], trace.groups[gi]!.t[1]],
      inkPx: n,
      words: part.whole ? 'line' : { from: part.fromWord, to: part.toWord },
    }
  })
  const pageBox: [number, number, number, number] = [px0, py0, px1, py1]
  const core: NoteCore = {
    noteId: inp.noteId,
    step: inp.step,
    span: inp.span,
    shownText: inp.shownText,
    granularity: inp.granularity,
    alignment: inp.alignment,
    source: inp.credit,
    pageBox,
    size: [cw, ch],
    resampled: inp.resampled,
    groups,
    splitShare: inp.ownership.share,
    splitStatus: inp.ownership.status,
  }
  return { core, png, toi, mask, groups: groupInputs, trace, support: live, pageBox }
}
