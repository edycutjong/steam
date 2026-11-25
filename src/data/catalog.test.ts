import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { checkCookable, createShelfLoader } from './catalog.ts'
import { RecipeBundle } from './schema.ts'
import { fakeTimers, settle } from './timers.fixture.ts'

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
    // a2a-arch-r05 B5: 'a network error' is now retried twice before it is reported, so the test passes an instant sleep (it used to fetch once)
    const r = await createShelfLoader(mk(), catalog, async () => {}).load()
    expect(r.recipes).toEqual([])
    // a2a-arch-r06 C1: only the network error ended on transport, and only it is marked as such
    expect(r.rejected).toEqual([{ id: 'quinces-marmalade', reason: expect.stringMatching(why), ...(/offline/.test(String(why)) ? { transient: true } : {}) }])
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
    expect(f).toHaveBeenCalledWith('/recipes/quinces-marmalade/recipe.json', { signal: expect.any(AbortSignal) }) // a2a-arch-r06 C2: the request carries the deadline's signal
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

// a2a-arch-r05 B5: a transient fetch failure must not hide the recipe for the whole visit.
describe('loadShelf retries transport failures (a2a-arch-r05 B5)', () => {
  type Sleep = (ms: number) => Promise<void>
  const withSleep = createShelfLoader
  const ok = () => new Response(bundleText, { status: 200 })
  /** A fetch that answers from a script, one entry per call; the last entry repeats. */
  const script = (...steps: (Response | Error | (() => Response))[]) => {
    let i = 0
    return vi.fn(async () => {
      const s = steps[Math.min(i++, steps.length - 1)]!
      if (s instanceof Error) throw s
      return typeof s === 'function' ? s() : s.clone()
    }) as unknown as typeof fetch
  }
  const sleeper = () => {
    const waits: number[] = []
    const fn: Sleep = async (ms) => void waits.push(ms)
    return { fn, waits }
  }
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('two network rejections then success: the recipe loads, after waits of 300 ms and 1000 ms', async () => {
    const w = quiet()
    const f = script(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), ok())
    const s = sleeper()
    const r = await withSleep(f, catalog, s.fn).load()
    w.mockRestore()
    expect(r.rejected).toEqual([])
    expect(r.recipes).toHaveLength(1)
    expect(f).toHaveBeenCalledTimes(3)
    expect(s.waits).toEqual([300, 1000])
  })
  it.each([408, 429, 500, 502, 503, 504])('HTTP %i is retried', async (status) => {
    const w = quiet()
    const f = script(new Response('', { status }), ok())
    const r = await withSleep(f, catalog, sleeper().fn).load()
    w.mockRestore()
    expect(r.recipes).toHaveLength(1)
    expect(f).toHaveBeenCalledTimes(2)
  })
  it('a load that still fails after the retries is reported, warned once, and not cached', async () => {
    const w = quiet()
    const f = script(new Response('', { status: 503 }))
    const loader = withSleep(f, catalog, sleeper().fn)
    const first = await loader.load()
    expect(first.recipes).toEqual([])
    expect(first.rejected).toEqual([{ id: 'quinces-marmalade', reason: expect.stringMatching(/503/), transient: true }]) // a2a-arch-r06 C1
    expect(f).toHaveBeenCalledTimes(3)
    expect(w).toHaveBeenCalledTimes(1)
    // the same loader fetches again on a later load(): the failure was not kept
    const h = script(new Response('', { status: 503 }), new Response('', { status: 503 }), new Response('', { status: 503 }), ok())
    const l2 = withSleep(h, catalog, sleeper().fn)
    expect((await l2.load()).recipes).toEqual([])
    expect((await l2.load()).recipes).toHaveLength(1)
    expect(h).toHaveBeenCalledTimes(4)
    w.mockRestore()
  })
  it('a network failure that stays is not cached either', async () => {
    const w = quiet()
    const f = script(new TypeError('offline'), new TypeError('offline'), new TypeError('offline'), ok())
    const loader = withSleep(f, catalog, sleeper().fn)
    expect((await loader.load()).rejected[0]!.reason).toMatch(/offline/)
    expect((await loader.load()).recipes).toHaveLength(1)
    w.mockRestore()
  })
  it('two callers at once share one load, retries included', async () => {
    const w = quiet()
    const f = script(new TypeError('x'), ok())
    const loader = withSleep(f, catalog, sleeper().fn)
    const [a, b] = await Promise.all([loader.load(), loader.load()])
    w.mockRestore()
    expect(a.recipes).toHaveLength(1)
    expect(b.recipes).toHaveLength(1)
    expect(f).toHaveBeenCalledTimes(2)
  })
  const terminal: [string, () => typeof fetch, RegExp][] = [
    ['HTTP 404', () => script(new Response('', { status: 404 })), /404/],
    ['HTTP 403', () => script(new Response('', { status: 403 })), /403/],
    ['invalid JSON', () => script(new Response('{not json', { status: 200 })), /./],
    ['a schema failure', () => script(new Response(variant((b) => delete b.source.canvas), { status: 200 })), /invalid/],
    ['a bundle that fails checkCookable', () => script(new Response(variant((b) => { b.notes[0].step = 9 }), { status: 200 })), /step 9/],
  ]
  it.each(terminal)('%s is terminal: one fetch, no wait, cached', async (_n, mk, why) => {
    const w = quiet()
    const f = mk()
    const s = sleeper()
    const loader = withSleep(f, catalog, s.fn)
    const r = await loader.load()
    await loader.load()
    w.mockRestore()
    expect(r.rejected).toEqual([{ id: 'quinces-marmalade', reason: expect.stringMatching(why) }])
    expect(f).toHaveBeenCalledTimes(1)
    expect(s.waits).toEqual([])
  })
  it('a provenance withholding is terminal and the recipe stays in, cached', async () => {
    const w = quiet()
    const f = script(new Response(variant((b) => { b.source.licence.id = 'cc-by-nc'; b.notes[0].provenance.licence.id = 'cc-by-nc' }), { status: 200 }))
    const s = sleeper()
    const loader = withSleep(f, catalog, s.fn)
    const r = await loader.load()
    await loader.load()
    w.mockRestore()
    expect(r.recipes[0]!.withheld.length).toBe(3)
    expect(f).toHaveBeenCalledTimes(1)
    expect(s.waits).toEqual([])
  })
})

// a2a-arch-r06 C1: a rejection that ended on transport says so, so a screen can offer a retry; a final one does not.
describe('a rejection that ended on transport is marked (a2a-arch-r06 C1)', () => {
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
  const flag = (r: { rejected: object[] }) => (r.rejected[0] as { transient?: boolean }).transient
  it('a network rejection that stays, and a 5xx that stays, are transient', async () => {
    const w = quiet()
    const a = await createShelfLoader(vi.fn(async () => { throw new TypeError('offline') }) as unknown as typeof fetch, catalog, async () => {}).load()
    const b = await createShelfLoader(vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch, catalog, async () => {}).load()
    w.mockRestore()
    expect(flag(a)).toBe(true)
    expect(flag(b)).toBe(true)
  })
  it.each([
    ['HTTP 404', () => new Response('', { status: 404 })],
    ['invalid JSON', () => new Response('{not json')],
    ['a schema failure', () => new Response(variant((b) => delete b.source.canvas))],
    ['a bundle that fails checkCookable', () => new Response(variant((b) => { b.notes[0].step = 9 }))],
  ])('%s is final and carries no transient mark', async (_n, mk) => {
    const w = quiet()
    const r = await createShelfLoader(vi.fn(async () => mk()) as unknown as typeof fetch, catalog, async () => {}).load()
    w.mockRestore()
    expect(r.rejected).toHaveLength(1)
    expect('transient' in r.rejected[0]!).toBe(false)
  })
  it('a recipe that loaded on the retry has no rejection at all', async () => {
    const w = quiet()
    let n = 0
    const f = vi.fn(async () => (n++ < 1 ? Promise.reject(new TypeError('x')) : new Response(bundleText))) as unknown as typeof fetch
    const r = await createShelfLoader(f, catalog, async () => {}).load()
    w.mockRestore()
    expect(r.rejected).toEqual([])
  })
})

// a2a-arch-r06 C2: a recipe request that hangs ends as a transport failure, so B5's retry runs.
describe('a recipe request that hangs (a2a-arch-r06 C2)', () => {
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
  const hang = (signals: AbortSignal[] = []) => vi.fn((_u: string, init?: RequestInit) => (signals.push(init!.signal!), new Promise<Response>(() => {}))) as unknown as typeof fetch
  it('aborts after 10 s, retries on the B5 waits, and ends as a transient rejection after three attempts', async () => {
    const w = quiet()
    const t = fakeTimers()
    const signals: AbortSignal[] = []
    const f = hang(signals)
    const waits: number[] = []
    const p = createShelfLoader(f, catalog, async (ms) => void waits.push(ms), t).load()
    for (let i = 0; i < 3; i++) {
      await settle()
      expect(signals).toHaveLength(i + 1)
      t.advance(9999)
      await settle()
      expect(signals[i]!.aborted).toBe(false)
      t.advance(1)
    }
    const r = await p
    w.mockRestore()
    expect(f).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([300, 1000])
    expect(signals.every((s) => s.aborted)).toBe(true)
    expect(r.recipes).toEqual([])
    expect(r.rejected).toEqual([{ id: 'quinces-marmalade', reason: expect.stringMatching(/no answer within 10 s/), transient: true }])
    expect(t.pending).toBe(0)
  })
  it('a body that never arrives is covered too; the next attempt then loads the recipe', async () => {
    const w = quiet()
    const t = fakeTimers()
    let n = 0
    const f = vi.fn(async () => (n++ === 0 ? ({ ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response) : new Response(bundleText))) as unknown as typeof fetch
    const p = createShelfLoader(f, catalog, async () => {}, t).load()
    await settle()
    t.advance(10_000)
    const r = await p
    w.mockRestore()
    expect(f).toHaveBeenCalledTimes(2)
    expect(r.rejected).toEqual([])
    expect(r.recipes).toHaveLength(1)
    expect(t.pending).toBe(0)
  })
  it('a hung load is not cached: the next load() asks again', async () => {
    const w = quiet()
    const t = fakeTimers()
    let calls = 0
    const f = vi.fn((): Promise<Response> => (++calls <= 3 ? new Promise(() => {}) : Promise.resolve(new Response(bundleText)))) as unknown as typeof fetch
    const loader = createShelfLoader(f, catalog, async () => {}, t)
    const p = loader.load()
    for (let i = 0; i < 3; i++) {
      await settle()
      t.advance(10_000)
    }
    expect((await p).rejected[0]!.transient).toBe(true)
    expect((await loader.load()).recipes).toHaveLength(1)
    w.mockRestore()
  })
  it('an answer inside the deadline is untouched and leaves no timer behind', async () => {
    const t = fakeTimers()
    const r = await createShelfLoader(vi.fn(async () => new Response(bundleText)) as unknown as typeof fetch, catalog, async () => {}, t).load()
    expect(r.recipes).toHaveLength(1)
    expect(t.pending).toBe(0)
  })
})
