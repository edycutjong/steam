// Merge of two readings, disagreements, and the transcription.md format (R15).

import type { Reading } from '../data/schema.ts'

export const tokenise = (text: string): string[] => text.split(/\s+/).filter((t) => t.length > 0)

export type Atom = { kind: 'tok'; text: string } | { kind: 'dis'; a: string[]; b: string[] }

export interface Disagreement {
  line: number
  /** Index of the scribe's first token of the disagreement (R15.3). */
  word: number
  a: string
  b: string
  countMismatch?: true
  /** Added by a correction in transcription.md; the entry itself is never removed (R15.6). */
  correctedTo?: string
}

export interface MergedLineData {
  i: number
  atoms: Atom[]
  /** Both readers' token count when they agree, else null (R15.3). */
  wordCount: number | null
}

export interface ReaderUncertain {
  line: number
  reader: 'scribe' | 'second' | 'fallback'
  token: string
  alt: string[]
}

export interface MergeResult {
  lines: MergedLineData[]
  disagreements: Disagreement[]
  readerUncertain: ReaderUncertain[]
}

/** Longest common subsequence of token arrays, as matched index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length
  const m = b.length
  const t: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!)
  const out: [number, number][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) out.push([i++, j++])
    else if (t[i + 1]![j]! >= t[i]![j + 1]!) i++
    else j++
  }
  return out
}

function mergeLine(i: number, ta: string[], tb: string[]): { atoms: Atom[]; wordCount: number | null; dis: Disagreement[] } {
  const atoms: Atom[] = []
  const dis: Disagreement[] = []
  if (ta.length === tb.length) {
    ta.forEach((a, j) => {
      const b = tb[j]!
      if (a === b) atoms.push({ kind: 'tok', text: a })
      else {
        atoms.push({ kind: 'dis', a: [a], b: [b] })
        dis.push({ line: i, word: j, a, b })
      }
    })
    return { atoms, wordCount: ta.length, dis }
  }
  const pairs = lcs(ta, tb)
  let pa = 0
  let pb = 0
  const flush = (ea: number, eb: number): void => {
    if (ea > pa || eb > pb) {
      const a = ta.slice(pa, ea)
      const b = tb.slice(pb, eb)
      atoms.push({ kind: 'dis', a, b })
      dis.push({ line: i, word: pa, a: a.join(' '), b: b.join(' '), countMismatch: true })
    }
  }
  for (const [ia, ib] of pairs) {
    flush(ia, ib)
    atoms.push({ kind: 'tok', text: ta[ia]! })
    pa = ia + 1
    pb = ib + 1
  }
  flush(ta.length, tb.length)
  return { atoms, wordCount: null, dis }
}

export function mergeReadings(scribe: Reading, second: Reading): MergeResult {
  if (scribe.lines.length !== second.lines.length) throw new Error(`line count differs: scribe ${scribe.lines.length}, second ${second.lines.length}`)
  const lines: MergedLineData[] = []
  const disagreements: Disagreement[] = []
  const readerUncertain: ReaderUncertain[] = []
  scribe.lines.forEach((la, k) => {
    const lb = second.lines[k]!
    const r = mergeLine(la.i, tokenise(la.text), tokenise(lb.text))
    lines.push({ i: la.i, atoms: r.atoms, wordCount: r.wordCount })
    disagreements.push(...r.dis)
    for (const u of la.uncertain ?? []) readerUncertain.push({ line: la.i, reader: 'scribe', token: u.token, alt: u.alt })
    for (const u of lb.uncertain ?? []) readerUncertain.push({ line: lb.i, reader: 'second', token: u.token, alt: u.alt })
  })
  return { lines, disagreements, readerUncertain }
}

/** One reader only (the labelled fallback): no disagreements, every word count known. */
export function mergeSingle(reading: Reading, reader: 'fallback' = 'fallback'): MergeResult {
  const lines: MergedLineData[] = reading.lines.map((l) => {
    const t = tokenise(l.text)
    return { i: l.i, atoms: t.map((text) => ({ kind: 'tok' as const, text })), wordCount: t.length }
  })
  const readerUncertain: ReaderUncertain[] = []
  for (const l of reading.lines) for (const u of l.uncertain ?? []) readerUncertain.push({ line: l.i, reader, token: u.token, alt: u.alt })
  return { lines, disagreements: [], readerUncertain }
}

export const markedText = (atoms: Atom[]): string => atoms.map((a) => (a.kind === 'tok' ? a.text : `†[${a.a.join(' ')}|${a.b.join(' ')}]`)).join(' ')

/** R17.4: each disagreement replaced by the scribe's reading. */
export const primaryText = (atoms: Atom[]): string =>
  atoms
    .flatMap((a) => (a.kind === 'tok' ? [a.text] : a.a))
    .join(' ')

/** The marked text back into atoms; `†[...]` is one atom. */
export function parseMarked(text: string): Atom[] {
  const out: Atom[] = []
  for (const m of text.matchAll(/†\[([^|\]]*)\|([^|\]]*)\]|\S+/g)) {
    if (m[0].startsWith('†[') && m[1] !== undefined) out.push({ kind: 'dis', a: tokenise(m[1]), b: tokenise(m[2]!) })
    else out.push({ kind: 'tok', text: m[0] })
  }
  return out
}

export interface SlotRef {
  /** Index of the atom that holds this scribe token. */
  atom: number
  /** True when the token is the first scribe token of its atom. */
  first: boolean
  /** True when it is the last. */
  last: boolean
}

/** For each scribe token of a line, the merged slot (atom) it lives in (R17.6). */
export function scribeToSlot(atoms: Atom[]): SlotRef[] {
  const out: SlotRef[] = []
  atoms.forEach((a, k) => {
    if (a.kind === 'tok') out.push({ atom: k, first: true, last: true })
    else a.a.forEach((_, j) => out.push({ atom: k, first: j === 0, last: j === a.a.length - 1 }))
  })
  return out
}

export interface TranscriptionHeader {
  segmentRun: string
  readers: [string, string]
}

const pad = (i: number): string => String(i).padStart(2, '0')

export function formatTranscription(h: TranscriptionHeader, lines: MergedLineData[]): string {
  return `<!-- segmentRun: ${h.segmentRun} readers: ${h.readers[0]}:${h.readers[1]} -->\n${lines.map((l) => `L${pad(l.i)}: ${markedText(l.atoms)}\n`).join('')}`
}

export type ParsedTranscription =
  | { ok: true; header: TranscriptionHeader; lines: { i: number; text: string }[] }
  | { ok: false; error: string }

/** R15.4, R16.1: strict. The header comes first; then only L-lines, blank lines and further comment lines. */
export function parseTranscription(md: string): ParsedTranscription {
  const rows = md.split('\n')
  if (rows[rows.length - 1] === '') rows.pop()
  const m = /^<!-- segmentRun: (sr-[0-9a-f]{12}) readers: ([0-9a-f]{64}):([0-9a-f]{64}) -->$/.exec(rows[0] ?? '')
  if (!m) return { ok: false, error: 'transcription.md: header missing or malformed' }
  const lines: { i: number; text: string }[] = []
  for (const row of rows.slice(1)) {
    if (row.trim() === '' || row.startsWith('<!--')) continue
    const l = /^L(\d{2,}): (.+)$/.exec(row)
    if (!l) return { ok: false, error: `transcription.md: line structure changed (not an L-line: ${JSON.stringify(row.slice(0, 40))})` }
    lines.push({ i: Number(l[1]), text: l[2]! })
  }
  return { ok: true, header: { segmentRun: m[1]!, readers: [m[2]!, m[3]!] }, lines }
}

// ---------------------------------------------------------------------------------------------------------------
// Corrections (R16)

export interface Correction {
  line: number
  before: string
  after: string
}

export interface EffectiveLine {
  i: number
  /** The fresh merge, marked. */
  merged: string
  /** The revised text from transcription.md when it differs from the merge. */
  corrected?: string
  /** What every later stage quotes (R17.4). */
  primary: string
  atoms: Atom[]
  wordCount: number | null
}

export type CorrectionResult =
  | { state: 'ok'; detail: string; corrections: Correction[]; lines: EffectiveLine[]; disagreements: Disagreement[] }
  | { state: 'waiting' | 'fail'; detail: string }

const scribeTokenCount = (atoms: Atom[]): number => atoms.reduce((n, a) => n + (a.kind === 'tok' ? 1 : a.a.length), 0)
const atomText = (a: Atom): string => markedText([a])

/**
 * R16.1 to R16.5. `quoted` maps each line a note quotes to its scribe token count; a correction may not change it.
 */
export function applyCorrections(
  fresh: MergeResult,
  transcription: string,
  expected: TranscriptionHeader,
  quoted: Map<number, number>,
): CorrectionResult {
  const parsed = parseTranscription(transcription)
  if (!parsed.ok) return { state: 'fail', detail: parsed.error }
  if (parsed.header.segmentRun !== expected.segmentRun || parsed.header.readers[0] !== expected.readers[0] || parsed.header.readers[1] !== expected.readers[1])
    return { state: 'waiting', detail: 'stale transcription.md' }
  const n = fresh.lines.length
  if (parsed.lines.length !== n || parsed.lines.some((l, k) => l.i !== fresh.lines[k]!.i)) return { state: 'fail', detail: 'transcription.md: line structure changed' }
  const corrections: Correction[] = []
  const lines: EffectiveLine[] = []
  const disagreements: Disagreement[] = fresh.disagreements.map((d) => ({ ...d }))
  for (let k = 0; k < n; k++) {
    const f = fresh.lines[k]!
    const before = markedText(f.atoms)
    const after = parsed.lines[k]!.text
    if (after === before) {
      lines.push({ i: f.i, merged: before, primary: primaryText(f.atoms), atoms: f.atoms, wordCount: f.wordCount })
      continue
    }
    const atoms = parseMarked(after)
    const want = quoted.get(f.i)
    if (want !== undefined && scribeTokenCount(atoms) !== want) return { state: 'fail', detail: 'correction changes the word count of a quoted line' }
    corrections.push({ line: f.i, before, after })
    const single = atoms.every((a) => a.kind === 'tok' || (a.a.length === 1 && a.b.length === 1))
    lines.push({ i: f.i, merged: before, corrected: after, primary: primaryText(atoms), atoms, wordCount: single ? atoms.length : null })
    // keep every disagreement of this line; record what the correction made of it
    const origDis = f.atoms.map((a, idx) => [a, idx] as const).filter(([a]) => a.kind === 'dis')
    let d = 0
    for (const dg of disagreements) {
      if (dg.line !== f.i) continue
      const [oa, idx] = origDis[d++] ?? []
      if (!oa) continue
      if (atoms.length === f.atoms.length) {
        const now = atomText(atoms[idx]!)
        if (now !== atomText(oa)) dg.correctedTo = now
      } else dg.correctedTo = after
    }
  }
  return { state: 'ok', detail: `${corrections.length} corrections`, corrections, lines, disagreements }
}
