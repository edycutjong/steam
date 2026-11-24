import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { syntheticFolder } from './gate.fixture.ts'
import { WatchOut, once } from './watch.ts'

const roots: string[] = []
const mk = (o: Parameters<typeof syntheticFolder>[0] = {}) => {
  const f = syntheticFolder(o)
  roots.push(f.root)
  return f
}
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))
const call = (root: string, cursor: unknown = null, recipe = 'syn') => once(JSON.stringify({ cursor, config: { recipe }, workspacePath: root }))
const parse = (stdout: string) => {
  expect(stdout.endsWith('\n')).toBe(true)
  expect(stdout.slice(0, -1)).not.toContain('\n')
  return WatchOut.parse(JSON.parse(stdout))
}

describe('--once watch protocol (R32)', () => {
  it('no reader files: one idle line with a cursor, logs on stderr only', () => {
    const f = mk()
    rmSync(join(f.dir, 'agent/scribe.json'))
    rmSync(join(f.dir, 'agent/second.json'))
    const r = call(f.root)
    expect(r.exit).toBe(0)
    const o = parse(r.stdout)
    expect(o).toEqual({ outcome: 'idle', cursor: { v: 1, polls: 1, invalid: {} } })
    expect(readFileSync(join(f.root, 'docs/kiro-evidence/hooks.log'), 'utf8')).toMatch(/ · watch · syn · waiting missing: agent\/scribe.json/)
  })
  it('both readers and a passing recipe: terminal-state with the payload as a string', () => {
    const f = mk()
    const r = call(f.root, { v: 1, polls: 3, invalid: {} })
    expect(r.exit).toBe(0)
    const o = parse(r.stdout)
    expect(o.outcome).toBe('terminal-state')
    if (o.outcome !== 'terminal-state') return
    expect(typeof o.payload).toBe('string')
    const p = JSON.parse(o.payload)
    expect(p.pass).toBe(true)
    expect(p.gateSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(p.reviewed).toEqual([])
    expect(o.cursor!.polls).toBe(4)
  })
  it('a failing recipe: terminal-state with {"pass":false,"failing":[...]}', () => {
    const f = mk({ joined: true })
    const o = parse(call(f.root).stdout)
    if (o.outcome !== 'terminal-state') throw new Error('expected terminal')
    const p = JSON.parse(o.payload)
    expect(p.pass).toBe(false)
    expect(p.failing[0]).toMatch(/^P3: joined strokes: needs review/)
  })
  it('an invalid reader file: idle first, fail on the repeat of the same hash', () => {
    const f = mk()
    writeFileSync(join(f.dir, 'agent/second.json'), '{"segmentRun": ')
    const a = parse(call(f.root).stdout)
    expect(a.outcome).toBe('idle')
    const b = parse(call(f.root, a.cursor).stdout)
    expect(b.outcome).toBe('terminal-state')
    if (b.outcome === 'terminal-state') expect(JSON.parse(b.payload).failing[0]).toMatch(/agent\/second.json: not JSON/)
    // the agent finishes writing: a different hash is valid again
    writeFileSync(join(f.dir, 'agent/second.json'), canonicalJson(f.second))
    expect(parse(call(f.root, b.cursor).stdout).outcome).toBe('terminal-state')
  })
  it('bad stdin, a bad recipe id or a missing folder exit 2 with nothing on stdout', () => {
    expect(once('not json')).toMatchObject({ exit: 2, stdout: '' })
    expect(once('[1]')).toMatchObject({ exit: 2, stdout: '' })
    expect(once(JSON.stringify({ config: { recipe: 'Bad Id' } }))).toMatchObject({ exit: 2 })
    expect(once(JSON.stringify({ config: {} }))).toMatchObject({ exit: 2 })
    expect(call('/nonexistent-root-for-test', null)).toMatchObject({ exit: 2 })
  })
  it('a thrown error exits 1 with the stack on stderr', () => {
    const f = mk()
    rmSync(join(f.dir, 'lines.json'))
    const r = call(f.root)
    expect(r.exit).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr.join('\n')).toMatch(/lines.json are needed/)
  })
  it('the module sends console.log to stderr and has no other console.log call', () => {
    const src = readFileSync(new URL('./watch.ts', import.meta.url), 'utf8')
    expect(src.match(/console\.log/g)!.length).toBe(1)
    expect(src).toMatch(/^console\.log = \(\.\.\.a: unknown\[\]\) => console\.error\(\.\.\.a\)$/m)
  })
  it('replays the probe handler shape: cursor present on idle, payload a string on terminal', () => {
    const probe = readFileSync(new URL('../../docs/kiro-evidence/probe-3.5.0/workspace/tools/gate.mjs', import.meta.url), 'utf8')
    expect(probe).toMatch(/outcome/)
    expect(WatchOut.safeParse({ outcome: 'idle' }).success).toBe(false)
    expect(WatchOut.safeParse({ outcome: 'idle', cursor: null }).success).toBe(true)
    expect(WatchOut.safeParse({ outcome: 'terminal-state', cursor: null, payload: { pass: true } }).success).toBe(false)
  })
})
