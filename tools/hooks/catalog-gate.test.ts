import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { verifyRecipe } from '../steam-ingest/catalog.ts'
import { gateCmd } from '../steam-ingest/gate.ts'
import { syntheticFolder } from '../steam-ingest/gate.fixture.ts'
import { sha256 } from '../steam-ingest/io.ts'
import { CATALOG_REL, run } from './catalog-gate.ts'
import { hooksLogFile } from './lib.ts'
import { pipeToScript, preFsWrite, preStrReplace } from './recorded.ts'

const made: string[] = []
afterAll(() => made.forEach((r) => rmSync(r, { recursive: true, force: true })))
const lines = (root: string) => (existsSync(hooksLogFile(root)) ? readFileSync(hooksLogFile(root), 'utf8').split('\n').filter(Boolean) : [])
const hookJson = JSON.parse(readFileSync(join(import.meta.dirname, '../../.kiro/hooks/catalog-gate.json'), 'utf8'))

/** A repository root with a gated, reviewed recipe `good`, a joined-strokes recipe `joined`, and a gated recipe `unreviewed`. */
function repo() {
  const good = syntheticFolder({ id: 'good' })
  made.push(good.root)
  const joined = syntheticFolder({ id: 'joined', joined: true, root: good.root })
  const unrev = syntheticFolder({ id: 'unreviewed', root: good.root })
  for (const id of ['good', 'joined', 'unreviewed']) gateCmd(id, { root: good.root, noLog: true })
  const review = (id: string, reviewedBy = 'A. Person') =>
    writeFileSync(join(good.root, 'content/recipes', id, 'review.json'), canonicalJson({ reviewedBy, reviewedAt: '2026-11-25', gateSha256: sha256(readFileSync(join(good.root, 'content/recipes', id, 'gate.json'))) }))
  review('good')
  const entry = (id: string) => {
    const v = verifyRecipe(good.root, id)
    if (!v.ok) throw new Error(`fixture: ${id} should verify: ${v.reason}`)
    return { id, title: v.bundle.title, gateSha256: v.gateSha256 }
  }
  return { root: good.root, dir: good.dir, joined, unrev, review, entry }
}
const path = (root: string) => join(root, CATALOG_REL)
const at = (iso: string) => ({ now: () => new Date(iso) })

describe('catalog-gate: the hook file', () => {
  it('is a v1 PreToolUse hook with matcher "write", the proven selector for fs_write and str_replace', () => {
    expect(hookJson.version).toBe('v1')
    expect(hookJson.hooks).toHaveLength(1)
    expect(hookJson.hooks[0]).toMatchObject({ trigger: 'PreToolUse', matcher: 'write', enabled: true, action: { type: 'command', command: 'npx tsx tools/hooks/catalog-gate.ts' } })
  })
})

describe('catalog-gate: recorded PreToolUse documents', () => {
  const r = repo()

  it('other paths: exit 0, nothing on either stream, no log line', () => {
    for (const raw of [
      preFsWrite(r.root, join(r.root, 'src/App.tsx'), 'x'),
      preFsWrite(r.root, join(r.root, 'content/recipes/good/agent/scribe.json'), '{}'),
      preFsWrite(r.root, join(r.root, 'content/recipes/good/catalog-notes.json'), '[]'),
      preStrReplace(r.root, join(r.root, 'content/recipes/good/review.json'), 'a', 'b'),
      'not json',
      JSON.stringify({ hook_event_name: 'PreToolUse', cwd: r.root, tool_name: 'fs_write', tool_input: {} }),
    ]) {
      const out = run(raw)
      expect(out).toEqual({ exit: 0, stdout: '', stderr: '' })
    }
    expect(existsSync(hooksLogFile(r.root))).toBe(false)
  })

  it('exit 2 for a recipe whose gate.json has pass=false, and the message names the failing property and `npm run catalog`', () => {
    const body = JSON.stringify([{ id: 'joined', title: 'To make', gateSha256: 'a'.repeat(64) }])
    const out = run(preFsWrite(r.root, path(r.root), body), at('2026-11-25T12:00:00.000Z'))
    expect(out.exit).toBe(2)
    expect(out.stderr).toMatch(/^catalog-gate: joined: gate\.json pass=false \(P\d [^)]+\)/)
    expect(out.stderr).toContain('`npm run catalog`')
    expect(out.stderr).toContain('.kiro/steering/product.md')
    expect(lines(r.root)).toHaveLength(1)
    expect(lines(r.root)[0]).toMatch(/^2026-11-25T12:00:00\.000Z · catalog-gate · content\/catalog\.json · blocked: joined: gate\.json pass=false/)
  })

  it('exit 2 for a gate that passes but has no review.json, and for an empty reviewedBy', () => {
    const body = JSON.stringify([{ id: 'unreviewed', title: 'To make', gateSha256: 'a'.repeat(64) }])
    expect(run(preFsWrite(r.root, path(r.root), body)).stderr).toMatch(/unreviewed: no valid review\.json with a reviewedBy/)
    r.review('unreviewed', '   ')
    const blank = run(preFsWrite(r.root, path(r.root), body))
    expect(blank.exit).toBe(2)
    expect(blank.stderr).toMatch(/unreviewed: review\.json has an empty reviewedBy/)
  })

  it('exit 2 when a gate input changed after the gate ran (hash mismatch), and when the listed hash or title is not the real one', () => {
    const e = r.entry('good')
    const sp = join(r.dir, 'agent/second.json')
    const saved = readFileSync(sp, 'utf8')
    writeFileSync(sp, `${saved} `)
    const stale = run(preFsWrite(r.root, path(r.root), JSON.stringify([e])))
    expect(stale.exit).toBe(2)
    expect(stale.stderr).toMatch(/good: input agent\/second\.json changed since the gate ran/)
    writeFileSync(sp, saved)
    expect(run(preFsWrite(r.root, path(r.root), JSON.stringify([{ ...e, gateSha256: 'b'.repeat(64) }]))).stderr).toMatch(/good: the listed gateSha256 is not the SHA-256 of its gate\.json/)
    expect(run(preFsWrite(r.root, path(r.root), JSON.stringify([{ ...e, title: 'Made up' }]))).stderr).toMatch(/good: the listed title/)
    expect(run(preFsWrite(r.root, path(r.root), JSON.stringify([e, e]))).stderr).toMatch(/good: listed twice/)
  })

  it('exit 2 for an unknown recipe, for content that is not a catalog, and for a write the hook cannot read', () => {
    const none = run(preFsWrite(r.root, path(r.root), JSON.stringify([{ id: 'ghost', title: 'x', gateSha256: 'a'.repeat(64) }])))
    expect(none.exit).toBe(2)
    expect(none.stderr).toMatch(/ghost: no gate\.json/)
    expect(run(preFsWrite(r.root, path(r.root), 'not json at all')).exit).toBe(2)
    expect(run(preFsWrite(r.root, path(r.root), '{"id":"good"}')).stderr).toMatch(/is not a catalog/)
    const odd = run(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: r.root, tool_name: 'fs_write', tool_input: { path: path(r.root) } }))
    expect(odd.exit).toBe(2)
    const other = run(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: r.root, tool_name: 'delete_file', tool_input: { path: path(r.root) } }))
    expect(other.exit).toBe(2)
  })

  it('exit 0 and one "allowed" line when every listed recipe has a passing gate, matching hashes and a reviewed review.json (or the list is empty)', () => {
    const before = lines(r.root).length
    const ok1 = run(preFsWrite(r.root, path(r.root), canonicalJson([r.entry('good')])), at('2026-11-25T12:30:00.000Z'))
    expect(ok1).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines(r.root)).toHaveLength(before + 1)
    expect(lines(r.root).at(-1)).toBe('2026-11-25T12:30:00.000Z · catalog-gate · content/catalog.json · allowed: 1 recipe verified (gate pass, hashes match, review.json)')
    expect(run(preFsWrite(r.root, path(r.root), '[]')).exit).toBe(0)
  })

  it('str_replace is applied to the file on disk before it is judged', () => {
    mkdirSync(join(r.root, 'content'), { recursive: true })
    const good = JSON.stringify([r.entry('good')])
    writeFileSync(path(r.root), good) // the fixture's own file; this test file is not a writer the product relies on
    const badEntry = JSON.stringify({ id: 'joined', title: 'To make', gateSha256: 'a'.repeat(64) })
    const add = run(preStrReplace(r.root, path(r.root), '}]', `},${badEntry}]`))
    expect(add.exit).toBe(2)
    expect(add.stderr).toMatch(/joined: gate\.json pass=false/)
    const rename = run(preStrReplace(r.root, path(r.root), r.entry('good').title, 'Another title'))
    expect(rename.exit).toBe(2)
    const harmless = run(preStrReplace(r.root, path(r.root), '[{', '[ {'))
    expect(harmless.exit).toBe(0)
    const missing = run(preStrReplace(r.root, path(r.root), 'text that is not there', 'x'))
    expect(missing.exit).toBe(0)
    expect(lines(r.root).at(-1)).toMatch(/allowed \(the replacement does not apply/)
  })
})

describe('catalog-gate: the script as Kiro starts it', () => {
  const r = repo()
  it('exits 2 with the reason on stderr for a failing recipe, and 0 silently for another path', () => {
    const blocked = pipeToScript('tools/hooks/catalog-gate.ts', preFsWrite(r.root, path(r.root), JSON.stringify([{ id: 'joined', title: 'To make', gateSha256: 'a'.repeat(64) }])))
    expect(blocked.exit).toBe(2)
    expect(blocked.stdout).toBe('')
    expect(blocked.stderr).toMatch(/catalog-gate: joined: gate\.json pass=false \(P\d .*`npm run catalog`/s)
    const passed = pipeToScript('tools/hooks/catalog-gate.ts', preFsWrite(r.root, join(r.root, 'src/x.ts'), 'export {}'))
    expect(passed).toEqual({ exit: 0, stdout: '', stderr: '' })
  }, 60_000)
})
