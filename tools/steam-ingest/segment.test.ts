// The real decoder and the real page: structural facts only, plus the measured figures recorded to
// docs/kiro-evidence/ingest/measurements.json (R40.3). No expected value of a measurement is asserted here.
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Lines } from '../../src/data/schema.ts'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { fetchRecipe, fixtureGet, KNOWN, writeFetched } from './fetch.ts'
import { decodePng, writeJson } from './io.ts'
import { segmentCmd, segmentMeasurements } from './segment.ts'

const root = new URL('../../', import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), 'steam-seg-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('segment on fixtures/p0033.jpg', async () => {
  writeFetched(dir, await fetchRecipe(KNOWN['quinces-marmalade']!, fixtureGet(root), 'fixture'))
  copyFileSync(join(root, 'fixtures/p0033.jpg'), join(dir, 'page.jpg'))
  const first = segmentCmd(dir, { block: 1 })
  const linesBytes = readFileSync(join(dir, 'lines.json'))

  it('writes every file, schema valid, canonical, with the region inside the page', () => {
    for (const f of ['lines.json', 'region.json', 'runs.json', 'ownership/splits.json', 'ownership/overlay.png']) expect(existsSync(join(dir, f)), f).toBe(true)
    const l = Lines.parse(JSON.parse(linesBytes.toString('utf8')))
    expect(canonicalJson(l)).toBe(linesBytes.toString('utf8'))
    expect(l.region.x0).toBeGreaterThanOrEqual(0)
    expect(l.region.y0).toBeGreaterThanOrEqual(0)
    expect(l.region.x1).toBeLessThanOrEqual(l.frame.width)
    expect(l.region.y1).toBeLessThanOrEqual(l.frame.height)
    expect(l.selectedBy).toBe('curator')
    for (const line of l.lines) expect(existsSync(join(dir, 'strips', `line-${line.i}.png`))).toBe(true)
    const strip = decodePng(readFileSync(join(dir, 'strips', 'line-0.png')))
    expect(strip.width).toBe(l.region.x1 - l.region.x0)
    expect(decodePng(readFileSync(join(dir, 'ownership/overlay.png'))).width).toBe(l.frame.width)
  })
  it('a second run is byte-identical with the same segmentRun', () => {
    const again = segmentCmd(dir, { block: 1 })
    expect(readFileSync(join(dir, 'lines.json')).equals(linesBytes)).toBe(true)
    expect(again.files.lines.segmentRun).toEqual(first.files.lines.segmentRun)
  })
  it('records the measured figures', () => {
    const m = segmentMeasurements(first.files)
    const p = join(root, 'docs/kiro-evidence/ingest/measurements.json')
    const prev = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
    writeJson(p, { ...prev, segment: { source: 'tools/steam-ingest/segment.test.ts on fixtures/p0033.jpg, --block 1', ...m } })
    expect(m.lineCount).toBeGreaterThan(0)
    console.error(`segment: ${first.summary}; deskew ${m.deskewDeg} applied ${m.deskewApplied}; slant ${m.slant}; ${m.splitCount} splits`)
  })
})
