import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { afterEach, vi } from 'vitest'
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
