import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { KNOWN, catalogueUrl, fetchRecipe, fixtureGet, writeFetched, type Get } from './fetch.ts'

const root = new URL('../../', import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), 'steam-fetch-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const target = KNOWN['quinces-marmalade']!
const work = JSON.parse(readFileSync(join(root, 'fixtures/wellcome-work-zgtk6n7e.json'), 'utf8'))

/** Serves the recorded responses and fails the test on any other URL (including any canvas but index 32, image _0033.JP2). */
function guarded(override?: (url: string) => Promise<{ status: number; body: Uint8Array } | undefined>): { get: Get; seen: string[] } {
  const base = fixtureGet(root)
  const seen: string[] = []
  return {
    seen,
    get: async (url) => {
      seen.push(url)
      if (!/zgtk6n7e|b18419665$|b18419665_MS_1810_0033\.JP2\/full\/1600,\/0\/default\.jpg$/.test(url)) throw new Error(`test: unexpected request ${url}`)
      return (await override?.(url)) ?? base(url)
    },
  }
}

describe('fetch', () => {
  it('writes source.json with every field from the record, the manifest or the command line', async () => {
    const g = guarded()
    const r = await fetchRecipe(target, g.get, '2026-11-25')
    expect(r.source).toEqual({
      institution: 'Wellcome Collection',
      shelfmark: 'MS.1810',
      workUrl: 'https://wellcomecollection.org/works/zgtk6n7e',
      manifest: 'https://iiif.wellcomecollection.org/presentation/v2/b18419665',
      canvasIndex: 32,
      imageService: 'https://iiif.wellcomecollection.org/image/b18419665_MS_1810_0033.JP2',
      page: 'p.23',
      date: 'c. 1750 (IIIF manifest)',
      licence: { id: 'pdm', label: 'Public Domain Mark', url: 'https://creativecommons.org/share-your-work/public-domain/pdm/' },
      credit: 'Wellcome Collection',
      retrieved: '2026-11-25',
    })
    expect(r.size).toEqual({ width: 1601, height: 2052 })
    expect(g.seen[0]).toBe(catalogueUrl('zgtk6n7e'))
    writeFetched(join(dir, 'ok'), r)
    expect(readFileSync(join(dir, 'ok', 'page.jpg')).equals(readFileSync(join(root, 'fixtures/p0033.jpg')))).toBe(true)
  })
  it('refuses a licence outside the allow-list before any image or manifest request and writes nothing', async () => {
    const bad = structuredClone(work)
    bad.items[1].locations[0].license.id = 'in-copyright'
    const g = guarded(async (url) => (url.includes('catalogue') ? { status: 200, body: new TextEncoder().encode(JSON.stringify(bad)) } : undefined))
    await expect(fetchRecipe(target, g.get, 'x')).rejects.toThrow(/licence refused: licence in-copyright/)
    expect(g.seen.length).toBe(1)
  })
  it('fails closed on a catalogue error or a non-JSON body', async () => {
    const e = guarded(async (url) => (url.includes('catalogue') ? { status: 503, body: new Uint8Array() } : undefined))
    await expect(fetchRecipe(target, e.get, 'x')).rejects.toThrow(/HTTP 503/)
    const t = guarded(async (url) => (url.includes('catalogue') ? { status: 200, body: new TextEncoder().encode('<html>') } : undefined))
    await expect(fetchRecipe(target, t.get, 'x')).rejects.toThrow(/not JSON/)
  })
  it('an image failure leaves the existing page.jpg and source.json untouched', async () => {
    const d = join(dir, 'keep')
    writeFetched(d, await fetchRecipe(target, guarded().get, '2026-11-24'))
    const before = readFileSync(join(d, 'source.json'), 'utf8')
    const g = guarded(async (url) => (url.endsWith('default.jpg') ? { status: 404, body: new Uint8Array() } : undefined))
    await expect(fetchRecipe(target, g.get, '2026-11-25').then((r) => writeFetched(d, r))).rejects.toThrow(/image request: HTTP 404/)
    expect(readFileSync(join(d, 'source.json'), 'utf8')).toBe(before)
    expect(existsSync(join(d, '.page.jpg.tmp'))).toBe(false)
  })
  it('never fetches the held-out canvas', async () => {
    for (const canvasIndex of [26, 27]) await expect(fetchRecipe({ ...target, canvasIndex }, guarded().get, 'x')).rejects.toThrow(/held-out/)
  })
  it('--from-fixture uses no network: the fixture get refuses any other URL', async () => {
    const g = fixtureGet(root)
    await expect(g('https://example.org/x')).rejects.toThrow(/no recorded response/)
  })
})
