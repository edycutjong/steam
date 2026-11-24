import { describe, expect, it } from 'vitest'
import { Reading } from '../data/schema.ts'
import { formatTranscription, markedText, mergeReadings, mergeSingle, parseMarked, parseTranscription, primaryText, scribeToSlot, tokenise } from './merge.ts'

const run = { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }
const reading = (...texts: string[]) => ({ segmentRun: run, lines: texts.map((text, i) => ({ i, text })) })

describe('tokenise', () => {
  it('splits on whitespace', () => {
    expect(tokenise('  a  b\tc ')).toEqual(['a', 'b', 'c'])
    expect(tokenise('')).toEqual([])
  })
})

describe('mergeReadings (R15.2, R15.3)', () => {
  it('equal token counts: token-wise disagreements {line, word, a, b}, wordCount set', () => {
    const m = mergeReadings(reading('the Pareings & seeds', 'same line'), reading('the Parcings & seeds', 'same line'))
    expect(m.disagreements).toEqual([{ line: 0, word: 1, a: 'Pareings', b: 'Parcings' }])
    expect(m.lines[0]!.wordCount).toBe(4)
    expect(m.lines[1]!.wordCount).toBe(2)
    expect(markedText(m.lines[0]!.atoms)).toBe('the †[Pareings|Parcings] & seeds')
    expect(primaryText(m.lines[0]!.atoms)).toBe('the Pareings & seeds')
  })
  it('compares exactly: case and punctuation count', () => {
    expect(mergeReadings(reading('Quince,'), reading('quince,')).disagreements.length).toBe(1)
    expect(mergeReadings(reading('Quince,'), reading('Quince')).disagreements.length).toBe(1)
  })
  it('unequal counts: LCS regions with countMismatch, word = first scribe token, no word count', () => {
    const m = mergeReadings(reading('boil it till it Looks'), reading('boil it tillit Looks'))
    expect(m.lines[0]!.wordCount).toBeNull()
    expect(m.disagreements).toEqual([{ line: 0, word: 2, a: 'till it', b: 'tillit', countMismatch: true }])
    expect(markedText(m.lines[0]!.atoms)).toBe('boil it †[till it|tillit] Looks')
  })
  it('handles a region present on one side only', () => {
    const m = mergeReadings(reading('a b'), reading('a x b'))
    expect(m.disagreements).toEqual([{ line: 0, word: 1, a: '', b: 'x', countMismatch: true }])
    expect(markedText(m.lines[0]!.atoms)).toBe('a †[|x] b')
    expect(primaryText(m.lines[0]!.atoms)).toBe('a b')
  })
  it('carries each reader\'s uncertain entries without using them', () => {
    const a = { segmentRun: run, lines: [{ i: 0, text: 'x y', uncertain: [{ token: 'y', alt: ['z'] }] }] }
    const b = { segmentRun: run, lines: [{ i: 0, text: 'x y', uncertain: [{ token: 'x', alt: ['w'] }] }] }
    const m = mergeReadings(a, b)
    expect(m.disagreements).toEqual([])
    expect(m.readerUncertain).toEqual([
      { line: 0, reader: 'scribe', token: 'y', alt: ['z'] },
      { line: 0, reader: 'second-reader', token: 'x', alt: ['w'] },
    ])
  })
  it('refuses readings with different line counts', () => {
    expect(() => mergeReadings(reading('a'), reading('a', 'b'))).toThrow(/line count/)
  })
})

describe('scribeToSlot (R17.6)', () => {
  it('is the identity for equal counts and the region index inside a region', () => {
    const eq = mergeReadings(reading('a b c'), reading('a x c')).lines[0]!
    expect(scribeToSlot(eq.atoms)).toEqual([{ atom: 0, first: true, last: true }, { atom: 1, first: true, last: true }, { atom: 2, first: true, last: true }])
    const un = mergeReadings(reading('boil it till it Looks'), reading('boil it tillit Looks')).lines[0]!
    const m = scribeToSlot(un.atoms)
    expect(m.map((s) => s.atom)).toEqual([0, 1, 2, 2, 3])
    expect(m[2]).toEqual({ atom: 2, first: true, last: false })
    expect(m[3]).toEqual({ atom: 2, first: false, last: true })
  })
})

describe('transcription.md (R15.4)', () => {
  const m = mergeReadings(reading('a b', 'the Pareings & seeds'), reading('a b', 'the Parcings & seeds'))
  const header = { segmentRun: run.id, readers: ['b'.repeat(64), 'c'.repeat(64)] as [string, string] }
  it('has the strict header and one L-line per line', () => {
    const md = formatTranscription(header, m.lines)
    expect(md).toMatch(new RegExp(`^<!-- segmentRun: sr-0123456789ab readers: ${'b'.repeat(64)}:${'c'.repeat(64)} -->\\n<!-- merge: [0-9a-f]{64} -->\\nL00: a b\\nL01: the †\\[Pareings\\|Parcings\\] & seeds\\n$`))
  })
  it('pads indices to two digits and more past 99 lines', () => {
    const texts = Array.from({ length: 101 }, (_, i) => `w${i}`)
    const md = formatTranscription(header, mergeReadings(reading(...texts), reading(...texts)).lines)
    expect(md).toContain('\nL00: w0\n')
    expect(md).toContain('\nL100: w100\n')
  })
  it('parse(format(x)) returns the header and the marked lines', () => {
    const p = parseTranscription(formatTranscription(header, m.lines))
    expect(p).toMatchObject({ ok: true, header, lines: [{ i: 0, text: 'a b' }, { i: 1, text: 'the †[Pareings|Parcings] & seeds' }] })
  })
  it('parseMarked round-trips atoms', () => {
    for (const l of m.lines) expect(parseMarked(markedText(l.atoms))).toEqual(l.atoms)
    expect(parseMarked('a †[|x] b †[p q|r]')).toEqual([
      { kind: 'tok', text: 'a' },
      { kind: 'dis', a: [], b: ['x'] },
      { kind: 'tok', text: 'b' },
      { kind: 'dis', a: ['p', 'q'], b: ['r'] },
    ])
  })
  it('rejects a stray line, a missing header and a bad L-line', () => {
    expect(parseTranscription('hello\n').ok).toBe(false)
    expect(parseTranscription(`<!-- segmentRun: x readers: y -->\nL00: a\n`).ok).toBe(false)
    const ok = formatTranscription(header, m.lines)
    expect(parseTranscription(ok + 'stray line\n').ok).toBe(false)
    expect(parseTranscription(ok + '<!-- a comment -->\n\n').ok).toBe(true)
  })
})

describe('reader tokens containing | or ] are rejected by the schema (R14.1)', () => {
  it('Reading.safeParse fails', () => {
    expect(Reading.safeParse(reading('a|b')).success).toBe(false)
    expect(Reading.safeParse(reading('a]')).success).toBe(false)
  })
})

describe('mergeSingle (fallback reader)', () => {
  it('has no disagreements and a known word count', () => {
    const m = mergeSingle(reading('one two', 'three'))
    expect(m.disagreements).toEqual([])
    expect(m.lines.map((l) => l.wordCount)).toEqual([2, 1])
  })
})
