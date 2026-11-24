import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { joinReading, parseReading, primaryText, quoteSegments } from './reading.ts'
import { RecipeBundle } from './schema.ts'

// K2 (design 13): reading marks are lossless.
const word = fc.stringMatching(/^[A-Za-z0-9&.,'()]{1,8}$/)
const markPart = fc.stringMatching(/^[A-Za-z0-9 .()ʳ']{0,6}$/)
const piece = fc.oneof(word, fc.tuple(markPart, markPart).map(([a, b]) => `†[${a}|${b}]`))
const line = fc.array(piece, { minLength: 0, maxLength: 12 }).map((p) => p.join(' '))

describe('K2: reading marks are lossless', () => {
  it('joinReading(parseReading(s)) = s, mark count = count of "†[", primaryText = s with each marker replaced by a', () => {
    fc.assert(
      fc.property(line, (s) => {
        const segs = parseReading(s)
        expect(joinReading(segs)).toBe(s)
        expect(segs.filter((x) => x.kind === 'mark').length).toBe((s.match(/†\[/g) ?? []).length)
        expect(primaryText(segs)).toBe(s.replace(/†\[([^|\]†]*)\|[^|\]†]*\]/g, '$1'))
      }),
      { numRuns: 1500 },
    )
  })
  it('parseReading never throws, on any string, and is lossless', () => {
    fc.assert(fc.property(fc.string({ unit: 'binary' }), (s) => joinReading(parseReading(s)) === s), { numRuns: 1500 })
    fc.assert(fc.property(fc.stringMatching(/^[a|†\[\] ]{0,24}$/), (s) => joinReading(parseReading(s)) === s), { numRuns: 1500 })
  })

  const b = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))
  it('on the real bundle every step without a corrected line has primaryText equal to its step text', () => {
    for (const st of b.steps) {
      const ls = st.lineIdx.map((i) => b.lines.find((l) => l.i === i)!)
      if (ls.some((l) => l.corrected !== undefined)) continue
      expect(primaryText(parseReading(ls.map((l) => l.merged).join(' ')))).toBe(st.text)
    }
  })
  it('every displayable note quotes its span, up to the trailing , . ; : that span omits', () => {
    for (const n of b.notes) expect(primaryText(quoteSegments(b, n)).replace(/[,.;:]+$/, '')).toBe(n.span)
  })
})
