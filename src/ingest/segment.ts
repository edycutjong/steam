// Page -> region -> lines -> ownership, as one pure function over a grayscale page (R5 to R11).
// The CLI (tools/steam-ingest/segment.ts) reads and writes the files; the browser worker will call this too.

import { PROFILE_SIGMA, MIN_COMPONENT_PX, DESKEW_APPLY_MIN } from './constants.ts'
import { canonicalJson } from './canon.ts'
import { labelComponents, type Labels } from './components.ts'
import { estimateTilt } from './deskew.ts'
import { rotate, scaleOf, type Gray } from './image.ts'
import {
  chooseRegion, columnGroups, findBlocks, findLines, findMarginalia, findSeparators, rowProfile,
  type Block, type FoundLines, type Marginalia, type Region, type Separator,
} from './lines.ts'
import { ownership, type Bands, type Ownership } from './masks.ts'
import { sha256Hex } from './sha256.ts'
import { estimateSlant, type SlantEstimate } from './slant.ts'
import { inkMap, rawInk } from './threshold.ts'

export interface SegmentOptions {
  /** 0-based ordinal of a code-found block (R5.3). Never coordinates. */
  block?: number
}

export interface LineRecord {
  i: number
  /** [x0, y0, x1, y1] half-open: the ink extent of the line's rows within the region columns. */
  box: [number, number, number, number]
  coreBand: [number, number]
  peakRow: number
}

export interface SegmentResult {
  frame: { width: number; height: number }
  scale: number
  /** The grayscale page analysed (rotated when a deskew was applied). */
  gray: Gray
  deskewDeg: number
  deskewApplied: boolean
  raw: Uint8Array
  /** Ink of the whole page (R6.2). */
  pageInkMap: Uint8Array
  pitch: number
  pageLineCount: number
  columnWidth: number
  separators: Separator[]
  blocks: { lineCount: number; yMin: number; yMax: number }[]
  region: Region & { x0: number; x1: number }
  marginalia: Marginalia[]
  outsideRegionInkPx: number
  /** Ink inside the region: what ownership works on. Zero elsewhere. */
  ink: Uint8Array
  labels: Labels
  found: FoundLines
  bands: Bands
  own: Ownership
  slant: SlantEstimate
  lines: LineRecord[]
  /** Row ranges [from, to) from which each strip is cropped: valley to valley, region edge at the ends (R9.2). */
  stripRows: [number, number][]
  summary: string
}

const oddWindow = (scale: number): number => {
  const w = Math.round(41 * scale)
  return w % 2 ? w : w + 1
}

/** Components that are not line ink: specks, binding, shadow, stains (R5.1). */
function pageInkOf(ink: Uint8Array, labels: Labels): Uint8Array {
  const { width: w, height: h } = labels
  const bb = new Map<number, [number, number, number, number]>()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = labels.label[y * w + x]!
      if (id < 0) continue
      const b = bb.get(id)
      if (!b) bb.set(id, [x, y, x, y])
      else {
        if (x < b[0]) b[0] = x
        if (x > b[2]) b[2] = x
        if (y > b[3]) b[3] = y
      }
    }
  const keep = new Set<number>()
  for (const [id, b] of bb) {
    const size = labels.size.get(id)!
    const touches = b[0] === 0 || b[1] === 0 || b[2] === w - 1 || b[3] === h - 1
    if (size < MIN_COMPONENT_PX || touches || b[3] - b[1] + 1 > 0.25 * h || b[2] - b[0] + 1 > 0.6 * w) continue
    keep.add(id)
  }
  const out = new Uint8Array(ink.length)
  for (let i = 0; i < ink.length; i++) if (labels.label[i]! >= 0 && keep.has(labels.label[i]!)) out[i] = 1
  return out
}

/** Separator-search ink: everything but components that touch the border or are page-sized. */
function sepInkOf(ink: Uint8Array, labels: Labels): { ink: Uint8Array; labels: Labels } {
  const { width: w, height: h } = labels
  const bb = new Map<number, [number, number, number, number]>()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = labels.label[y * w + x]!
      if (id < 0) continue
      const b = bb.get(id)
      if (!b) bb.set(id, [x, y, x, y])
      else {
        if (x < b[0]) b[0] = x
        if (x > b[2]) b[2] = x
        if (y > b[3]) b[3] = y
      }
    }
  const drop = new Set<number>()
  for (const [id, b] of bb) if (b[0] === 0 || b[1] === 0 || b[2] === w - 1 || b[3] === h - 1 || b[3] - b[1] + 1 > 0.25 * h || b[2] - b[0] + 1 > 0.6 * w) drop.add(id)
  const out = new Uint8Array(ink.length)
  for (let i = 0; i < ink.length; i++) if (labels.label[i]! >= 0 && !drop.has(labels.label[i]!)) out[i] = 1
  return { ink: out, labels: { ...labels, label: labels.label.map((v) => (v >= 0 && !drop.has(v) ? v : -1)) } }
}

function analyse(gray: Gray, scale: number, opts: SegmentOptions) {
  const { width: w, height: h } = gray
  const win = oddWindow(scale)
  const raw = rawInk(gray, win)
  const ink0 = inkMap(gray, { win })
  const labels0 = labelComponents(ink0, w, h)
  const pageInk = pageInkOf(ink0, labels0)
  const page1 = findLines(rowProfile(pageInk, w, h), scale)
  const pitch = page1.pitch
  const col = new Float64Array(w)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) col[x]! += pageInk[y * w + x]!
  const groups = columnGroups(col, Math.max(1, Math.round(pitch / 2)))
  const main = groups.reduce((b, g) => (g.ink > b.ink ? g : b), groups[0] ?? { x0: 0, x1: w, ink: 0 })
  const colWidth = main.x1 - main.x0
  const sep = sepInkOf(ink0, labels0)
  const separators = findSeparators(sep.ink, sep.labels, { pitch, colWidth, scale })
  // line finding again, with the rule rows removed so a rule is never a line
  const cleaned = pageInk.slice()
  for (const s of separators) for (let y = s.y0; y <= s.y1; y++) for (let x = Math.max(0, s.x0 - 2); x <= Math.min(w - 1, s.x1 + 2); x++) cleaned[y * w + x] = 0
  const rowInk = rowProfile(cleaned, w, h)
  const page2 = findLines(rowInk, scale)
  const blocks: Block[] = findBlocks(page2.lines, separators, h)
  const region = chooseRegion(blocks, page2.lines, page2.pitch, opts.block)
  const m = findMarginalia(cleaned, w, region.y0, region.y1, page2.pitch)
  return { raw, ink0, labels0, pageInk: cleaned, page2, pitch: page2.pitch, colWidth, separators, blocks, region, m, rowInk }
}

export function segmentPage(grayIn: Gray, opts: SegmentOptions = {}): SegmentResult {
  const { width: w, height: h } = grayIn
  const scale = scaleOf({ width: w })
  let gray = grayIn
  let a = analyse(gray, scale, opts)
  // R7: tilt of the chosen block's ink
  const blockInk = new Uint8Array(w * h)
  for (let y = a.region.y0; y < a.region.y1; y++) for (let x = a.m.x0; x < a.m.x1; x++) blockInk[y * w + x] = a.pageInk[y * w + x]!
  const tilt = estimateTilt(blockInk, w, h)
  const deskewApplied = Math.abs(tilt) >= DESKEW_APPLY_MIN
  if (deskewApplied) {
    const hist = new Uint32Array(256)
    for (const v of gray.data) hist[v]!++
    let acc = 0
    let med = 255
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!
      if (acc * 2 >= gray.data.length) {
        med = v
        break
      }
    }
    gray = rotate(gray, -tilt, med)
    a = analyse(gray, scale, opts)
  }
  // Region ink (design 3.2 step 7a): whole components of the binarised page whose centroid lies inside the region
  // rectangle, minus border-touching and page-sized ones (R5.1). Whole components, so the region edge never cuts a
  // stroke; marginalia groups are outside the region columns and so not owned.
  const { region, m } = a
  const ink = new Uint8Array(w * h)
  let allInk = 0
  for (let i = 0; i < a.ink0.length; i++) allInk += a.ink0[i]!
  const L0 = a.labels0
  const stats = new Map<number, { sx: number; sy: number; x0: number; y0: number; x1: number; y1: number }>()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = L0.label[y * w + x]!
      if (id < 0) continue
      const st = stats.get(id)
      if (!st) stats.set(id, { sx: x, sy: y, x0: x, y0: y, x1: x, y1: y })
      else {
        st.sx += x
        st.sy += y
        if (x < st.x0) st.x0 = x
        if (x > st.x1) st.x1 = x
        if (y > st.y1) st.y1 = y
      }
    }
  const keep = new Set<number>()
  for (const [id, st] of stats) {
    const n = L0.size.get(id)!
    const cx = st.sx / n
    const cy = st.sy / n
    const touches = st.x0 === 0 || st.y0 === 0 || st.x1 === w - 1 || st.y1 === h - 1
    const huge = st.y1 - st.y0 + 1 > 0.25 * h || st.x1 - st.x0 + 1 > 0.6 * w
    if (!touches && !huge && cx >= m.x0 && cx < m.x1 && cy >= region.y0 && cy < region.y1) keep.add(id)
  }
  let inRegion = 0
  for (let i = 0; i < ink.length; i++)
    if (L0.label[i]! >= 0 && keep.has(L0.label[i]!)) {
      ink[i] = 1
      inRegion++
    }
  const labels = labelComponents(ink, w, h)
  const lineInk = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) if (ink[i] && labels.size.get(labels.label[i]!)! >= MIN_COMPONENT_PX) lineInk[i] = 1
  const found = findLines(rowProfile(lineInk, w, h), scale, PROFILE_SIGMA * scale)
  const bands: Bands = { cores: found.lines.map((l) => l.core), valleys: found.valleys }
  const own = ownership(labels, bands)
  const stripRows: [number, number][] = found.lines.map((_, i) => [i === 0 ? region.y0 : found.valleys[i - 1]!, i === found.lines.length - 1 ? region.y1 : found.valleys[i]!])
  const midOfRow = new Float64Array(h)
  stripRows.forEach(([a0, a1], i) => {
    const mid = (bands.cores[i]![0] + bands.cores[i]![1]) / 2
    for (let y = a0; y < a1; y++) midOfRow[y] = mid
  })
  const ownedInk = new Uint8Array(w * h)
  for (let i = 0; i < ownedInk.length; i++) ownedInk[i] = own.owner[i]! >= 0 ? 1 : 0
  const slant = estimateSlant(ownedInk, w, h, midOfRow)
  const lines: LineRecord[] = found.lines.map((l, i) => {
    const [r0, r1] = stripRows[i]!
    let x0 = w
    let x1 = -1
    let y0 = h
    let y1 = -1
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (own.owner[y * w + x] === i) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    return { i, box: x1 < 0 ? [m.x0, r0, m.x1, r1] : [x0, y0, x1 + 1, y1 + 1], coreBand: l.core, peakRow: l.peakRow }
  })
  const summary = `region rows ${region.y0}-${region.y1} columns ${m.x0}-${m.x1}, ${lines.length} lines, ${a.blocks.length} blocks (${a.blocks.map((b) => b.lineIdx.length).join('/')} lines), block ${region.blockIndex} (${region.selectedBy}), ${m.marginalia.length} marginalia, ${a.separators.length} separators`
  return {
    frame: { width: w, height: h }, scale, gray, deskewDeg: tilt, deskewApplied, raw: a.raw, pageInkMap: a.ink0, pitch: a.pitch,
    pageLineCount: a.page2.lines.length, columnWidth: a.colWidth, separators: a.separators,
    blocks: a.blocks.map((b) => ({ lineCount: b.lineIdx.length, yMin: b.yMin, yMax: b.yMax })),
    region: { ...region, x0: m.x0, x1: m.x1 }, marginalia: m.marginalia, outsideRegionInkPx: allInk - inRegion,
    ink, labels, found, bands, own, slant, lines, stripRows, summary,
  }
}

/** R9.3: `stripsHash` over the strips' pixel hashes in order; the run id over that and the lines without `segmentRun`. */
export function segmentRunOf(stripPixelHashes: string[], linesWithoutRun: unknown): { id: string; stripsHash: string } {
  const stripsHash = sha256Hex(new TextEncoder().encode(stripPixelHashes.join('')))
  const id = 'sr-' + sha256Hex(new TextEncoder().encode(stripsHash + canonicalJson(linesWithoutRun))).slice(0, 12)
  return { id, stripsHash }
}

// ---------------------------------------------------------------------------------------------------------------
// The segment stage as files (R9): lines.json, region.json, runs.json, strips, ownership/{splits.json, overlay.png}

import { crop, pixelSha256, rotateRgba, toGray, type Rgba } from './image.ts'
import { renderOverlay, splitsJson } from './masks.ts'
import { collectLinePixels, zeroRuns, type Run } from './runs.ts'

export interface LinesFile {
  segmentRun: { id: string; stripsHash: string }
  frame: { width: number; height: number }
  region: { x0: number; y0: number; x1: number; y1: number }
  selectedBy: 'default' | 'curator'
  blockIndex: number
  deskewDeg: number
  deskewApplied: boolean
  slant: number
  marginalia: { box: [number, number, number, number]; inkPx: number }[]
  outsideRegionInkPx: number
  lines: LineRecord[]
}

export interface RunsFile {
  segmentRun: { id: string; stripsHash: string }
  s: number
  projection: 'sheared' | 'vertical'
  lines: { line: number; yMid: number; lo: number; hi: number; runs: Run[] }[]
}

export interface SegmentFiles {
  seg: SegmentResult
  /** The scan in the analysis frame (rotated when the deskew was applied). */
  scan: Rgba
  lines: LinesFile
  region: unknown
  runs: RunsFile
  splits: unknown
  strips: Rgba[]
  overlay: Rgba
}

const medianRgb = (img: Rgba): [number, number, number] => {
  const out: number[] = []
  for (let c = 0; c < 3; c++) {
    const h = new Uint32Array(256)
    for (let i = c; i < img.data.length; i += 4) h[img.data[i]!]!++
    let acc = 0
    const n = img.width * img.height
    let v = 0
    for (; v < 256; v++) {
      acc += h[v]!
      if (acc * 2 >= n) break
    }
    out.push(v)
  }
  return out as [number, number, number]
}

/** Runs per line in sheared coordinates, from an owner map (R19.2). */
export function runsOf(owner: Int16Array, width: number, height: number, bands: Bands, s: number): RunsFile['lines'] {
  const lp = collectLinePixels(owner, width, height, bands.cores.length)
  return bands.cores.map((c, line) => {
    const yMid = (c[0] + c[1]) / 2
    const r = zeroRuns(lp[line]!, yMid, s)
    return { line, yMid, lo: r.lo, hi: r.hi, runs: r.runs }
  })
}

/** The whole segment stage over a decoded scan in the page frame. Deterministic (R9.6). */
export function segmentRecipe(scanIn: Rgba, opts: SegmentOptions = {}): SegmentFiles {
  const seg = segmentPage(toGray(scanIn), opts)
  const scan = seg.deskewApplied ? rotateRgba(scanIn, -seg.deskewDeg, medianRgb(scanIn)) : scanIn
  const { region } = seg
  const strips = seg.stripRows.map(([a, b]) => crop(scan, region.x0, a, region.x1, b))
  const body = {
    frame: seg.frame,
    region: { x0: region.x0, y0: region.y0, x1: region.x1, y1: region.y1 },
    selectedBy: region.selectedBy,
    blockIndex: region.blockIndex,
    deskewDeg: seg.deskewDeg,
    deskewApplied: seg.deskewApplied,
    slant: seg.slant.s,
    marginalia: seg.marginalia,
    outsideRegionInkPx: seg.outsideRegionInkPx,
    lines: seg.lines,
  }
  const segmentRun = segmentRunOf(strips.map(pixelSha256), body)
  const lines: LinesFile = { segmentRun, ...body }
  const regionFile = {
    segmentRun,
    pitch: seg.pitch,
    columnWidth: seg.columnWidth,
    pageLineCount: seg.pageLineCount,
    separators: seg.separators,
    blocks: seg.blocks.map((b, i) => ({ index: i, ...b })),
    chosen: { blockIndex: region.blockIndex, selectedBy: region.selectedBy, rows: [region.y0, region.y1], columns: [region.x0, region.x1] },
    marginaliaCount: seg.marginalia.length,
    summary: seg.summary,
  }
  const runs: RunsFile = {
    segmentRun,
    s: seg.slant.s,
    projection: seg.slant.vertical ? 'vertical' : 'sheared',
    lines: runsOf(seg.own.owner, seg.frame.width, seg.frame.height, seg.bands, seg.slant.s),
  }
  const splits = { segmentRun, total: seg.own.splits.length, splits: splitsJson(seg.own) }
  return { seg, scan, lines, region: regionFile, runs, splits, strips, overlay: renderOverlay(scan, seg.own, seg.labels, seg.bands) }
}
