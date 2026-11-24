// The one whole-page integration test: the committed real folder content/recipes/quinces-marmalade, gated end to end
// in a scratch copy (R40.4). It asserts states and messages, never a measured number.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { gateCmd } from './gate.ts'

const repo = new URL('../../', import.meta.url).pathname
const id = 'quinces-marmalade'
const real = join(repo, 'content/recipes', id)
const root = mkdtempSync(join(tmpdir(), 'steam-hero-'))
const dir = join(root, 'content/recipes', id)
afterAll(() => rmSync(root, { recursive: true, force: true }))
const copy = (rel: string, from = real, to = dir) => {
  mkdirSync(dirname(join(to, rel)), { recursive: true })
  copyFileSync(join(from, rel), join(to, rel))
}
for (const f of ['page.jpg', 'source.json', 'lines.json', 'fallback/reading.json']) copy(f)
for (const f of ['fixtures/gold-readings.json', 'fixtures/hero-word-bounds.json']) copy(f, repo, root)
const stripAt = (g: unknown) => {
  const { at: _a, ...rest } = g as Record<string, unknown>
  void _a
  return canonicalJson(rest)
}

describe('the hero note on the committed real folder (R40.4)', { timeout: 60_000 }, () => {
  it('fail: without an ownership review the hero note fails P3 with "joined strokes: needs review"', () => {
    const r = gateCmd(id, { root, noLog: true })
    expect(r.state).toBe('fail')
    expect(r.gate.results!.P3.detail).toMatch(/^joined strokes: needs review \(.*looks-red-smooth: split share 0\.\d{4} over 0\.02, components [\d,]+/)
    const hero = r.gate.splits!.notes.find((n) => n.noteId === 'looks-red-smooth')!
    expect(hero.status).toBe('failed')
    for (const c of hero.flagged) expect(existsSync(join(dir, `ownership/flag-${c}.png`))).toBe(true)
    expect(r.gate.recall!.find((x) => x.noteId === 'looks-red-smooth')!.threshold).toBe(JSON.parse(readFileSync(join(repo, 'fixtures/hero-word-bounds.json'), 'utf8')).recallThreshold)
  })
  it('reviewed: with the committed ownership-review.json the hero note passes P3 as reviewed, never auto, and the committed gate.json is reproduced', () => {
    copy('ownership-review.json')
    const r = gateCmd(id, { root, noLog: true })
    const reviewer = JSON.parse(readFileSync(join(real, 'ownership-review.json'), 'utf8')).decisions[0].reviewer
    expect(r.gate.results!.P3.pass).toBe(true)
    expect(r.gate.results!.P3.detail).toMatch(new RegExp(`looks-red-smooth reviewed \\(\\d+ components, by ${reviewer.replace(/[()]/g, '\\$&')}\\)`))
    expect(r.gate.splits!.notes.find((n) => n.noteId === 'looks-red-smooth')!.status).toBe('reviewed')
    expect(r.gate.ownership!.reviewedPass).toBeGreaterThan(0)
    expect(stripAt(r.gate)).toBe(stripAt(JSON.parse(readFileSync(join(real, 'gate.json'), 'utf8'))))
    rmSync(join(dir, 'ownership-review.json'))
  })
  it('waiting: without any reader file the gate waits for both agent files', () => {
    rmSync(join(dir, 'fallback'), { recursive: true })
    const r = gateCmd(id, { root, noLog: true })
    expect(r.state).toBe('waiting')
    expect(r.gate.waiting).toEqual(['missing: agent/scribe.json', 'missing: agent/second.json'])
  })
})
