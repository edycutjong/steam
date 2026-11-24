import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkCookable, createShelfLoader } from './catalog.ts'
import { RecipeBundle } from './schema.ts'

const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'))
const bundleText = readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')
const variant = (edit: (b: any) => void): string => { const b = JSON.parse(bundleText); edit(b); return JSON.stringify(b) } // eslint-disable-line @typescript-eslint/no-explicit-any
const serve = (body: string | (() => never), status = 200) => vi.fn(async () => {
  if (typeof body === 'function') body()
  return new Response(body as string, { status })
}) as unknown as typeof fetch

describe('loadShelf (R2.1 to R2.5, R2.7)', () => {
  it('yields the real recipe with three displayable notes and none withheld', async () => {
    const r = await createShelfLoader(serve(bundleText), catalog).load()
    expect(r.rejected).toEqual([])
    expect(r.recipes.length).toBe(1)
    expect(r.recipes[0]!.notes.map((n) => n.id)).toEqual(['full-ripe', 'when-tender', 'till-it-looks-red-smooth'])
    expect(r.recipes[0]!.withheld).toEqual([])
  })
  const bad: [string, () => typeof fetch, RegExp][] = [
    ['a deleted required field', () => serve(variant((b) => delete b.source.canvas)), /invalid/],
    ['a different gateSha256', () => serve(variant((b) => { b.gateSha256 = 'a'.repeat(64) })), /gateSha256/],
    ['a bundle id mismatch', () => serve(variant((b) => { b.id = 'other' })), /id/],
    ['a note on step 9', () => serve(variant((b) => { b.notes[0].step = 9 })), /step 9/],
    ['two notes on one step', () => serve(variant((b) => { b.notes[1].step = b.notes[0].step })), /share step/],
    ['a group on line 99', () => serve(variant((b) => { b.notes[0].groups[0].line = 99 })), /line 99/],
    ['a 404', () => serve('nope', 404), /404/],
    ['a network error', () => serve(() => { throw new Error('offline') }), /offline/],
  ]
  it.each(bad)('%s leaves the recipe out, with one warning naming the id and the reason', async (_n, mk, why) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await createShelfLoader(mk(), catalog).load()
    expect(r.recipes).toEqual([])
    expect(r.rejected).toEqual([{ id: 'quinces-marmalade', reason: expect.stringMatching(why) }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/quinces-marmalade/)
    warn.mockRestore()
  })
  it('an invalid catalog gives the error result', async () => {
    const r = await createShelfLoader(serve(bundleText), [{ id: 'Bad Id' }]).load()
    expect(r.error).toBeTruthy()
    expect(r.recipes).toEqual([])
  })
  it('a note with licence cc-by-nc leaves the recipe in and the note withheld', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const f = serve(variant((b) => { b.source.licence.id = 'cc-by-nc'; b.notes[0].provenance.licence.id = 'cc-by-nc' }))
    const r = await createShelfLoader(f, catalog).load()
    warn.mockRestore()
    expect(r.recipes.length).toBe(1)
    expect(r.recipes[0]!.notes).toEqual([])
    expect(r.recipes[0]!.withheld.length).toBe(3)
  })
  it('caches: one fetch per id', async () => {
    const f = serve(bundleText)
    const loader = createShelfLoader(f, catalog)
    await loader.load()
    await loader.load()
    expect(f).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledWith('/recipes/quinces-marmalade/recipe.json')
  })
  it('checkCookable accepts the real bundle', () => {
    expect(checkCookable(RecipeBundle.parse(JSON.parse(bundleText)), catalog[0])).toBeNull()
  })
})

describe('no recipe data in src (honesty: the app shows what the bundle says)', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : [p] })
  it('no non-test source file names the title or the id', () => {
    const files = walk('src').filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\.|\.fixture\.|\/ingest\//.test(f))
    for (const f of files) {
      const t = readFileSync(f, 'utf8')
      expect(t, f).not.toContain('Marmalade of Quinces')
      expect(t, f).not.toContain('quinces-marmalade')
    }
  })
})
