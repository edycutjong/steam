// runGate: the pure orchestrator of the gate (design 3.7). Every byte it judges is in `ctx`; it reads no file and
// writes none. The CLI writes what it returns, decodes the written PNGs again and calls `verifyWritten`.

import { Alignment as AlignmentZ, Fallback, Lines, OwnershipReview, Reading, Scribe, Source, TRACE_DESCRIPTION, type Gate, type NoteJson } from '../data/schema.ts'
import { alignPart, candidateBoundaries, matchFixtureWords, noteAlignment, scoreAgainstFixture, type FixtureScore, type FixtureWord, type PartAlignment } from './align.ts'
import { verifyUrl } from './bundle.ts'
import { cropSource, type CropPage } from './cropSource.ts'
import { canonicalJson } from './canon.ts'
import { pixelSha256, rotatedPoint, toGray, type Gray, type Rgba } from './image.ts'
import { applyReview, noteOwnership, renderFlagCrop, type NoteOwnership, type Ownership, type ReviewInput } from './masks.ts'
import { applyCorrections, classifyTranscription, formatTranscription, mergeReadings, mergeSingle, type Correction, type Disagreement, type EffectiveLine, type MergeResult } from './merge.ts'
import { checkNotes, checkSteps, effectiveLines } from './notes.ts'
import {
  PROPS_VERSION, checkP1, checkP2, checkP3, checkP4, checkP5, checkP6, maskBox, type ContrastCrop, type P4Part, type PropResult,
} from './props.ts'
import { lineComponents, type CuratorEntry, type PartComponent } from './partition.ts'
import { plausibilityViolation, lineComponentSpans, type ComponentSpan } from './plausible.ts'
import { collectLinePixels, wordInkCounts } from './runs.ts'
import { runsOf, segmentRecipe, type SegmentFiles } from './segment.ts'
import { sha256Hex } from './sha256.ts'
import { rawInk } from './threshold.ts'
import { buildNote, type BuiltNote, type BuiltPart } from './timeofink.ts'

export interface GateCtx {
  recipeId: string
  /** page.jpg bytes (hashed) and the decoded scan in the page frame (resampled to the fixture frame by the CLI, R2.4). */
  pageBytes: Uint8Array
  scan: Rgba
  /** File contents by path relative to the recipe folder; absent files are undefined. */
  files: {
    'source.json': string
    'lines.json': string
    'agent/scribe.json'?: string
    'agent/second.json'?: string
    'fallback/reading.json'?: string
    'alignment.json'?: string
    'transcription.md'?: string
    'ownership-review.json'?: string
  }
  /** fixtures/hero-word-bounds.json, when the recipe has one (scoring only, R20). */
  heroFixture?: string
  /** fixtures/gold-readings.json, when the recipe has one (goldCheck only, R30.7). */
  gold?: string
}

export interface GateArtifacts {
  /** Path -> PNG image. */
  png: Map<string, Rgba>
  /** Path -> JSON value (written canonically). */
  json: Map<string, unknown>
  /** Path -> text the gate generated (transcription.md when it was missing, stale and unrevised, or lacked its merge comment). */
  text: Map<string, string>
}

/** What `verifyWritten` needs to judge the decoded files again. */
export interface WrittenCheck {
  noteId: string
  pngPath: string
  toiPath: string
  p4: Omit<Parameters<typeof checkP4>[0], 'png'>
  p5: { gray: Gray; raw: Uint8Array; owner: Int16Array; pageBox: [number, number, number, number]; groups: { name: string; rect: [number, number, number, number]; line: number }[] }
  p6: Omit<Parameters<typeof checkP6>[0], 'toi'>
}

export interface GateResult {
  state: 'pass' | 'fail' | 'waiting'
  /** gate.json without `at`; the CLI adds it (R30.4). */
  gate: Omit<Gate, 'at'>
  artifacts: GateArtifacts
  checks: WrittenCheck[]
  /** First failing item, for the exit message (R31.4). */
  firstFailure?: string
  /** One line for hooks.log (R33.3). */
  logDetail: string
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const sha = (s: string | Uint8Array): string => sha256Hex(typeof s === 'string' ? enc(s) : s)
const tokens = (t: string): string[] => t.split(/\s+/).filter(Boolean)

function parseJson(text: string, file: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e) {
    return { ok: false, error: `${file}: not JSON (${(e as Error).message})` }
  }
}
function zodIssues(file: string, issues: { path: PropertyKey[]; message: string }[]): string {
  return `${file}: ${issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`
}

const P_KEYS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] as const

/** P5 crops of one note from its decoded alpha: the note crop and each group's crop (R28.1). */
export function contrastCrops(noteId: string, alphaPng: Rgba, c: WrittenCheck['p5']): ContrastCrop[] {
  const [x0, y0] = c.pageBox
  const w = alphaPng.width
  const h = alphaPng.height
  const W = c.gray.width
  const cut = (rx0: number, ry0: number, rx1: number, ry1: number, line: number | null, name: string): ContrastCrop => {
    const cw = rx1 - rx0
    const ch = ry1 - ry0
    const gray = new Uint8Array(cw * ch)
    const raw = new Uint8Array(cw * ch)
    const mask = new Uint8Array(cw * ch)
    for (let y = 0; y < ch; y++)
      for (let x = 0; x < cw; x++) {
        const px = x + rx0
        const py = y + ry0
        const g = (py + y0) * W + px + x0
        gray[y * cw + x] = c.gray.data[g]!
        raw[y * cw + x] = c.raw[g]!
        const o = c.owner[g]!
        mask[y * cw + x] = alphaPng.data[(py * w + px) * 4 + 3]! > 0 && o >= 0 && (line === null || o === line) ? 1 : 0
      }
    return { name, width: cw, height: ch, gray, raw, mask }
  }
  return [cut(0, 0, w, h, null, noteId), ...c.groups.map((g) => cut(g.rect[0], g.rect[1], g.rect[2], g.rect[3], g.line, g.name))]
}

/** P4 to P6 on decoded files (R30.1). `decoded` maps the note PNG paths to their decoded pixels. */
export function verifyWritten(checks: WrittenCheck[], decoded: Map<string, Rgba>): { P4: PropResult; P5: PropResult; P6: PropResult } {
  const p4: PropResult[] = []
  const p5: PropResult[] = []
  const p6: PropResult[] = []
  for (const c of checks) {
    const png = decoded.get(c.pngPath)
    const toi = decoded.get(c.toiPath)
    if (!png || !toi) {
      const r = { pass: false, detail: `${c.noteId}: written file missing` }
      p4.push(r), p5.push(r), p6.push(r)
      continue
    }
    p4.push(checkP4({ ...c.p4, png }))
    p5.push(checkP5(contrastCrops(c.noteId, png, c.p5)))
    p6.push({ ...checkP6({ ...c.p6, toi }), detail: `${c.noteId}: ${checkP6({ ...c.p6, toi }).detail}` })
  }
  const join = (rs: PropResult[], none: string): PropResult => (rs.length ? { pass: rs.every((r) => r.pass), detail: rs.map((r) => r.detail).join(' | ') } : { pass: true, detail: none })
  return { P4: join(p4, 'no notes'), P5: join(p5, 'no notes'), P6: join(p6, 'no notes') }
}

interface ReaderSet {
  mode: 'agents' | 'fallback'
  scribe: Scribe | Fallback
  second?: Reading
  hashes: Record<string, string>
  /** Hashes for the transcription.md header. */
  headerReaders: [string, string]
}

export function runGate(ctx: GateCtx): GateResult {
  const f = ctx.files
  const inputs: Record<string, string> = { page: sha(ctx.pageBytes), lines: sha(f['lines.json']) }
  const artifacts: GateArtifacts = { png: new Map(), json: new Map(), text: new Map() }
  const errors: string[] = []
  const waiting: string[] = []

  const lj = parseJson(f['lines.json'], 'lines.json')
  const lv = lj.ok ? Lines.safeParse(lj.value) : null
  if (!lj.ok || !lv?.success) throw new Error(lj.ok ? zodIssues('lines.json', lv!.error!.issues) : lj.error)
  const lines = lv.data
  const sj = parseJson(f['source.json'], 'source.json')
  const sv = sj.ok ? Source.safeParse(sj.value) : null
  if (!sj.ok || !sv?.success) throw new Error(sj.ok ? zodIssues('source.json', sv!.error!.issues) : sj.error)
  const source = sv.data

  const base = (state: 'fail' | 'waiting', extra: Partial<Gate> = {}): GateResult => {
    const gate: Omit<Gate, 'at'> = {
      recipeId: ctx.recipeId,
      propsVersion: PROPS_VERSION,
      state,
      segmentRun: lines.segmentRun,
      inputs,
      outputs: {},
      pass: false,
      ...(state === 'waiting' ? { waiting } : {}),
      ...(errors.length ? { errors } : {}),
      ...extra,
    }
    const first = state === 'waiting' ? waiting[0] : errors[0]
    return { state, gate, artifacts, checks: [], firstFailure: first, logDetail: state === 'waiting' ? waiting.join(' · ') : errors.join(' · ') }
  }

  // 1. The page must give the same segmentation that lines.json records (R9.6): a hand-edited or stale lines.json fails.
  const segOpts = lines.selectedBy === 'curator' ? { block: lines.blockIndex } : {}
  const sf: SegmentFiles = segmentRecipe(ctx.scan, segOpts)
  if (canonicalJson(sf.lines) !== canonicalJson(lines)) {
    errors.push('lines.json does not match the segmentation of page.jpg: re-run steam-ingest segment')
    return base('fail')
  }

  // 2. Readers (R14, R34)
  let readers: ReaderSet | null = null
  const scribeText = f['agent/scribe.json']
  const secondText = f['agent/second.json']
  const fbText = f['fallback/reading.json']
  if (scribeText === undefined && secondText === undefined && fbText !== undefined) {
    inputs.fallback = sha(fbText)
    const pj = parseJson(fbText, 'fallback/reading.json')
    const pv = pj.ok ? Fallback.safeParse(pj.value) : null
    if (!pj.ok) errors.push(pj.error)
    else if (!pv!.success) errors.push(zodIssues('fallback/reading.json', pv!.error!.issues))
    else if (pv!.data.segmentRun.id !== lines.segmentRun.id || pv!.data.segmentRun.stripsHash !== lines.segmentRun.stripsHash) waiting.push('stale reading: fallback/reading.json')
    else readers = { mode: 'fallback', scribe: pv!.data, hashes: { fallback: inputs.fallback }, headerReaders: [inputs.fallback, inputs.fallback] }
  } else {
    if (scribeText === undefined) waiting.push('missing: agent/scribe.json')
    if (secondText === undefined) waiting.push('missing: agent/second.json')
    let sc: Scribe | null = null
    let se: Reading | null = null
    if (scribeText !== undefined) {
      inputs.scribe = sha(scribeText)
      const pj = parseJson(scribeText, 'agent/scribe.json')
      const pv = pj.ok ? Scribe.safeParse(pj.value) : null
      if (!pj.ok) errors.push(pj.error)
      else if (!pv!.success) errors.push(zodIssues('agent/scribe.json', pv!.error!.issues))
      else if (pv!.data.segmentRun.id !== lines.segmentRun.id || pv!.data.segmentRun.stripsHash !== lines.segmentRun.stripsHash) waiting.push('stale reading: agent/scribe.json')
      else sc = pv!.data
    }
    if (secondText !== undefined) {
      inputs.second = sha(secondText)
      const pj = parseJson(secondText, 'agent/second.json')
      const pv = pj.ok ? Reading.safeParse(pj.value) : null
      if (!pj.ok) errors.push(pj.error)
      else if (!pv!.success) errors.push(zodIssues('agent/second.json', pv!.error!.issues))
      else if (pv!.data.segmentRun.id !== lines.segmentRun.id || pv!.data.segmentRun.stripsHash !== lines.segmentRun.stripsHash) waiting.push('stale reading: agent/second.json')
      else se = pv!.data
    }
    if (sc && se) readers = { mode: 'agents', scribe: sc, second: se, hashes: { scribe: inputs.scribe!, second: inputs.second! }, headerReaders: [inputs.scribe!, inputs.second!] }
  }
  for (const k of ['alignment.json', 'transcription.md', 'ownership-review.json'] as const) {
    const t = f[k]
    if (t !== undefined) inputs[k === 'alignment.json' ? 'alignment' : k === 'transcription.md' ? 'transcription' : 'ownershipReview'] = sha(t)
  }
  if (errors.length) return base('fail')
  if (waiting.length || !readers) return base('waiting')

  // 3. Structure of the readings (R14.2, R14.3)
  const sc = readers.scribe
  const n = lines.lines.length
  const checkLines = (file: string, r: Reading) => {
    if (r.lines.length !== n) errors.push(`${file}: ${r.lines.length} lines, lines.json has ${n}`)
    else r.lines.forEach((l, k) => l.i !== k && errors.push(`${file}: line at position ${k} has i ${l.i}`))
  }
  checkLines(readers.mode === 'fallback' ? 'fallback/reading.json' : 'agent/scribe.json', sc)
  if (readers.second) checkLines('agent/second.json', readers.second)
  if (sc.titleLine !== null) {
    if (sc.titleLine >= n) errors.push(`titleLine ${sc.titleLine} is not a line`)
    else if (sc.lines[sc.titleLine]?.text !== sc.title) errors.push(`title does not equal line ${sc.titleLine} verbatim`)
  }
  if (errors.length) return base('fail')

  // 4. Merge and corrections (R15, R16)
  const merged: MergeResult = readers.second ? mergeReadings(sc, readers.second) : mergeSingle(sc)
  let eff: EffectiveLine[] = effectiveLines(merged)
  let corrections: Correction[] = []
  let disagreements: Disagreement[] = merged.disagreements
  {
    // R16.2, R16.7, R16.8: the gate writes transcription.md when it is missing or stale and unrevised, and never waits for it
    const expected = { segmentRun: lines.segmentRun.id, readers: readers.headerReaders }
    const fresh = formatTranscription(expected, merged.lines)
    let md = f['transcription.md']
    const cls = classifyTranscription(md, expected, fresh)
    if (cls.state === 'malformed') {
      errors.push(cls.error)
      return base('fail')
    }
    if (cls.state === 'stale' && cls.revised) {
      errors.push('transcription.md was revised against an older reading: re-review')
      return base('fail')
    }
    if (cls.state === 'missing' || cls.state === 'stale' || (cls.state === 'current' && cls.legacy && cls.equalsFresh)) {
      md = fresh
      artifacts.text.set('transcription.md', fresh)
    }
    inputs.transcription = sha(md!)
    const quoted = new Map<number, number>()
    for (const note of sc.notes) for (const q of note.quote) if (q.line < n) quoted.set(q.line, tokens(sc.lines[q.line]!.text).length)
    const c = applyCorrections(merged, md!, expected, quoted)
    if (c.state === 'waiting') {
      waiting.push(c.detail)
      return base('waiting')
    }
    if (c.state !== 'ok') {
      errors.push(c.detail)
      return base('fail')
    }
    eff = c.lines
    corrections = c.corrections
    disagreements = c.disagreements
  }
  artifacts.json.set('merged.json', {
    segmentRun: lines.segmentRun,
    readers: readers.mode === 'fallback' ? ['fallback'] : ['scribe', 'second-reader'],
    disagreements,
    readerUncertain: merged.readerUncertain,
    lines: eff.map((l) => ({ i: l.i, merged: l.merged, ...(l.corrected !== undefined ? { corrected: l.corrected } : {}), primary: l.primary, wordCount: l.wordCount })),
  })

  // 5. Steps and notes (R17)
  errors.push(...checkSteps(eff, sc.steps))
  const cn = checkNotes(eff, sc.steps, sc.notes)
  errors.push(...cn.errors)
  if (errors.length) return base('fail')

  // 6. Ownership with review (R13)
  const seg = sf.seg
  let staleReview = false
  let decisions: ReviewInput[] = []
  if (f['ownership-review.json'] !== undefined) {
    const pj = parseJson(f['ownership-review.json'], 'ownership-review.json')
    const pv = pj.ok ? OwnershipReview.safeParse(pj.value) : null
    if (!pj.ok) errors.push(pj.error)
    else if (!pv!.success) errors.push(zodIssues('ownership-review.json', pv!.error!.issues))
    else if (pv!.data.segmentRun.id !== lines.segmentRun.id || pv!.data.segmentRun.stripsHash !== lines.segmentRun.stripsHash) staleReview = true
    else decisions = pv!.data.decisions.map((d) => ({ componentId: d.componentId, decision: d.decision, reviewer: d.reviewer }))
    if (errors.length) return base('fail')
  }
  const rev = applyReview(seg.labels, seg.bands, decisions)
  if (rev.errors.length) {
    errors.push(...rev.errors.map((e) => `ownership-review.json: ${e}`))
    return base('fail')
  }
  const own: Ownership = rev.own
  // the automatic ownership: split shares and flags are judged on it, decisions only unlock (R13.4, R13.5)
  const autoOwn: Ownership = decisions.length ? applyReview(seg.labels, seg.bands, []).own : own

  // 7. Alignment per note part (R18, R19)
  let curator: Map<number, CuratorEntry[]> | null = null
  let curatorBy: string | undefined
  const curatorLineBy = new Map<number, string>()
  if (f['alignment.json'] !== undefined) {
    const pj = parseJson(f['alignment.json'], 'alignment.json')
    const pv = pj.ok ? AlignmentZ.safeParse(pj.value) : null
    if (!pj.ok) errors.push(pj.error)
    else if (!pv!.success) errors.push(zodIssues('alignment.json', pv!.error!.issues))
    else if (pv!.data.segmentRun.id === lines.segmentRun.id) {
      curator = new Map(pv!.data.lines.map((l) => [l.line, l.boundaryRuns]))
      curatorBy = pv!.data.by
      for (const l of pv!.data.lines) if (l.by) curatorLineBy.set(l.line, l.by)
    }
    if (errors.length) return base('fail')
  }
  const s = seg.slant.s
  const segRuns = sf.runs.lines // runs.json: what curator indices name
  const effRuns = decisions.length ? runsOf(own.owner, seg.frame.width, seg.frame.height, seg.bands, s, seg.labels) : segRuns
  const W = seg.frame.width
  const H = seg.frame.height
  // what alignment needs to refuse a word box without writing: the line's extent and the ink per candidate word box
  const linePx = collectLinePixels(own.owner, W, H, seg.bands.cores.length, seg.labels)
  const spansOf = new Map<number, ComponentSpan[]>()
  const extentAndInk = (line: number, tokens: string[]) => {
    const e = effRuns[line]!
    const yMid = (seg.bands.cores[line]![0] + seg.bands.cores[line]![1]) / 2
    if (e.hi < e.lo) return {}
    const extent: [number, number] = [e.lo, e.hi]
    return {
      extent,
      wordInk: (b: number[]) => wordInkCounts(linePx[line]!, yMid, s, b, extent),
      implausible: (b: number[], boxOfWord?: number[]) => {
        if (!spansOf.has(line)) spansOf.set(line, lineComponentSpans(seg.labels, own.owner, line, yMid, s))
        // words that share a box are judged as one word of their joined characters
        const boxTokens = boxOfWord ? tokens.reduce<string[]>((acc, tk, j) => (boxOfWord[j] === boxOfWord[j - 1] ? [...acc.slice(0, -1), `${acc[acc.length - 1]} ${tk}`] : [...acc, tk]), []) : tokens
        return plausibilityViolation(b, extent, boxTokens, spansOf.get(line)!)
      },
    }
  }
  // the line's owned components in order, for a component boundary of alignment.json (R19.8); computed only for lines that name one
  const partitions = new Map<number, PartComponent[] | undefined>()
  const partitionOf = (line: number): PartComponent[] | undefined => {
    if (!partitions.has(line)) {
      const e = effRuns[line]!
      const yMid = (seg.bands.cores[line]![0] + seg.bands.cores[line]![1]) / 2
      partitions.set(line, e.hi < e.lo ? undefined : lineComponents(seg.labels, own.owner, line, yMid, s, [e.lo, e.hi]))
    }
    return partitions.get(line)
  }
  const gray = toGray(sf.scan)
  const raw = seg.raw
  const tilt = seg.deskewApplied ? seg.deskewDeg : 0
  // the bundle's crop source for every note: ownership masks built from the quoted lines, never a box (crop-overlap)
  const cropOf = (o: Ownership, id: string, step: number, parts: BuiltPart[]): Uint8Array =>
    cropSource({ own: o, bands: seg.bands, s, ink: seg.ink, tilt, label: seg.labels.label } satisfies CropPage, { id, step, lines: parts.map((p) => p.line), parts }).mask
  const hero = ctx.heroFixture ? (JSON.parse(ctx.heroFixture) as { recallThreshold: number; words: FixtureWord[] }) : null
  const raw0 = hero ? rawInk(toGray(ctx.scan)) : null

  const built: { id: string; note: BuiltNote; parts: PartAlignment[]; bp: BuiltPart[]; alignment: 'auto' | 'curator' | 'lines'; granularity: 'words' | 'lines'; shownText: string; ownership: NoteOwnership; step: number; span: string }[] = []
  const alignmentOut: NonNullable<Gate['alignment']> = []
  const recallOut: NonNullable<Gate['recall']> = []
  const checks: WrittenCheck[] = []
  const scoreOf = (note: BuiltNote, partsForWords: BuiltPart[], offset: number, words: FixtureWord[]): FixtureScore => {
    const [bx0, by0] = note.pageBox
    const toAnalysis = (x: number, y: number): [number, number] => {
      const [ax, ay] = rotatedPoint(x, y, -tilt, W, H)
      return [Math.round(ax), Math.round(ay)]
    }
    const lit = (x: number, y: number): boolean => {
      const [ax, ay] = toAnalysis(x, y)
      const px = ax - bx0
      const py = ay - by0
      return px >= 0 && py >= 0 && px < note.png.width && py < note.png.height && note.png.data[(py * note.png.width + px) * 4 + 3]! > 0
    }
    // mask pixels with their shown-word index, carried to the fixture frame
    const maskWords: { x: number; y: number; word: number }[] = []
    let wordBase = 0
    const bases = new Map<number, number>()
    for (const p of partsForWords) {
      bases.set(p.line, wordBase)
      wordBase += p.toWord - p.fromWord + 1
    }
    // the share of the note's mask pixels (every pixel, whole lines and components too) that lie inside some fixture box
    let maskTotal = 0
    let maskInBoxes = 0
    for (let i = 0; i < note.mask.length; i++) {
      if (!note.mask[i]) continue
      const x = i % W
      const y = (i - x) / W
      const [qx, qy] = rotatedPoint(x, y, tilt, W, H)
      maskTotal++
      if (words.some((w) => Math.round(qx) >= w.box[0] && Math.round(qx) < w.box[2] && Math.round(qy) >= w.box[1] && Math.round(qy) < w.box[3])) maskInBoxes++
      const line = own.owner[i]!
      const part = partsForWords.find((p) => p.line === line)!
      // a whole-line part has no word regions: its pixels carry no word and no precision is computed for them
      if (part.whole || part.partition) continue
      const c = Math.round(x - s * ((seg.bands.cores[line]![0] + seg.bands.cores[line]![1]) / 2 - y))
      let j = 0
      while (j < part.boundaries.length && c > part.boundaries[j]!) j++
      const [fx, fy] = rotatedPoint(x, y, tilt, W, H)
      maskWords.push({ x: Math.round(fx), y: Math.round(fy), word: bases.get(line)! + j - part.fromWord })
    }
    return { ...scoreAgainstFixture(raw0!, ctx.scan.width, words, offset, lit, maskWords), precision: maskTotal ? maskInBoxes / maskTotal : 0 }
  }

  for (const nd of cn.notes) {
    const parts = nd.parts.map((p) =>
      alignPart({
        line: p.line,
        fromWord: p.fromWord,
        toWord: p.toWord,
        tokenCount: p.tokenCount,
        k: p.k,
        runs: curator?.has(p.line) && !effRuns[p.line]!.runs.length ? segRuns[p.line]!.runs : effRuns[p.line]!.runs,
        curator: curator?.get(p.line),
        ...(curator?.get(p.line)?.some((e) => typeof e === 'object' && e !== null) ? { partition: partitionOf(p.line) } : {}),
        tokens: p.tokens,
        // a curator names the runs of runs.json (design 3.5), not the runs of the reviewed ownership
        curatorRuns: segRuns[p.line]!.runs,
        ...extentAndInk(p.line, p.tokens),
      }),
    )
    const na = noteAlignment(parts)
    // a part cut by components keeps its words (its groups are named by component, not by box)
    const bp: BuiltPart[] = parts.map((p) => ({ ...p, fromWord: p.partition ? p.fromWord : (p.fromBox ?? p.fromWord), toWord: p.partition ? p.toWord : (p.toBox ?? p.toWord), whole: na.granularity === 'lines' || p.method === 'lines' }))
    // the caption equals the ink shown: the quoted words (with their punctuation) or the whole lines (R19.6)
    const shownText = na.granularity === 'words' ? nd.quoted : bp.map((p) => eff[p.line]!.primary).join(' ')
    let note: BuiltNote
    try {
      // the mask first, for the split share; then the note
      const ownership = noteOwnership(autoOwn, seg.labels, nd.id, cropOf(autoOwn, nd.id, nd.step, bp), own.reviewers)
      note = buildNote({
        noteId: nd.id, step: nd.step, span: nd.span, shownText, granularity: na.granularity, alignment: na.alignment, credit: source.credit,
        scan: sf.scan, gray, raw, pageInk: seg.pageInkMap, own, bands: seg.bands, s, resampled: seg.deskewApplied, parts: bp, mask: cropOf(own, nd.id, nd.step, bp), ownership,
      })
      built.push({ id: nd.id, note, parts, bp, alignment: na.alignment, granularity: na.granularity, shownText, ownership, step: nd.step, span: nd.span })
    } catch (e) {
      errors.push(`${nd.id}: ${(e as Error).message}`)
      continue
    }
    alignmentOut.push({
      noteId: nd.id,
      alignment: na.alignment,
      granularity: na.granularity,
      parts: parts.map((p) => ({
        line: p.line, fromWord: p.fromWord, toWord: p.toWord, method: p.method, projection: seg.slant.vertical ? 'vertical' : 'sheared', s, boundaries: p.boundaries,
        ...(p.partition ? { boundary: 'component' as const, components: p.partition.after } : p.method !== 'lines' ? { boundary: 'runs' as const } : {}),
        ...(p.reason ? { reason: p.reason } : {}), autoDetail: p.autoDetail,
      })),
    })
    // R20: score against the fixture when the shown words match it
    let recall: { value: number; threshold: number } | undefined
    if (hero) {
      const off = matchFixtureWords(shownText, hero.words)
      if (off !== null) {
        const shipped = scoreOf(note, bp, off, hero.words)
        recall = { value: shipped.recall, threshold: hero.recallThreshold }
        let auto: NonNullable<Gate['recall']>[number]['auto']
        if (na.alignment === 'auto') auto = { recall: shipped.recall, words: shipped.words }
        else {
          const autoParts = nd.parts.map((p) => alignPart({ line: p.line, fromWord: p.fromWord, toWord: p.toWord, tokenCount: p.tokenCount, k: p.k, runs: effRuns[p.line]!.runs, ...extentAndInk(p.line, p.tokens) }))
          const an = noteAlignment(autoParts)
          if (an.alignment !== 'auto') {
            // score the rejected candidate (widest k-1 runs, no acceptance test) for the record only
            const cand = nd.parts.map((p) => ({ p, b: p.k !== null && !(p.fromWord === 0 && p.toWord === p.tokenCount - 1) ? candidateBoundaries(effRuns[p.line]!.runs, p.k) : [] }))
            let rejectedCandidate: { recall: number; words: FixtureScore['words']; boundaries: { line: number; boundaries: number[] }[] } | null = null
            if (cand.every((c) => c.b !== null)) {
              const cbp: BuiltPart[] = cand.map(({ p, b }) => ({ line: p.line, fromWord: p.fromWord, toWord: p.toWord, method: 'auto', boundaries: b!, whole: b!.length === 0, autoDetail: 'rejected candidate' }))
              const cm = cropOf(own, nd.id, nd.step, cbp)
              const cn2 = buildNote({
                noteId: nd.id, step: nd.step, span: nd.span, shownText: nd.quoted, granularity: 'words', alignment: 'auto', credit: source.credit,
                scan: sf.scan, gray, raw, pageInk: seg.pageInkMap, own, bands: seg.bands, s, resampled: seg.deskewApplied, parts: cbp, mask: cm, ownership: noteOwnership(own, seg.labels, nd.id, cm),
              })
              const sc3 = scoreOf(cn2, cbp, matchFixtureWords(nd.quoted, hero.words) ?? 0, hero.words)
              rejectedCandidate = { recall: sc3.recall, words: sc3.words, boundaries: cbp.map((c) => ({ line: c.line, boundaries: c.boundaries })) }
            }
            auto = { notUsed: autoParts.map((p) => `line ${p.line}: ${p.autoDetail}`).join('; '), rejectedCandidate }
          }
          else {
            const abp = autoParts.map((p) => ({ ...p, whole: false }))
            const am = cropOf(own, nd.id, nd.step, abp)
            const an2 = buildNote({
              noteId: nd.id, step: nd.step, span: nd.span, shownText: nd.quoted, granularity: 'words', alignment: 'auto', credit: source.credit,
              scan: sf.scan, gray, raw, pageInk: seg.pageInkMap, own, bands: seg.bands, s, resampled: seg.deskewApplied, parts: abp, mask: am, ownership: noteOwnership(own, seg.labels, nd.id, am),
            })
            const sc2 = scoreOf(an2, abp, matchFixtureWords(nd.quoted, hero.words) ?? 0, hero.words)
            auto = { recall: sc2.recall, words: sc2.words }
          }
        }
        recallOut.push({
          noteId: nd.id,
          shipped: { alignment: na.alignment, recall: shipped.recall, ...(shipped.precision !== undefined ? { precision: shipped.precision } : {}), words: shipped.words },
          auto,
          threshold: hero.recallThreshold,
          frame: tilt ? `fixture frame; shipped alpha looked up through the applied deskew rotation (${tilt} deg, nearest pixel)` : 'fixture frame',
        })
      }
    }
    const p4parts: P4Part[] = bp.map((p) => ({ line: p.line, boundaries: p.whole ? null : p.boundaries, fromWord: p.fromWord, toWord: p.toWord, yMid: (seg.bands.cores[p.line]![0] + seg.bands.cores[p.line]![1]) / 2, ...(p.partition && !p.whole ? { allowedComponents: p.partition.allowed } : {}) }))
    checks.push({
      noteId: nd.id,
      pngPath: `notes/note-${nd.id}.png`,
      toiPath: `notes/note-${nd.id}.toi.png`,
      p4: { noteId: nd.id, width: W, height: H, owner: own.owner, pageInk: seg.pageInkMap, s, parts: p4parts, label: seg.labels.label, pageBox: note.pageBox, ...(recall ? { recall } : {}) },
      p5: { gray, raw, owner: own.owner, pageBox: note.pageBox, groups: note.core.groups.map((g) => ({ name: `${nd.id}/line ${g.line}`, rect: g.rect, line: g.line })) },
      p6: { trace: note.trace, groups: note.groups, width: note.png.width, height: note.png.height, s },
    })
  }
  if (errors.length) return base('fail')

  // 8. Artifacts
  const outputs: Record<string, string> = {}
  for (const b of built) {
    const v = verifyUrl({ imageService: source.imageService, pageBox: b.note.pageBox, frame: seg.frame, deskewDeg: seg.deskewDeg, deskewApplied: seg.deskewApplied })
    const nj: NoteJson = {
      ...b.note.core,
      ...(b.alignment === 'curator' && curatorBy ? { alignmentBy: [...new Set(b.parts.filter((p) => p.method === 'curator').map((p) => curatorLineBy.get(p.line) ?? curatorBy!))].join('; ') } : {}),
      verifyUrl: v.url,
      verifyApproximate: v.approximate,
      trace: TRACE_DESCRIPTION,
    }
    artifacts.png.set(`notes/note-${b.id}.png`, b.note.png)
    artifacts.png.set(`notes/note-${b.id}.toi.png`, b.note.toi)
    artifacts.json.set(`notes/note-${b.id}.json`, nj)
    outputs[`notes/note-${b.id}.png`] = pixelSha256(b.note.png)
    outputs[`notes/note-${b.id}.toi.png`] = pixelSha256(b.note.toi)
    outputs[`notes/note-${b.id}.json`] = sha(canonicalJson(nj))
    for (const id of b.ownership.flagged) {
      if (artifacts.png.has(`ownership/flag-${id}.png`)) continue
      artifacts.png.set(`ownership/flag-${id}.png`, renderFlagCrop(sf.scan, own, seg.labels, seg.bands, id).image)
    }
  }
  // every reviewed component keeps the crop its decision names (R13.1 `overlay`), flagged now or not
  for (const d of decisions) {
    const rel = `ownership/flag-${d.componentId}.png`
    if (!artifacts.png.has(rel)) artifacts.png.set(rel, renderFlagCrop(sf.scan, own, seg.labels, seg.bands, d.componentId).image)
  }

  // 9. Properties
  const p1 = checkP1({
    lineCount: n,
    titleLine: sc.titleLine,
    steps: sc.steps,
    notes: built.map((b) => ({ id: b.id, alignment: b.alignment, granularity: b.granularity })),
    masks: built.map((b) => ({ noteId: b.id, granularity: b.granularity })),
  })
  const p2 = checkP2(seg.frame, built.map((b) => ({ id: b.id, maskBox: maskBox(b.note.mask, W, H), pageBox: b.note.pageBox, png: [b.note.png.width, b.note.png.height] })))
  const p3 = checkP3({ labels: seg.labels, own, bands: seg.bands, notes: built.map((b) => b.ownership), staleReview })
  const mem = verifyWritten(checks, artifacts.png)
  const results = { P1: p1, P2: p2, P3: p3.result, P4: mem.P4, P5: mem.P5, P6: mem.P6 }
  const pass = P_KEYS.every((k) => results[k].pass)

  // goldCheck (informational, R30.7)
  let goldCheck: Gate['goldCheck']
  if (ctx.gold) {
    const g = JSON.parse(ctx.gold) as { lines: { text: string }[] }
    const off = sc.titleLine === 0 ? 1 : 0
    const differing: number[] = []
    let equal = 0
    g.lines.forEach((gl, k) => (eff[k + off]?.primary === gl.text ? equal++ : differing.push(k + off)))
    goldCheck = { informational: true, equal, of: g.lines.length, differing }
  }
  const reviewed = built.filter((b) => b.ownership.status === 'reviewed').map((b) => ({ note: b.id, components: b.ownership.flagged.length, reviewer: b.ownership.reviewers.join(', ') }))
  const gate: Omit<Gate, 'at'> = {
    recipeId: ctx.recipeId,
    propsVersion: PROPS_VERSION,
    state: pass ? 'pass' : 'fail',
    segmentRun: lines.segmentRun,
    readers: readers.mode === 'fallback' ? ['fallback'] : ['scribe', 'second-reader'],
    inputs,
    outputs,
    pass,
    results,
    splits: {
      segmentSplits: own.splits.length,
      notes: built.map((b) => ({ noteId: b.id, share: b.ownership.share, maskPx: b.ownership.maskPx, splitPx: b.ownership.splitPx, status: b.ownership.status, flagged: b.ownership.flagged })),
    },
    ...(reviewed.length ? { reviewed } : {}),
    ownership: { autoPass: p3.autoPass, reviewedPass: p3.reviewedPass },
    ...(recallOut.length ? { recall: recallOut } : {}),
    alignment: alignmentOut,
    ...(corrections.length ? { corrections } : {}),
    disagreements: disagreements.length,
    ...(goldCheck ? { goldCheck } : {}),
  }
  const failing = P_KEYS.filter((k) => !results[k].pass)
  const firstFailure = failing.length ? `${failing[0]}: ${results[failing[0]!].detail}` : undefined
  const recallTxt = recallOut.map((r) => `recall ${r.shipped.recall.toFixed(4)}`).join(' · ')
  const revTxt = reviewed.map((r) => `${r.note} reviewed (${r.components} components by ${r.reviewer})`).join(' · ')
  const logDetail = pass
    ? ['P1-P6 ok', recallTxt, revTxt].filter(Boolean).join(' · ')
    : [`failing ${failing.join(',')}`, ...failing.map((k) => `${k}: ${results[k].detail}`), recallTxt].filter(Boolean).join(' · ')
  return { state: pass ? 'pass' : 'fail', gate, artifacts, checks, firstFailure, logDetail }
}
