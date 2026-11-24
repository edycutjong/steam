import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { decodePng, encodePng } from './io.ts'
import { exitCodeOf, gateCmd, hooksLogPath } from './gate.ts'
import { syntheticFolder } from './gate.fixture.ts'

const clock = (iso: string) => () => new Date(iso)
const made: string[] = []
const folder = (o: Parameters<typeof syntheticFolder>[0] = {}) => {
  const f = syntheticFolder(o)
  made.push(f.root)
  return f
}
afterAll(() => made.forEach((r) => rmSync(r, { recursive: true, force: true })))

describe('steam-ingest gate on a synthetic recipe folder', () => {
  const f = folder()
  const first = gateCmd(f.id, { root: f.root, now: clock('2026-11-25T10:00:00.000Z') })
  it('passes, writes gate.json and the note files, exit 0, and logs one line', () => {
    expect(first.state).toBe('pass')
    expect(exitCodeOf(first.state)).toBe(0)
    for (const rel of Object.keys(first.gate.outputs)) expect(existsSync(join(f.dir, rel)), rel).toBe(true)
    expect(existsSync(join(f.dir, 'merged.json'))).toBe(true)
    const log = readFileSync(hooksLogPath(f.root), 'utf8').trim().split('\n')
    expect(log.length).toBe(1)
    expect(log[0]).toMatch(/^2026-11-25T10:00:00.000Z · cli · syn · pass P1-P6 ok/)
  })
  it('a second run is a no-op: gate.json bytes and at unchanged, still logged', () => {
    const before = readFileSync(join(f.dir, 'gate.json'))
    const again = gateCmd(f.id, { root: f.root, now: clock('2026-11-25T11:00:00.000Z') })
    expect(again.changed).toBe(false)
    expect(readFileSync(join(f.dir, 'gate.json')).equals(before)).toBe(true)
    expect(again.gate.at).toBe('2026-11-25T10:00:00.000Z')
    expect(readFileSync(hooksLogPath(f.root), 'utf8')).toMatch(/2026-11-25T11:00:00.000Z · cli · syn · pass .*no-op/)
  })
  it('a hand-edited note PNG is caught by --verify and rewritten by a normal run', () => {
    const p = join(f.dir, 'notes/note-full-ripe.png')
    const img = decodePng(readFileSync(p))
    const k = img.data.findIndex((v, i) => i % 4 === 3 && v === 0)
    img.data[k] = 200
    writeFileSync(p, encodePng(img))
    const v = gateCmd(f.id, { root: f.root, verify: true, noLog: true })
    expect(v.state).toBe('fail')
    expect(v.notes.join()).toMatch(/notes\/note-full-ripe.png differs from the computed pixels/)
    const r = gateCmd(f.id, { root: f.root, now: clock('2026-11-25T12:00:00.000Z') })
    expect(r.notes.join()).toMatch(/rewrote notes\/note-full-ripe.png/)
    expect(r.state).toBe('pass')
    expect(gateCmd(f.id, { root: f.root, verify: true, noLog: true }).state).toBe('pass')
  })
  it('a deleted note PNG is caught', () => {
    rmSync(join(f.dir, 'notes/note-till-smooth.toi.png'))
    expect(gateCmd(f.id, { root: f.root, verify: true, noLog: true }).state).toBe('fail')
    expect(gateCmd(f.id, { root: f.root }).state).toBe('pass')
  })
})

describe('the three hero paths on a joined-stroke recipe (R40.4)', () => {
  const f = folder({ joined: true })
  it('fail: split share over 2%, no review, exit 1, flag crops written', () => {
    const r = gateCmd(f.id, { root: f.root })
    expect(r.state).toBe('fail')
    expect(exitCodeOf(r.state)).toBe(1)
    expect(r.gate.results!.P3.detail).toMatch(/^joined strokes: needs review/)
    const flagged = r.gate.splits!.notes.find((n) => n.noteId === 'till-smooth')!.flagged
    for (const id of flagged) expect(existsSync(join(f.dir, `ownership/flag-${id}.png`))).toBe(true)
    expect(readFileSync(hooksLogPath(f.root), 'utf8')).toMatch(/· syn · fail failing P3/)
  })
  it('reviewed: an ownership review with a decision per flagged component passes as reviewed, never auto', () => {
    const r0 = gateCmd(f.id, { root: f.root })
    const flagged = r0.gate.splits!.notes.find((n) => n.noteId === 'till-smooth')!.flagged
    const review = {
      segmentRun: f.run,
      decisions: flagged.map((componentId) => ({ componentId, overlay: `ownership/flag-${componentId}.png`, decision: { assignToLine: 3 }, reviewer: 'Test reviewer (fixture)', rationale: 'the joining stroke is drawn from line 3' })),
    }
    writeFileSync(join(f.dir, 'ownership-review.json'), canonicalJson(review))
    const r = gateCmd(f.id, { root: f.root })
    expect(r.state).toBe('pass')
    expect(r.gate.results!.P3.detail).toContain(`till-smooth reviewed (${flagged.length} components, by Test reviewer (fixture))`)
    expect(r.gate.reviewed).toEqual([{ note: 'till-smooth', components: flagged.length, reviewer: 'Test reviewer (fixture)' }])
    expect(r.gate.ownership).toEqual({ autoPass: 1, reviewedPass: 1 })
    expect(r.gate.inputs.ownershipReview).toMatch(/^[0-9a-f]{64}$/)
    expect(r.logLine).toMatch(/till-smooth reviewed \(\d+ components by Test reviewer \(fixture\)\)/)
  })
  it('a stale review is ignored and says so', () => {
    const p = join(f.dir, 'ownership-review.json')
    const rv = JSON.parse(readFileSync(p, 'utf8'))
    writeFileSync(p, canonicalJson({ ...rv, segmentRun: { ...rv.segmentRun, id: 'sr-000000000000' } }))
    const r = gateCmd(f.id, { root: f.root })
    expect(r.state).toBe('fail')
    expect(r.gate.results!.P3.detail).toMatch(/^stale ownership review/)
    rmSync(p)
  })
  it('waiting: a missing or a stale reader file, exit 3', () => {
    const sp = join(f.dir, 'agent/second.json')
    const saved = readFileSync(sp)
    rmSync(sp)
    const w = gateCmd(f.id, { root: f.root })
    expect(w.state).toBe('waiting')
    expect(exitCodeOf(w.state)).toBe(3)
    expect(w.gate.waiting).toEqual(['missing: agent/second.json'])
    writeFileSync(sp, canonicalJson({ ...JSON.parse(saved.toString('utf8')), segmentRun: { id: 'sr-000000000000', stripsHash: f.run.stripsHash } }))
    expect(gateCmd(f.id, { root: f.root }).gate.waiting).toEqual(['stale reading: agent/second.json'])
    expect(readFileSync(hooksLogPath(f.root), 'utf8')).toMatch(/· syn · waiting stale reading: agent\/second.json/)
  })
})
