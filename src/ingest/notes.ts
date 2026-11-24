// Steps and notes: validation against the merged, corrected lines (R17).

import type { NoteDef, StepDef } from '../data/schema.ts'
import { primaryText, scribeToSlot, tokenise, type Atom, type EffectiveLine, type MergeResult } from './merge.ts'

/** The merge as effective lines before any correction. */
export function effectiveLines(m: MergeResult): EffectiveLine[] {
  return m.lines.map((l) => ({
    i: l.i,
    merged: atomsMarked(l.atoms),
    primary: primaryText(l.atoms),
    atoms: l.atoms,
    wordCount: l.wordCount,
  }))
}
const atomsMarked = (atoms: Atom[]): string => atoms.map((a) => (a.kind === 'tok' ? a.text : `†[${a.a.join(' ')}|${a.b.join(' ')}]`)).join(' ')

/** R17.1, R17.2 (coverage of every line by exactly one step is P1's business). */
export function checkSteps(lines: EffectiveLine[], steps: StepDef[]): string[] {
  const errs: string[] = []
  steps.forEach((s, k) => {
    if (s.n !== k + 1) errs.push(`steps must be numbered 1..m in order: step at position ${k + 1} is numbered ${s.n}`)
    if (s.lineIdx.length === 0) errs.push(`step ${s.n}: lineIdx is empty`)
    let ok = true
    s.lineIdx.forEach((l, j) => {
      if (l < 0 || l >= lines.length) {
        errs.push(`step ${s.n}: unknown line ${l}`)
        ok = false
      } else if (j > 0 && l !== s.lineIdx[j - 1]! + 1) ok = false
    })
    if (!ok && s.lineIdx.every((l) => l >= 0 && l < lines.length)) errs.push(`step ${s.n}: lineIdx must be an ascending run of consecutive line indices`)
    if (s.lineIdx.length && s.lineIdx.every((l) => l >= 0 && l < lines.length)) {
      const want = s.lineIdx.map((l) => lines[l]!.primary).join(' ')
      if (s.text !== want) errs.push(`step ${s.n} text is not the primary text of its lines`)
    }
  })
  return errs
}

export interface QuotePart {
  line: number
  fromWord: number
  toWord: number
  /** Scribe tokens in the line. */
  tokenCount: number
  /** Known word count (both readers agree), else null. */
  k: number | null
}
export interface CheckedNote {
  id: string
  step: number
  span: string
  parts: QuotePart[]
}

/** R17.3 to R17.6. Errors are prefixed with the note id. */
export function checkNotes(lines: EffectiveLine[], steps: StepDef[], notes: NoteDef[]): { errors: string[]; notes: CheckedNote[] } {
  const errors: string[] = []
  const out: CheckedNote[] = []
  const seen = new Set<string>()
  for (const n of notes) {
    const err = (m: string): void => void errors.push(`${n.id}: ${m}`)
    if (seen.has(n.id)) err('duplicate note id')
    seen.add(n.id)
    const step = steps.find((s) => s.n === n.step)
    if (!step) {
      err(`step ${n.step} does not exist`)
      continue
    }
    const before = errors.length
    const parts: QuotePart[] = []
    n.quote.forEach((q, j) => {
      if (!step.lineIdx.includes(q.line) || q.line >= lines.length) return void err(`line ${q.line} is not in step ${n.step}`)
      const line = lines[q.line]!
      const tokens = scribeToSlot(line.atoms)
      const tc = tokens.length
      if (q.fromWord < 0 || q.fromWord > q.toWord || q.toWord >= tc) return void err(`line ${q.line}: words ${q.fromWord}..${q.toWord} outside 0..${tc - 1}`)
      if (j > 0 && q.line <= n.quote[j - 1]!.line) err('quote entries must be in increasing line order')
      if (j < n.quote.length - 1 && q.toWord !== tc - 1) err(`line ${q.line}: every part except the last must end at the line's last word`)
      if (j > 0 && q.fromWord !== 0) err(`line ${q.line}: every part except the first must start at word 0`)
      if (!tokens[q.fromWord]!.first || !tokens[q.toWord]!.last) err(`line ${q.line}: quote splits a disagreement`)
      parts.push({ line: q.line, fromWord: q.fromWord, toWord: q.toWord, tokenCount: tc, k: line.wordCount })
    })
    if (errors.length > before) continue
    const want = parts
      .map((p) => tokenise(lines[p.line]!.primary).slice(p.fromWord, p.toWord + 1).join(' '))
      .join(' ')
    if (n.span !== want) {
      err(`span is not a quotation (the quoted words are ${JSON.stringify(want)})`)
      continue
    }
    out.push({ id: n.id, step: n.step, span: n.span, parts })
  }
  return { errors, notes: out }
}
