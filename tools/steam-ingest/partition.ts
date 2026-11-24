// steam-ingest partition <id> --line <n> [--png <path>]: the candidates of a component-partition boundary (R19.9).
// Lists the line's owned components in order and the gaps between them, ranked; with --png draws the strip with every
// component tinted and a numbered tick at each candidate. Reads the recipe folder, writes only the PNG it is told to.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Lines, OwnershipReview } from '../../src/data/schema.ts'
import { RUN_MIN_PX } from '../../src/ingest/constants.ts'
import { crop, type Rgba } from '../../src/ingest/image.ts'
import { applyReview } from '../../src/ingest/masks.ts'
import { lineComponents, partitionCandidates, type PartCandidate, type PartComponent } from '../../src/ingest/partition.ts'
import { runsOf, segmentRecipe } from '../../src/ingest/segment.ts'
import { writePng } from './io.ts'
import { loadScan } from './segment.ts'

export interface PartitionReport {
  line: number
  /** The shear the pipeline measured. */
  s: number
  /** The line's text extent in sheared columns. */
  extent: [number, number]
  components: PartComponent[]
  candidates: (PartCandidate & { run: boolean })[]
}

// 3 x 5 digits, row by row, for the tick labels
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'], '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'], '9': ['111', '101', '111', '001', '111'],
}
const TINTS: [number, number, number][] = [[231, 76, 60], [52, 152, 219], [46, 204, 113], [241, 196, 15], [155, 89, 182], [26, 188, 156]]

export function partitionCmd(dir: string, o: { line: number; png?: string; scale?: number }): PartitionReport {
  const lines = Lines.parse(JSON.parse(readFileSync(join(dir, 'lines.json'), 'utf8')))
  const { scan } = loadScan(dir)
  const sf = segmentRecipe(scan, lines.selectedBy === 'curator' ? { block: lines.blockIndex } : {})
  const seg = sf.seg
  if (o.line < 0 || o.line >= seg.bands.cores.length) throw new Error(`no line ${o.line} (the page has ${seg.bands.cores.length} lines)`)
  // the same ownership the gate aligns on: the automatic one with the decisions of ownership-review.json applied
  let decisions: { componentId: number; decision: { assignToLine: number } | { splitAtRow: number }; reviewer: string }[] = []
  const rp = join(dir, 'ownership-review.json')
  if (existsSync(rp)) {
    const r = OwnershipReview.parse(JSON.parse(readFileSync(rp, 'utf8')))
    if (r.segmentRun.id === lines.segmentRun.id) decisions = r.decisions.map((d) => ({ componentId: d.componentId, decision: d.decision, reviewer: d.reviewer }))
  }
  const own = applyReview(seg.labels, seg.bands, decisions).own
  const runs = decisions.length ? runsOf(own.owner, seg.frame.width, seg.frame.height, seg.bands, seg.slant.s, seg.labels) : sf.runs.lines
  const e = runs[o.line]!
  const yMid = (seg.bands.cores[o.line]![0] + seg.bands.cores[o.line]![1]) / 2
  const components = e.hi < e.lo ? [] : lineComponents(seg.labels, own.owner, o.line, yMid, seg.slant.s, [e.lo, e.hi])
  const candidates = partitionCandidates(components).map((c) => ({ ...c, run: c.gap >= RUN_MIN_PX }))
  if (o.png) writePng(o.png, overlay(sf.scan, seg, own.owner, o.line, yMid, components, candidates, o.scale ?? 2))
  return { line: o.line, s: seg.slant.s, extent: [e.lo, e.hi], components, candidates }
}

function overlay(scan: Rgba, seg: ReturnType<typeof segmentRecipe>['seg'], owner: Int16Array, line: number, yMid: number, order: PartComponent[], cands: PartCandidate[], k: number): Rgba {
  const [a, b] = seg.stripRows[line]!
  const { x0, x1 } = seg.region
  const strip = crop(scan, x0, a, x1, b)
  const label = seg.labels.label
  const pos = new Map(order.map((c, q) => [c.id, q]))
  const LABEL_H = 14 * 2
  const W = strip.width * k
  const H = strip.height * k + LABEL_H
  const out: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4) }
  const put = (x: number, y: number, c: readonly number[]): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return
    out.data.set([c[0]!, c[1]!, c[2]!, 255], (y * W + x) * 4)
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, [20, 16, 16])
  for (let y = 0; y < strip.height; y++)
    for (let x = 0; x < strip.width; x++) {
      const si = (y * strip.width + x) * 4
      const g = Math.round(0.299 * strip.data[si]! + 0.587 * strip.data[si + 1]! + 0.114 * strip.data[si + 2]!)
      const pi = (a + y) * scan.width + x0 + x
      const q = owner[pi] === line ? pos.get(label[pi]!) : undefined
      let col: readonly number[] = [Math.round(g * 0.35 + 20), Math.round(g * 0.35 + 18), Math.round(g * 0.35 + 18)]
      if (q !== undefined) {
        const t = TINTS[q % TINTS.length]!
        const dark = 1 - g / 255 // ink darkness weights the tint
        col = [Math.round(60 + (t[0] - 60) * (0.35 + 0.65 * dark)), Math.round(60 + (t[1] - 60) * (0.35 + 0.65 * dark)), Math.round(60 + (t[2] - 60) * (0.35 + 0.65 * dark))]
      }
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) put(x * k + dx, y * k + dy, col)
    }
  // a slanted tick at each candidate: the cut column in sheared coordinates, drawn back along the slant
  for (const c of cands) {
    const left = Math.max(...order.slice(0, c.position + 1).map((o2) => o2.last))
    const right = Math.min(...order.slice(c.position + 1).map((o2) => o2.first))
    const col = (left + right) / 2
    for (let y = 0; y < strip.height; y++) {
      if (y % 4 > 1) continue
      const xp = col + seg.slant.s * (yMid - (a + y)) // x = x' + s (yMid - y)
      const x = Math.round(xp) - x0
      for (let dx = 0; dx < k; dx++) put(x * k + dx, y * k, [255, 255, 255])
    }
    const xb = Math.round(col + seg.slant.s * (yMid - (b - 1))) - x0
    const text = String(c.position)
    text.split('').forEach((ch, i) => {
      DIGITS[ch]!.forEach((row, ry) => [...row].forEach((v, rx) => {
        if (v === '1') for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) put(xb * k + (i * 4 + rx) * 2 + dx - text.length * 4, strip.height * k + 2 + ry * 2 + dy, [255, 255, 255])
      }))
    })
  }
  return out
}
