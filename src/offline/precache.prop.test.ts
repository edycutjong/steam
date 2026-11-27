import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildPrecacheList, cacheNameFor, CACHE_PREFIX, isSitePath, recipeJsonUrl, SITE_PREFIXES, SW_FILE, urlOf } from './precache.ts'

const seg = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,7}$/)
const id = seg
const file = fc.tuple(fc.array(seg, { maxLength: 3 }), fc.constantFrom('js', 'css', 'webp', 'png', 'json', 'woff', 'jpg', 'map')).map(([d, e]) => [...d, `f.${e}`].join('/'))
/** A generated dist/: random files, index.html, the recipe.json of every listed recipe, and sometimes a worker and maps. */
const dist = fc
  .tuple(fc.array(file, { maxLength: 25 }), fc.uniqueArray(id, { maxLength: 4 }), fc.boolean())
  .map(([files, ids, withSw]) => ({ ids, files: [...new Set([...files, 'index.html', ...ids.map((i) => recipeJsonUrl(i).slice(1)), ...(withSw ? [SW_FILE, 'assets/x.js.map'] : [])])] }))

describe('buildPrecacheList', () => {
  // The pages beside the app (landing, deck, their shared files) are never stored, wherever they sit in a generated dist/
  it('stores nothing under /landing/, /deck/, /judge/ or /site/', () => {
    const sitePage = fc.tuple(fc.constantFrom(...SITE_PREFIXES), file).map(([pre, f]) => pre.slice(1) + f)
    fc.assert(
      fc.property(dist, fc.array(sitePage, { maxLength: 6 }), ({ files, ids }, site) => {
        const list = buildPrecacheList([...files, ...site, 'landing/index.html', 'deck/index.html', 'judge/index.html'], ids)
        expect(list.filter(isSitePath)).toEqual([])
        expect(list).toEqual(buildPrecacheList(files, ids))
      }),
    )
  })
  // O1: every URL in the list is a file of dist (or "/", which is served from index.html)
  it('O1: every URL in the list exists in dist', () => {
    fc.assert(
      fc.property(dist, ({ files, ids }) => {
        const have = new Set(files.map(urlOf))
        for (const u of buildPrecacheList(files, ids)) expect(u === '/' ? have.has('/index.html') : have.has(u), u).toBe(true)
      }),
    )
  })
  // O2: the list holds the recipe.json of every recipe the shelf lists
  it('O2: the list contains every recipe JSON the shelf lists', () => {
    fc.assert(
      fc.property(dist, ({ files, ids }) => {
        const list = new Set(buildPrecacheList(files, ids))
        for (const i of ids) expect(list.has(recipeJsonUrl(i)), i).toBe(true)
      }),
    )
  })
  it('O2: a listed recipe whose recipe.json is not in dist fails the build', () => {
    fc.assert(
      fc.property(dist, id, ({ files, ids }, extra) => {
        fc.pre(!ids.includes(extra))
        expect(() => buildPrecacheList(files, [...ids, extra])).toThrow(extra)
      }),
    )
  })
  it('never lists the worker or a source map; sorted, no duplicates; always "/"', () => {
    fc.assert(
      fc.property(dist, ({ files, ids }) => {
        const list = buildPrecacheList(files, ids)
        expect(list).not.toContain('/' + SW_FILE)
        expect(list.filter((u) => u.endsWith('.map'))).toEqual([])
        expect(list).toEqual([...new Set(list)].sort())
        expect(list).toContain('/')
      }),
    )
  })
  it('a dist without index.html cannot be an offline shell', () => {
    expect(() => buildPrecacheList(['assets/a.js'], [])).toThrow('index.html')
  })
  it('normalises separators and a leading "./"', () => {
    expect(buildPrecacheList(['index.html', '.\\recipes\\q\\recipe.json', './assets/a.js'], ['q'])).toEqual(['/', '/assets/a.js', '/index.html', '/recipes/q/recipe.json'])
  })
})

describe('cacheNameFor', () => {
  const h = (s: string): string => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0') + 'abcdef0123456789'
  const entries = fc.uniqueArray(fc.record({ url: file.map((f) => '/' + f), hash: fc.stringMatching(/^[0-9a-f]{4,8}$/) }), { selector: (e) => e.url, minLength: 1, maxLength: 8 })
  it('depends on every url and hash, not on their order; always carries the prefix', () => {
    fc.assert(
      fc.property(entries, (es) => {
        const n = cacheNameFor(es, h)
        expect(n.startsWith(CACHE_PREFIX)).toBe(true)
        expect(cacheNameFor([...es].reverse(), h)).toBe(n)
        expect(cacheNameFor(es.map((e, i) => (i === 0 ? { ...e, hash: e.hash + 'x' } : e)), h)).not.toBe(n)
      }),
    )
  })
})
