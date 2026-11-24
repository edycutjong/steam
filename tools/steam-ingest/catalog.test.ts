import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { catalogCmd } from './catalog.ts'
import { gateCmd } from './gate.ts'
import { syntheticFolder } from './gate.fixture.ts'
import { decodePng, encodePng, sha256 } from './io.ts'

const agents = syntheticFolder({ id: 'agents' })
const root = agents.root
const fb = syntheticFolder({ root, id: 'fallback-one' })
afterAll(() => rmSync(root, { recursive: true, force: true }))
// the fallback recipe: one labelled reader instead of the two agent files
rmSync(join(fb.dir, 'agent'), { recursive: true })
mkdirSync(join(fb.dir, 'fallback'))
writeFileSync(join(fb.dir, 'fallback/reading.json'), canonicalJson({ ...fb.scribe, readers: ['fallback'], by: 'Test reader', source: 'fixtures/gold.json', sourceSha256: 'a'.repeat(64) }))
gateCmd('agents', { root })
gateCmd('fallback-one', { root })
const review = (gateSha256: string, reviewedBy = 'A. Person') => writeFileSync(join(agents.dir, 'review.json'), canonicalJson({ reviewedBy, reviewedAt: '2026-11-25', gateSha256 }))
const gateSha = () => sha256(readFileSync(join(agents.dir, 'gate.json')))
const cat = () => JSON.parse(readFileSync(join(root, 'content/catalog.json'), 'utf8'))

describe('catalog (R35)', () => {
  it('accepts the fallback recipe without a review; refuses the agent recipe without review.json', () => {
    const r = catalogCmd(root)
    expect(r.ok).toBe(false)
    expect(r.log.join('\n')).toMatch(/refused agents: agent-transcribed recipe without review.json/)
    expect(cat()).toEqual([{ id: 'fallback-one', title: 'To make', gateSha256: sha256(readFileSync(join(fb.dir, 'gate.json'))) }])
    const bundle = JSON.parse(readFileSync(join(fb.dir, 'recipe.json'), 'utf8'))
    expect(bundle.transcription).toMatchObject({ readers: ['fallback'], by: 'Test reader' })
    expect(bundle.notes.every((n: { checkAt: { source: string } }) => n.checkAt.source === 'step-entry')).toBe(true)
    for (const f of ['recipe.json', 'page.jpg', 'note-full-ripe.png', 'note-full-ripe.toi.png', 'note-full-ripe.json']) expect(existsSync(join(root, 'public/recipes/fallback-one', f)), f).toBe(true)
  })
  it('refuses an empty reviewedBy and a review of another gate; accepts a review of this gate, sorted by id', () => {
    review(gateSha(), '')
    expect(catalogCmd(root).log.join()).toMatch(/refused agents: review.json invalid: reviewedBy/)
    review('b'.repeat(64))
    expect(catalogCmd(root).log.join()).toMatch(/gateSha256 mismatch/)
    review(gateSha())
    const r = catalogCmd(root)
    expect(r.ok).toBe(true)
    expect(cat().map((c: { id: string }) => c.id)).toEqual(['agents', 'fallback-one'])
  })
  it('refuses a changed input, a changed output, a stale or failing gate, and removes the stale public files', () => {
    const sp = join(agents.dir, 'agent/second.json')
    const saved = readFileSync(sp, 'utf8')
    writeFileSync(sp, saved + ' ')
    const r1 = catalogCmd(root)
    expect(r1.log.join()).toMatch(/refused agents: input agent\/second.json changed/)
    expect(r1.log.join()).toMatch(/removed the stale public files of agents/)
    expect(existsSync(join(root, 'public/recipes/agents'))).toBe(false)
    writeFileSync(sp, saved)
    const np = join(agents.dir, 'notes/note-full-ripe.png')
    const png = readFileSync(np)
    const img = decodePng(png)
    img.data[3] = img.data[3]! ^ 1
    writeFileSync(np, encodePng(img))
    expect(catalogCmd(root).log.join()).toMatch(/output notes\/note-full-ripe.png changed/)
    writeFileSync(np, png)
    const gp = join(agents.dir, 'gate.json')
    const g = readFileSync(gp, 'utf8')
    writeFileSync(gp, g.replace('"propsVersion": "2"', '"propsVersion": "0"'))
    expect(catalogCmd(root).log.join()).toMatch(/propsVersion 0 is not the current 2/)
    writeFileSync(gp, g)
    writeFileSync(join(agents.dir, 'alignment.json'), '{}')
    expect(catalogCmd(root).log.join()).toMatch(/alignment.json exists but the gate did not read it/)
    rmSync(join(agents.dir, 'alignment.json'))
    expect(catalogCmd(root).ok).toBe(true)
  })
  it('refuses a failing gate', () => {
    const j = syntheticFolder({ root, id: 'joined', joined: true })
    gateCmd('joined', { root })
    expect(catalogCmd(root).log.join()).toMatch(/refused joined: gate state fail/)
    rmSync(j.dir, { recursive: true })
  })
})

describe('the only writer of content/catalog.json (R35.5)', () => {
  it('no other non-test source file names catalog.json', () => {
    const repo = new URL('../../', import.meta.url).pathname
    const hits: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx|mjs|js)$/.test(e) && !/\.test\.ts$/.test(e) && readFileSync(p, 'utf8').includes('catalog.json')) hits.push(p.slice(repo.length))
      }
    }
    for (const d of ['src', 'tools', 'scripts']) if (existsSync(join(repo, d))) walk(join(repo, d))
    // the app reads the catalog at build time (cook-mode design 2.1); it never writes it
    expect(hits).toEqual(['src/data/catalog.ts', 'tools/steam-ingest/catalog.ts'])
    expect(readFileSync(join(repo, 'src/data/catalog.ts'), 'utf8')).not.toMatch(/writeFile|writeJson|appendFile|fs\.|node:fs/)
  })
})
