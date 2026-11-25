import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { afterEach, vi } from 'vitest'
import { fakeTimers, settle } from '../data/timers.fixture.ts'
import { AssetError, loadNoteAssets, NoteMeta } from './assets.ts'

const real = JSON.parse(
  readFileSync(new URL('../../public/recipes/quinces-marmalade/note-till-it-looks-red-smooth.json', import.meta.url), 'utf8'),
)

const good = () => structuredClone(real) as Record<string, any>

function failPath(input: unknown): string {
  const r = NoteMeta.safeParse(input)
  expect(r.success).toBe(false)
  return r.success ? '' : r.error.issues.map((i) => i.path.join('.')).join('|')
}

describe('NoteMeta', () => {
  it('rejects a file with text and no shownText', () => {
    const m = good()
    m.text = m.shownText
    delete m.shownText
    expect(failPath(m)).toContain('shownText')
  })
  it('accepts the bundle\'s hero note file, reads shownText and strips the extra keys', () => {
    const r = NoteMeta.safeParse(real)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.shownText).toBe('till it Looks red & smooth,')
      expect(r.data.groups).toHaveLength(2)
      expect(r.data.groups.map((g) => g.rect)).toEqual([[793, 32, 1218, 103], [32, 84, 496, 154]])
      for (const k of ['words', 'alignment', 'trace', 'span', 'verifyUrl']) expect(k in r.data || k in r.data.groups[0]!).toBe(false)
    }
  })
  it('rejects missing groups', () => {
    const m = good()
    delete m.groups
    expect(failPath(m)).toContain('groups')
  })
  it('rejects empty groups', () => {
    const m = good()
    m.groups = []
    expect(failPath(m)).toContain('groups')
  })
  it('rejects a wrong size type', () => {
    const m = good()
    m.size = ['1250', 186]
    expect(failPath(m)).toContain('size')
  })
  it('rejects a rect outside size', () => {
    const m = good()
    m.groups[0].rect = [781, 32, 1300, 103]
    expect(failPath(m)).toBe('groups.0.rect')
  })
  it('rejects a coreBand outside the rect', () => {
    const m = good()
    m.groups[1].coreBand = [109, 160]
    expect(failPath(m)).toBe('groups.1.coreBand')
  })
  it('rejects a reversed t', () => {
    const m = good()
    m.groups[0].t = [0.6, 0.4]
    expect(failPath(m)).toContain('groups.0.t')
  })
  it('rejects t above 1', () => {
    const m = good()
    m.groups[1].t = [0.47, 1.2]
    expect(failPath(m)).toContain('groups.1.t')
  })
  it('rejects overlapping group ranges', () => {
    const m = good()
    m.groups[1].t = [0.3, 1]
    expect(failPath(m)).toBe('groups.1.t')
  })
})


describe('loadNoteAssets checks the bundle (R15.3)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const serve = (json: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })))
  it('throws AssetError when the JSON noteId differs from the bundle\'s', async () => {
    serve(real)
    await expect(loadNoteAssets('/x/note-a', { noteId: 'another', size: real.size })).rejects.toMatchObject({ name: 'AssetError', field: 'meta.noteId' })
  })
  it('throws AssetError when the JSON size differs from the bundle\'s', async () => {
    serve(real)
    const e = await loadNoteAssets('/x/note-a', { noteId: real.noteId, size: [real.size[0] + 1, real.size[1]] }).catch((x) => x)
    expect(e).toBeInstanceOf(AssetError)
    expect(e.field).toBe('meta.size')
  })
})

// a2a-arch-r06 C2: a note asset that hangs ends as an AssetError for its field, so the failed-pane path (R15.12) runs.
describe('loadNoteAssets deadlines (a2a-arch-r06 C2)', () => {
  afterEach(() => vi.unstubAllGlobals())
  const metaBody = () => new Response(JSON.stringify(real), { status: 200 })
  const stub = (impl: (url: string, init?: RequestInit) => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl))

  it('a note image that does not answer in 15 s is an AssetError for field "note"', async () => {
    const t = fakeTimers()
    const signals: AbortSignal[] = []
    stub(async (url, init) => (url.endsWith('.json') ? metaBody() : (signals.push(init!.signal!), new Promise<Response>(() => {}))))
    const p = loadNoteAssets('/x/note-a', undefined, undefined, { timers: t })
    const seen = p.then(() => null, (e: unknown) => e)
    await settle()
    t.advance(14_999)
    await settle()
    expect(signals.every((s) => !s.aborted)).toBe(true)
    t.advance(1)
    const e = (await seen) as AssetError
    expect(e).toBeInstanceOf(AssetError)
    expect(e.field).toBe('note')
    expect(e.message).toMatch(/no answer within 15 s/)
    expect(signals.length).toBe(2)
    expect(signals.every((s) => s.aborted)).toBe(true)
  })
  it('a meta JSON that does not answer is an AssetError for field "meta"', async () => {
    const t = fakeTimers()
    stub(() => new Promise<Response>(() => {}))
    const seen = loadNoteAssets('/x/note-a', undefined, undefined, { timers: t }).then(() => null, (e: unknown) => e)
    await settle()
    t.advance(15_000)
    const e = (await seen) as AssetError
    expect(e).toBeInstanceOf(AssetError)
    expect(e.field).toBe('meta')
  })
  it('a body that never arrives counts as no answer', async () => {
    const t = fakeTimers()
    stub(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) as unknown as Response)
    const seen = loadNoteAssets('/x/note-a', undefined, undefined, { timers: t }).then(() => null, (e: unknown) => e)
    await settle()
    t.advance(15_000)
    const e = (await seen) as AssetError
    expect(e).toBeInstanceOf(AssetError)
    expect(e.field).toBe('meta')
  })
  it('an abort the caller asked for is re-thrown as an abort, not an AssetError, and leaves no timer', async () => {
    const t = fakeTimers()
    const ctl = new AbortController()
    stub((_u, init) => new Promise<Response>((_r, rej) => init!.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
    const seen = loadNoteAssets('/x/note-a', undefined, ctl.signal, { timers: t }).then(() => null, (e: unknown) => e)
    await settle()
    ctl.abort()
    const e = (await seen) as Error
    expect(e).not.toBeInstanceOf(AssetError)
    expect(e.name).toBe('AbortError')
    expect(t.pending).toBe(0)
  })
  it('a failure that is not a timeout keeps its message: could not fetch', async () => {
    const t = fakeTimers()
    stub(async () => Promise.reject(new TypeError('offline')))
    const e = (await loadNoteAssets('/x/note-a', undefined, undefined, { timers: t }).catch((x: unknown) => x)) as AssetError
    expect(e).toBeInstanceOf(AssetError)
    expect(e.message).toMatch(/could not fetch \/x\/note-a\.json/)
    expect(t.pending).toBe(0)
  })
})
