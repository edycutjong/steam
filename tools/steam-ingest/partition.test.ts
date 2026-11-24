// steam-ingest partition <id> --line <n> [--png <path>] (requirements R19.9, R38.1). Written before the implementation.
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { main } from './cli.ts'
import { syntheticFolder } from './gate.fixture.ts'
import { decodePng } from './io.ts'
import { readFileSync } from 'node:fs'
import { partitionCmd } from './partition.ts'

const f = syntheticFolder({ id: 'aaa' })
afterAll(() => rmSync(f.root, { recursive: true, force: true }))
const out: string[] = []
vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(a.join(' ')))
vi.spyOn(console, 'error').mockImplementation(() => {})

const tree = (d: string): string[] => readdirSync(d, { recursive: true }).map(String).sort()

describe('partitionCmd', () => {
  const r = partitionCmd(f.dir, { line: 3 })
  it('lists the ordered components of the line and the ranked candidates between them', () => {
    expect(r.line).toBe(3)
    expect(r.components.length).toBeGreaterThan(1)
    expect(r.candidates).toHaveLength(r.components.length - 1)
    expect(r.candidates.map((c) => c.rank)).toEqual(r.candidates.map((_, k) => k))
    for (let k = 1; k < r.candidates.length; k++) expect(r.candidates[k - 1]!.gap).toBeGreaterThanOrEqual(r.candidates[k]!.gap)
    for (const c of r.candidates) expect(r.components[c.position]!.id).toBe(c.after)
    const xs = r.components.map((c) => c.cx)
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  })
  it('says which candidates are a column run of runs.json (gap of at least the run minimum)', () => {
    for (const c of r.candidates) expect(c.run).toBe(c.gap >= 4)
  })
  it('names no coordinate as something to choose: a candidate is its two component ids', () => {
    expect(Object.keys(r.candidates[0]!).sort()).toEqual(['after', 'before', 'gap', 'position', 'rank', 'run'])
  })
  it('refuses a line that does not exist', () => {
    expect(() => partitionCmd(f.dir, { line: 99 })).toThrow(/no line 99/)
  })
})

describe('partition command line', () => {
  it('prints one JSON object per call and writes nothing without --png', async () => {
    const before = tree(f.root)
    out.length = 0
    expect(await main(['partition', 'aaa', '--line', '3'], f.root)).toBe(0)
    expect(tree(f.root)).toEqual(before)
    const parsed = JSON.parse(out.join('\n'))
    expect(parsed.line).toBe(3)
    expect(parsed.candidates.length).toBe(parsed.components.length - 1)
  })
  it('with --png writes the strip overlay, of the strip width, and nothing else in the recipe folder', async () => {
    const before = tree(f.root)
    const png = join(f.root, 'overlay-3.png')
    expect(await main(['partition', 'aaa', '--line', '3', '--png', png], f.root)).toBe(0)
    expect(existsSync(png)).toBe(true)
    expect(tree(f.root).filter((p) => !before.includes(p))).toEqual(['overlay-3.png'])
    const img = decodePng(readFileSync(png))
    const strip = decodePng(readFileSync(join(f.dir, 'strips/line-3.png')))
    expect(img.width).toBeGreaterThanOrEqual(strip.width)
    expect(img.height).toBeGreaterThan(strip.height)
    expect(statSync(png).size).toBeGreaterThan(100)
  })
  it('is a usage error without --line, or with a non-number', async () => {
    expect(await main(['partition', 'aaa'], f.root)).toBe(2)
    expect(await main(['partition', 'aaa', '--line', 'x'], f.root)).toBe(2)
    expect(await main(['partition', 'no-such', '--line', '3'], f.root)).toBe(2)
  })
})
