import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { joinReading, parseReading, plainText, primaryText, quoteSegments } from './reading.ts'
import { RecipeBundle } from './schema.ts'

const real = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))
const L3 = real.lines[3]!.merged
const note = (id: string) => real.notes.find((n) => n.id === id)!

describe('reading marks (R6.3, R6.6, R23.3)', () => {
  it('parses the real line 3 into text and two marks, the first with an empty b', () => {
    const segs = parseReading(L3)
    expect(L3).toBe('†[(N.26)|] take out the †[Cores|cores] and seeds, & boil the')
    expect(segs.filter((s) => s.kind === 'mark')).toEqual([{ kind: 'mark', a: '(N.26)', b: '' }, { kind: 'mark', a: 'Cores', b: 'cores' }])
    expect(segs.length).toBe(4)
    expect(joinReading(segs)).toBe(L3)
  })
  it('primaryText takes the first reader and equals lines[3].primary', () => {
    expect(primaryText(parseReading(L3))).toBe('(N.26) take out the Cores and seeds, & boil the')
    expect(primaryText(parseReading(L3))).toBe(real.lines[3]!.primary)
  })
  it('plainText names the second reader, and "nothing" for an empty reading', () => {
    expect(plainText(parseReading(L3))).toBe('(N.26) (the second reader reads nothing) take out the Cores (the second reader reads cores) and seeds, & boil the')
  })
  it('a lone dagger without brackets stays text; a marker with spaces inside is one mark', () => {
    expect(parseReading('a † b')).toEqual([{ kind: 'text', text: 'a † b' }])
    expect(parseReading('x †[a b|c] y')).toEqual([{ kind: 'text', text: 'x ' }, { kind: 'mark', a: 'a b', b: 'c' }, { kind: 'text', text: ' y' }])
    expect(parseReading('broken †[a|b and more')).toEqual([{ kind: 'text', text: 'broken †[a|b and more' }])
    expect(parseReading('')).toEqual([])
  })
})

describe('quoteSegments (R6.6, R9.2, R20.4)', () => {
  it('the hero gives "till it Looks" + " " + "red & smooth,"', () => {
    const s = quoteSegments(real, note('till-it-looks-red-smooth'))
    expect(primaryText(s)).toBe(note('till-it-looks-red-smooth').shownText)
    expect(s).toEqual([{ kind: 'text', text: 'till it Looks red & smooth,' }])
    expect(primaryText(s).replace(/[,.;:]+$/, '')).toBe(note('till-it-looks-red-smooth').span)
  })
  it('full-ripe and when-tender likewise', () => {
    for (const id of ['full-ripe', 'when-tender']) {
      const n = note(id)
      expect(primaryText(quoteSegments(real, n))).toBe(n.shownText)
      expect(primaryText(quoteSegments(real, n)).replace(/[,.;:]+$/, '')).toBe(n.span)
    }
  })
  it('keeps a marker whole when the chosen words touch it', () => {
    const b = JSON.parse(JSON.stringify(real))
    const n = b.notes[0]
    n.groups = [{ ...n.groups[0], line: 3, words: { from: 4, to: 4 } }] // "Cores" of line 3
    const s = quoteSegments(b, n)
    expect(s).toEqual([{ kind: 'mark', a: 'Cores', b: 'cores' }])
    n.groups[0].words = { from: 3, to: 5 } // "the Cores and"
    expect(joinReading(quoteSegments(b, n))).toBe('the †[Cores|cores] and')
  })
  it("words: 'line' takes the whole line", () => {
    const b = JSON.parse(JSON.stringify(real))
    const n = b.notes[0]
    n.groups = [{ ...n.groups[0], line: 3, words: 'line' }]
    expect(joinReading(quoteSegments(b, n))).toBe(L3)
  })
})
