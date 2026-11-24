import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { syntheticRecipe } from '../../src/ingest/gate.fixture.ts'
import { fallbackCmd } from './fallback.ts'
import { sha256 } from './io.ts'

const dir = mkdtempSync(join(tmpdir(), 'steam-fb-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const rec = syntheticRecipe()
writeFileSync(join(dir, 'lines.json'), rec.files['lines.json']!)
const gold = { recipe: 'syn', by: 'Test reader', title: 'To make', lines: rec.scribe.lines.slice(1).map((l) => ({ text: l.text, ...(l.i === 2 ? { uncertain: [{ token: 'ripe,', alt: ['rype,'] }] } : {}) })) }
const goldPath = join(dir, 'gold.json')
writeFileSync(goldPath, JSON.stringify(gold))
const structure = { titleLine: 0, steps: rec.scribe.steps, notes: rec.scribe.notes }
const sp = join(dir, 'structure.json')
writeFileSync(sp, JSON.stringify(structure))

describe('fallback (R34)', () => {
  it('maps the gold lines after the title, writes readers ["fallback"] with by and the source hash, never agent/*', () => {
    const fb = fallbackCmd({ recipeDir: dir, goldPath, goldName: 'fixtures/gold.json', structurePath: sp })
    expect(fb.readers).toEqual(['fallback'])
    expect(fb.by).toBe('Test reader')
    expect(fb.sourceSha256).toBe(sha256(readFileSync(goldPath)))
    expect(fb.lines.map((l) => l.i)).toEqual([0, 1, 2, 3, 4])
    expect(fb.lines[0]!.text).toBe('To make')
    expect(fb.lines[2]!.uncertain).toEqual([{ token: 'ripe,', alt: ['rype,'] }])
    expect(fb.segmentRun).toEqual(rec.sf.lines.segmentRun)
    expect(readFileSync(join(dir, 'fallback/reading.json'), 'utf8')).toBe(canonicalJson(fb))
    expect(existsSync(join(dir, 'agent'))).toBe(false)
  })
  it('refuses a count mismatch', () => {
    const g2 = join(dir, 'gold2.json')
    writeFileSync(g2, JSON.stringify({ ...gold, lines: gold.lines.slice(1) }))
    expect(() => fallbackCmd({ recipeDir: dir, goldPath: g2, goldName: 'x', structurePath: sp })).toThrow(/3 body lines, lines.json has 4/)
  })
  it('refuses a structure whose span is not a quotation', () => {
    const s2 = join(dir, 's2.json')
    writeFileSync(s2, JSON.stringify({ ...structure, notes: [{ ...structure.notes[0], span: 'full ripe' }] }))
    expect(() => fallbackCmd({ recipeDir: dir, goldPath, goldName: 'x', structurePath: s2 })).toThrow(/span is not a quotation/)
  })
})
