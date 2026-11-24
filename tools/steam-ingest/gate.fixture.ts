// A synthetic recipe folder on disk for the CLI gate tests.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { SOURCE, syntheticRecipe } from '../../src/ingest/gate.fixture.ts'
import { segmentCmd } from './segment.ts'

export function syntheticFolder(opts: { joined?: boolean; id?: string; root?: string } = {}) {
  const root = opts.root ?? mkdtempSync(join(tmpdir(), 'steam-gate-'))
  const id = opts.id ?? 'syn'
  const dir = join(root, 'content', 'recipes', id)
  mkdirSync(join(dir, 'agent'), { recursive: true })
  const rec = syntheticRecipe(opts)
  const enc = jpeg.encode({ width: rec.scan.width, height: rec.scan.height, data: Buffer.from(rec.scan.data) }, 100)
  writeFileSync(join(dir, 'page.jpg'), enc.data)
  writeFileSync(join(dir, 'source.json'), canonicalJson(SOURCE))
  segmentCmd(dir)
  const run = JSON.parse(readFileSync(join(dir, 'lines.json'), 'utf8')).segmentRun
  const scribe = { ...rec.scribe, segmentRun: run }
  const second = { ...rec.second, segmentRun: run }
  writeFileSync(join(dir, 'agent/scribe.json'), canonicalJson(scribe))
  writeFileSync(join(dir, 'agent/second.json'), canonicalJson(second))
  return { root, id, dir, scribe, second, run }
}
