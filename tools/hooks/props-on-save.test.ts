import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { syntheticFolder } from '../steam-ingest/gate.fixture.ts'
import { hooksLogFile, hookLine, parseHookInput, toRel } from './lib.ts'
import { HOOK, run, SAVE_PATH } from './props-on-save.ts'
import { pipeToScript, postFile } from './recorded.ts'

const made: string[] = []
const folder = (o: Parameters<typeof syntheticFolder>[0] = {}) => {
  const f = syntheticFolder(o)
  made.push(f.root)
  return f
}
afterAll(() => made.forEach((r) => rmSync(r, { recursive: true, force: true })))
const lines = (root: string) => (existsSync(hooksLogFile(root)) ? readFileSync(hooksLogFile(root), 'utf8').split('\n').filter(Boolean) : [])
const hookJson = JSON.parse(readFileSync(join(import.meta.dirname, '../../.kiro/hooks/props-on-save.json'), 'utf8'))

describe('props-on-save: the hook file', () => {
  it('is a v1 hook file with a PostFileSave and a PostFileCreate hook that run the script', () => {
    expect(hookJson.version).toBe('v1')
    expect(hookJson.hooks.map((h: { trigger: string }) => h.trigger).sort()).toEqual(['PostFileCreate', 'PostFileSave'])
    for (const h of hookJson.hooks) {
      expect(h.action).toEqual({ type: 'command', command: 'npx tsx tools/hooks/props-on-save.ts' })
      expect(h.enabled).toBe(true)
      expect(h.timeout).toBeGreaterThanOrEqual(60)
    }
  })
  it('uses one regular expression (never a glob) as matcher, and it selects exactly the gate inputs an agent writes', () => {
    const matchers = new Set(hookJson.hooks.map((h: { matcher: string }) => h.matcher))
    expect(matchers.size).toBe(1)
    const re = new RegExp([...matchers][0] as string)
    const abs = '/Users/x/steam/content/recipes/quinces-marmalade'
    const yes = ['agent/scribe.json', 'agent/second.json', 'alignment.json', 'transcription.md', 'ownership-review.json']
    const no = ['lines.json', 'gate.json', 'review.json', 'merged.json', 'source.json', 'strips/line-0.png', 'agent/notes.md', 'agent/deep/x.json', 'notes/note-full-ripe.json', 'recipe.json']
    for (const f of yes) {
      expect(re.test(`${abs}/${f}`), f).toBe(true)
      expect(SAVE_PATH.test(`${abs}/${f}`), f).toBe(true)
    }
    for (const f of no) {
      expect(re.test(`${abs}/${f}`), f).toBe(false)
      expect(SAVE_PATH.test(`${abs}/${f}`), f).toBe(false)
    }
    expect(SAVE_PATH.test('/Users/x/mycontent/recipes/a/alignment.json')).toBe(false)
    expect(SAVE_PATH.test('content/recipes/a/alignment.json')).toBe(true)
  })
})

describe('lib', () => {
  it('formats one line with U+00B7 separators, never a newline inside, and caps the result', () => {
    const l = hookLine(new Date('2026-11-25T01:02:03.004Z'), 'h', 't', 'fail\nP3  joined')
    expect(l).toBe('2026-11-25T01:02:03.004Z · h · t · fail P3 joined\n')
    expect(hookLine(new Date(0), 'h', 't', 'x'.repeat(900)).length).toBeLessThan(460)
  })
  it('parses only a JSON object; makes paths relative only inside the root', () => {
    expect(parseHookInput('[]')).toBeNull()
    expect(parseHookInput('nope')).toBeNull()
    expect(parseHookInput('{"a":1}')).toEqual({ a: 1 })
    expect(toRel('/r', '/r/a/b.json')).toBe('a/b.json')
    expect(toRel('/r', '/elsewhere/b.json')).toBe('/elsewhere/b.json')
  })
})

describe('props-on-save: piping recorded PostFileSave and PostFileCreate documents', () => {
  const f = folder()
  const path = join(f.dir, 'agent/second.json')
  const t = (iso: string) => ({ now: () => new Date(iso) })

  it('PostFileSave on a gate input runs the gate and appends exactly one line; exit 0', () => {
    const r = run(postFile('PostFileSave', f.root, path), t('2026-11-25T10:00:00.000Z'))
    expect(r.exit).toBe(0)
    expect(r.stdout).toMatch(/gate syn: pass P1-P6 ok/)
    const l = lines(f.root)
    expect(l).toHaveLength(1)
    expect(l[0]).toBe(`2026-11-25T10:00:00.000Z · ${HOOK} · syn ← content/recipes/syn/agent/second.json · pass P1-P6 ok`)
    expect(existsSync(join(f.dir, 'gate.json'))).toBe(true)
  })
  it('PostFileCreate on the same file is a no-op for the gate (input-hash lock), gate.json bytes unchanged, one more line', () => {
    const before = readFileSync(join(f.dir, 'gate.json'))
    const r = run(postFile('PostFileCreate', f.root, path), t('2026-11-25T10:00:05.000Z'))
    expect(r.exit).toBe(0)
    expect(readFileSync(join(f.dir, 'gate.json')).equals(before)).toBe(true)
    const l = lines(f.root)
    expect(l).toHaveLength(2)
    expect(l[1]).toMatch(/^2026-11-25T10:00:05.000Z · props-on-save · syn ← .* · pass P1-P6 ok · no-op \(inputs unchanged\)$/)
  })
  it('a relative file_path is resolved against the event\'s cwd', () => {
    const rel = folder({ id: 'relative' })
    const r = run(postFile('PostFileCreate', rel.root, 'content/recipes/relative/agent/second.json'), t('2026-11-25T10:00:30.000Z'))
    expect(r.exit).toBe(0)
    expect(lines(rel.root)).toHaveLength(1)
    expect(lines(rel.root)[0]).toMatch(/ · relative ← content\/recipes\/relative\/agent\/second\.json · pass P1-P6 ok$/)
  })
  it('logs "waiting" with the reason when the other reader has not written yet, and still exits 0', () => {
    const w = folder({ id: 'half' })
    rmSync(join(w.dir, 'agent/second.json'))
    const r = run(postFile('PostFileCreate', w.root, join(w.dir, 'agent/scribe.json')), t('2026-11-25T10:01:00.000Z'))
    expect(r.exit).toBe(0)
    expect(lines(w.root)).toHaveLength(1)
    expect(lines(w.root)[0]).toMatch(/ · half ← content\/recipes\/half\/agent\/scribe\.json · waiting .+/)
  })
  it('logs "fail" with the failing property when the gate fails, and still exits 0 (it gates, it does not block the save)', () => {
    const j = folder({ id: 'joined', joined: true })
    const r = run(postFile('PostFileSave', j.root, join(j.dir, 'agent/scribe.json')), t('2026-11-25T10:02:00.000Z'))
    expect(r.exit).toBe(0)
    expect(lines(j.root)).toHaveLength(1)
    expect(lines(j.root)[0]).toMatch(/ · joined ← .* · fail P\d /)
  })
  it('logs "error" and exits 0 when the recipe folder is not ready', () => {
    const e = folder({ id: 'bare' })
    rmSync(join(e.dir, 'source.json'))
    const r = run(postFile('PostFileSave', e.root, join(e.dir, 'agent/scribe.json')), t('2026-11-25T10:03:00.000Z'))
    expect(r.exit).toBe(0)
    expect(lines(e.root)).toHaveLength(1)
    expect(lines(e.root)[0]).toMatch(/ · bare ← .* · error content\/recipes\/bare: source\.json and lines\.json are needed/)
    expect(lines(e.root)[0]).not.toContain(e.root) // the log is public: no absolute paths
  })
  it('writes nothing and exits 0 for other files, for non-JSON stdin and for a missing file_path', () => {
    const o = folder({ id: 'other' })
    for (const raw of [postFile('PostFileSave', o.root, join(o.dir, 'lines.json')), postFile('PostFileSave', o.root, join(o.dir, 'gate.json')), 'not json', '{"hook_event_name":"PostFileSave"}', '[]']) {
      const r = run(raw)
      expect(r.exit).toBe(0)
      expect(r.stdout + r.stderr).toBe('')
    }
    expect(existsSync(hooksLogFile(o.root))).toBe(false)
  })
  it('a hooks.log that cannot be appended does not change the exit code', () => {
    const b = folder({ id: 'nolog' })
    mkdirSync(hooksLogFile(b.root), { recursive: true }) // a directory where the file should be
    const r = run(postFile('PostFileSave', b.root, join(b.dir, 'agent/scribe.json')))
    expect(r.exit).toBe(0)
    expect(r.stderr).toMatch(/could not append to hooks\.log/)
  })
})

describe('props-on-save: the script as Kiro starts it', () => {
  it('npx tsx tools/hooks/props-on-save.ts with a recorded PostFileSave on stdin exits 0 and appends one line to the log of the saved file\'s repository', () => {
    const f = folder({ id: 'piped' })
    writeFileSync(join(f.root, 'unrelated.txt'), '')
    const r = pipeToScript('tools/hooks/props-on-save.ts', postFile('PostFileSave', f.root, join(f.dir, 'agent/scribe.json')))
    expect(r.exit).toBe(0)
    expect(lines(f.root)).toHaveLength(1)
    expect(lines(f.root)[0]).toMatch(/ · props-on-save · piped ← content\/recipes\/piped\/agent\/scribe\.json · pass P1-P6 ok$/)
  }, 60_000)
})
