import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { main } from './cli.ts'
import { syntheticFolder } from './gate.fixture.ts'

const f = syntheticFolder({ id: 'aaa' })
syntheticFolder({ root: f.root, id: 'bbb' })
afterAll(() => rmSync(f.root, { recursive: true, force: true }))
vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else out.set(p, `${statSync(p).mtimeMs}:${statSync(p).size}`)
    }
  }
  walk(dir)
  return out
}

describe('gate --all --verify (R38.3)', () => {
  it('exits non-zero when a recipe has no committed gate.json, and writes nothing', async () => {
    const before = snapshot(f.root)
    expect(await main(['gate', '--all', '--verify'], f.root)).not.toBe(0)
    expect(snapshot(f.root)).toEqual(before)
  })
  it('exits 0 when every committed gate.json matches a fresh run', async () => {
    expect(await main(['gate', 'aaa'], f.root)).toBe(0)
    expect(await main(['gate', 'bbb'], f.root)).toBe(0)
    const before = snapshot(f.root)
    expect(await main(['gate', '--all', '--verify'], f.root)).toBe(0)
    expect(snapshot(f.root)).toEqual(before)
  })
  it('exits non-zero for a differing gate.json, a failing recipe and a waiting recipe', async () => {
    const gp = join(f.root, 'content/recipes/aaa/gate.json')
    const good = readFileSync(gp, 'utf8')
    writeFileSync(gp, good.replace('"propsVersion": "2"', '"propsVersion": "0"'))
    expect(await main(['gate', '--all', '--verify'], f.root)).toBe(1)
    writeFileSync(gp, good)
    expect(await main(['gate', '--all', '--verify'], f.root)).toBe(0)
    const sp = join(f.root, 'content/recipes/bbb/agent/second.json')
    const second = readFileSync(sp)
    rmSync(sp)
    expect(await main(['gate', '--all', '--verify'], f.root)).toBe(3)
    writeFileSync(sp, second)
    const sc = join(f.root, 'content/recipes/bbb/agent/scribe.json')
    const scribe = readFileSync(sc, 'utf8')
    writeFileSync(sc, scribe.replace('"span": "full ripe,"', '"span": "full rip"'))
    expect(await main(['gate', '--all', '--verify'], f.root)).toBe(1)
    writeFileSync(sc, scribe)
  })
})

describe('usage (R38.5)', () => {
  it('prints a one-line usage and exits 2 on bad arguments', async () => {
    expect(await main([], f.root)).toBe(2)
    expect(await main(['nope'], f.root)).toBe(2)
    expect(await main(['segment'], f.root)).toBe(2)
    expect(await main(['segment', 'aaa', '--block', 'x'], f.root)).toBe(2)
    expect(await main(['fallback', 'aaa'], f.root)).toBe(2)
    expect(await main(['gate', 'Bad Id'], f.root)).toBe(2)
    expect(await main(['gate', 'no-such-recipe'], f.root)).toBe(2)
    expect(await main(['fetch', 'unknown-recipe'], f.root)).toBe(2)
  })
})

describe('package scripts and CI (R38.2, R38.4)', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  it('has ingest:gate, props and catalog', () => {
    expect(pkg.scripts['ingest:gate']).toBe('tsx tools/steam-ingest/cli.ts gate quinces-marmalade')
    expect(pkg.scripts.props).toBe('tsx tools/steam-ingest/cli.ts gate --all --verify')
    expect(pkg.scripts.catalog).toBe('tsx tools/steam-ingest/cli.ts catalog')
  })
  it('CI runs npm run props after npm test', () => {
    const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
    const t = ci.indexOf('run: npm test')
    const p = ci.indexOf('run: npm run props')
    expect(t).toBeGreaterThan(0)
    expect(p).toBeGreaterThan(t)
  })
})
