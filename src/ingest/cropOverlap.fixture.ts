// Shared replay of fixtures/p0c-eyeread-boxes.json for the crop-overlap bugfix tests. Pure: the tests load the files.

import type { CropNote, CropPage } from './cropSource.ts'
import { rotatedPoint, type Rgba } from './image.ts'
import { checkP4, type PropResult } from './props.ts'
import type { SegmentResult } from './segment.ts'

export interface P0cBox {
  step: number
  text: string
  note: string | null
  box: [number, number, number, number]
}

export const pageOf = (seg: SegmentResult): CropPage => ({
  own: seg.own,
  bands: seg.bands,
  s: seg.slant.s,
  ink: seg.ink,
  tilt: seg.deskewApplied ? seg.deskewDeg : 0,
})

/** The box's own lines: those whose peak row, carried to the fixture frame, lies inside the box (as the P4 replay of task 28). */
export function ownLines(seg: SegmentResult, box: P0cBox['box']): number[] {
  const { width: W, height: H } = seg.frame
  const tilt = seg.deskewApplied ? seg.deskewDeg : 0
  const [x0, y0, x1, y1] = box
  return seg.lines
    .filter((l) => {
      const [, fy] = rotatedPoint((x0 + x1) / 2, l.peakRow, tilt, W, H)
      return fy >= y0 && fy < y1
    })
    .map((l) => l.i)
}

/** The note a P0c box stands for: its step, its own lines, and the box (the prototype's way of cropping). */
export const noteOfBox = (seg: SegmentResult, b: P0cBox): CropNote => ({ id: `p0c-step-${b.step}`, step: b.step, lines: ownLines(seg, b.box), box: b.box })

export interface P4Replay {
  p4: PropResult
  /** Pixels lit that another line owns, by that line. */
  foreign: Map<number, number>
  /** Pixels lit that are ink no line owns. */
  unowned: number
  lit: number
}

/** P4 on a crop mask: the mask as the note's alpha over the whole page, the quoted lines as whole-line parts. */
export function replayP4(seg: SegmentResult, note: CropNote, mask: Uint8Array): P4Replay {
  const { width: W, height: H } = seg.frame
  const png: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4) }
  const foreign = new Map<number, number>()
  let unowned = 0
  let lit = 0
  for (let i = 0; i < W * H; i++) {
    if (!mask[i]) continue
    png.data[i * 4 + 3] = 255
    lit++
    const o = seg.own.owner[i]!
    if (o < 0) unowned++
    else if (!note.lines.includes(o)) foreign.set(o, (foreign.get(o) ?? 0) + 1)
  }
  const p4 = checkP4({
    noteId: note.id, width: W, height: H, owner: seg.own.owner, pageInk: seg.pageInkMap, s: seg.slant.s,
    parts: note.lines.map((line) => ({ line, boundaries: null, fromWord: 0, toWord: 0, yMid: (seg.bands.cores[line]![0] + seg.bands.cores[line]![1]) / 2 })),
    png, pageBox: [0, 0, W, H],
  })
  return { p4, foreign, unowned, lit }
}

/** "step 5's crop contains 1234 px owned by line 8" (one clause per foreign line, lowest line first). */
export function overlapMessage(note: CropNote, r: P4Replay): string {
  const clauses = [...r.foreign.entries()].sort((a, b) => a[0] - b[0]).map(([line, px]) => `${px} px owned by line ${line}`)
  if (r.unowned) clauses.push(`${r.unowned} px of ink no line owns`)
  return `step ${note.step}'s crop contains ${clauses.join(' and ')} (the step's own lines: ${note.lines.join(', ')}; P4: ${r.p4.detail})`
}

// ---------------------------------------------------------------------------------------------------------------
// Gate snapshots for the preservation properties: what the fix must leave byte-identical.

import { canonicalJson } from './canon.ts'
import type { GateResult } from './gate.ts'
import { pixelSha256 } from './image.ts'
import { sha256Hex } from './sha256.ts'

export interface GateSnapshot {
  state: string
  /** gate.json content (the `at` stamp is added by the CLI, it is not in `GateResult.gate`). */
  gate: unknown
  /** Path -> pixel hash of each written PNG. */
  png: Record<string, string>
  /** Path -> hash of each written JSON, canonical. */
  json: Record<string, string>
}

export function gateSnapshot(g: GateResult): GateSnapshot {
  const enc = new TextEncoder()
  const png: Record<string, string> = {}
  const json: Record<string, string> = {}
  for (const [k, v] of [...g.artifacts.png].sort((a, b) => a[0].localeCompare(b[0]))) png[k] = pixelSha256(v)
  for (const [k, v] of [...g.artifacts.json].sort((a, b) => a[0].localeCompare(b[0]))) json[k] = sha256Hex(enc.encode(canonicalJson(v)))
  return { state: g.state, gate: JSON.parse(canonicalJson(g.gate)), png, json }
}
