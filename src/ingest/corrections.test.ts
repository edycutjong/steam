import { describe, expect, it } from 'vitest'
import { applyCorrections, formatTranscription, mergeReadings, type TranscriptionHeader } from './merge.ts'

const run = { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }
const mk = (...t: string[]) => ({ segmentRun: run, lines: t.map((text, i) => ({ i, text })) })
const header: TranscriptionHeader = { segmentRun: run.id, readers: ['b'.repeat(64), 'c'.repeat(64)] }
const merged = mergeReadings(mk('To make', 'the Pareings & seeds', 'boil it till it Looks'), mk('To make', 'the Parcings & seeds', 'boil it tillit Looks'))
const md = formatTranscription(header, merged.lines)
const quoted = new Map<number, number>([[2, 5]]) // line 2 is quoted; it has 5 scribe tokens

describe('applyCorrections (R16)', () => {
  it('an unchanged file yields no corrections', () => {
    const r = applyCorrections(merged, md, header, quoted)
    expect(r.state).toBe('ok')
    if (r.state !== 'ok') return
    expect(r.corrections).toEqual([])
    expect(r.lines.map((l) => l.corrected)).toEqual([undefined, undefined, undefined])
  })
  it('a revised line yields {line, before, after} and its text is used from then on', () => {
    const edited = md.replace('†[Pareings|Parcings]', 'Parcings')
    const r = applyCorrections(merged, edited, header, quoted)
    expect(r.state).toBe('ok')
    if (r.state !== 'ok') return
    expect(r.corrections).toEqual([{ line: 1, before: 'the †[Pareings|Parcings] & seeds', after: 'the Parcings & seeds' }])
    expect(r.lines[1]!.primary).toBe('the Parcings & seeds')
    expect(r.lines[1]!.corrected).toBe('the Parcings & seeds')
    expect(r.lines[1]!.merged).toBe('the †[Pareings|Parcings] & seeds')
  })
  it('the disagreement entry stays, with correctedTo', () => {
    const edited = md.replace('†[Pareings|Parcings]', 'Parcings')
    const r = applyCorrections(merged, edited, header, quoted)
    if (r.state !== 'ok') throw new Error(r.detail)
    expect(r.disagreements.length).toBe(merged.disagreements.length)
    expect(r.disagreements.find((d) => d.line === 1)).toEqual({ line: 1, word: 1, a: 'Pareings', b: 'Parcings', correctedTo: 'Parcings' })
    expect(r.disagreements.find((d) => d.line === 2)!.correctedTo).toBeUndefined()
    expect(merged.disagreements.find((d) => d.line === 1)!.correctedTo).toBeUndefined()
  })
  it('fails "line structure changed" for a changed count, index or a stray line', () => {
    for (const bad of [md.replace('L01: ', 'L03: '), md.split('\n').slice(0, 3).join('\n') + '\n', md + 'stray\n', md.replace('L02:', 'M02:')]) {
      const r = applyCorrections(merged, bad, header, quoted)
      expect(r.state).toBe('fail')
      expect(r.detail).toMatch(/line structure changed/)
    }
  })
  it('is waiting "stale transcription.md" for another segmentRun or reader hash', () => {
    const a = applyCorrections(merged, md.replace('sr-0123456789ab', 'sr-ffffffffffff'), header, quoted)
    expect(a.state).toBe('waiting')
    expect(a.detail).toBe('stale transcription.md')
    const b = applyCorrections(merged, md.replace('b'.repeat(64), 'e'.repeat(64)), header, quoted)
    expect(b.state).toBe('waiting')
  })
  it('fails when a correction changes the token count of a quoted line', () => {
    const r = applyCorrections(merged, md.replace('boil it †[till it|tillit] Looks', 'boil it till Looks'), header, quoted)
    expect(r.state).toBe('fail')
    expect(r.detail).toBe('correction changes the word count of a quoted line')
    // the same edit on an unquoted line is allowed
    const ok = applyCorrections(merged, md.replace('the †[Pareings|Parcings] & seeds', 'the seeds'), header, quoted)
    expect(ok.state).toBe('ok')
  })
})
