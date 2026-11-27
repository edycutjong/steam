import { describe, expect, it, vi } from 'vitest'
import { CACHE_PREFIX } from './precache.ts'
import { createShell, type CacheLike, type CacheStorageLike } from './swCore.ts'

const ORIGIN = 'https://steam.test'

/** An in-memory CacheStorage. */
function fakeCaches(initial: string[] = []) {
  const store = new Map<string, Map<string, Response>>(initial.map((n) => [n, new Map()]))
  const added: Request[] = []
  const open = async (name: string): Promise<CacheLike> => {
    if (!store.has(name)) store.set(name, new Map())
    const m = store.get(name)!
    return {
      async addAll(rs) {
        for (const r of rs) {
          added.push(r)
          m.set(new URL(r.url).pathname, new Response(`body of ${new URL(r.url).pathname}`))
        }
      },
      async match(r) {
        const u = new URL(typeof r === 'string' ? r : r.url)
        return m.get(u.pathname)?.clone()
      },
    }
  }
  const caches: CacheStorageLike = { open, keys: async () => [...store.keys()], delete: async (n) => store.delete(n) }
  return { caches, store, added }
}

const URLS = ['/', '/index.html', '/assets/a.js', '/recipes/q/recipe.json']
const make = (initial: string[] = [], fetchFn = vi.fn(async () => new Response('network'))) => {
  const f = fakeCaches(initial)
  return { ...f, fetchFn, shell: createShell({ cacheName: CACHE_PREFIX + 'new', urls: URLS, caches: f.caches, fetchFn, origin: ORIGIN }) }
}
const req = (path: string, init: { method?: string; mode?: string; body?: string } = {}) => ({ method: init.method ?? 'GET', mode: init.mode ?? 'no-cors', url: new URL(path, ORIGIN).href })

describe('install', () => {
  it('stores every URL of the list in this build\'s cache, bypassing the HTTP cache', async () => {
    const t = make()
    await t.shell.install()
    expect([...t.store.keys()]).toEqual([CACHE_PREFIX + 'new'])
    expect(t.added.map((r) => new URL(r.url).pathname)).toEqual(URLS)
    expect(t.added.every((r) => r.cache === 'reload')).toBe(true)
  })
})

describe('activate', () => {
  it('deletes every older cache of this app and keeps the current one', async () => {
    const t = make([CACHE_PREFIX + 'old1', CACHE_PREFIX + 'old2', CACHE_PREFIX + 'new'])
    const gone = await t.shell.activate()
    expect(gone.sort()).toEqual([CACHE_PREFIX + 'old1', CACHE_PREFIX + 'old2'])
    expect([...t.store.keys()]).toEqual([CACHE_PREFIX + 'new'])
  })
  it('never touches a cache that is not its own', async () => {
    const t = make(['other-app-v1', 'workbox-precache', CACHE_PREFIX + 'old'])
    await t.shell.activate()
    expect([...t.store.keys()].sort()).toEqual(['other-app-v1', 'workbox-precache'])
  })
  it('with nothing old it deletes nothing', async () => {
    const t = make([CACHE_PREFIX + 'new'])
    expect(await t.shell.activate()).toEqual([])
  })
})

describe('respond', () => {
  it('answers a stored URL from the cache without the network', async () => {
    const t = make()
    await t.shell.install()
    const r = await t.shell.respond(req('/assets/a.js'))!
    expect(await r.text()).toBe('body of /assets/a.js')
    expect(t.fetchFn).not.toHaveBeenCalled()
  })
  it('answers a navigation to any path with the cached index.html', async () => {
    const t = make()
    await t.shell.install()
    for (const p of ['/', '/r/quinces-marmalade/cook', '/anything']) {
      const r = await t.shell.respond(req(p, { mode: 'navigate' }))!
      expect(await r.text(), p).toBe('body of /index.html')
    }
    expect(t.fetchFn).not.toHaveBeenCalled()
  })
  it('leaves a foreign origin (the IIIF server) and non-GET requests to the network: null, nothing stored', () => {
    const t = make()
    expect(t.shell.respond({ method: 'GET', mode: 'no-cors', url: 'https://iiif.wellcomecollection.org/image/x/full/0/default.jpg' })).toBeNull()
    expect(t.shell.respond(req('/assets/a.js', { method: 'POST', body: 'x' }))).toBeNull()
    expect(t.store.size).toBe(0)
  })
  it('leaves the landing page, the deck, the judge page and their files to the browser: null for navigations and files, even after install', async () => {
    const t = make()
    await t.shell.install()
    for (const p of ['/landing/', '/landing', '/deck/', '/deck', '/deck/index.html', '/judge/', '/judge', '/judge/index.html', '/site/glass.js', '/site/media/a.webp']) {
      expect(t.shell.respond(req(p, { mode: 'navigate' })), p).toBeNull()
      expect(t.shell.respond(req(p)), p).toBeNull()
    }
    expect(t.fetchFn).not.toHaveBeenCalled()
  })
  it('a path that only starts like a site page is still the app', async () => {
    const t = make()
    await t.shell.install()
    for (const p of ['/landings', '/decked/x', '/judges', '/sites']) expect(await (await t.shell.respond(req(p, { mode: 'navigate' }))!).text(), p).toBe('body of /index.html')
  })
  it('a same-origin URL that is not in the list goes to the network and is not stored', async () => {
    const t = make()
    await t.shell.install()
    const r = await t.shell.respond(req('/unlisted.png'))!
    expect(await r.text()).toBe('network')
    expect(t.store.get(CACHE_PREFIX + 'new')!.has('/unlisted.png')).toBe(false)
  })
  it('before install finished a listed URL falls back to the network', async () => {
    const t = make()
    expect(await (await t.shell.respond(req('/assets/a.js'))!).text()).toBe('network')
  })
  it('offline and not stored: the network error reaches the page, it is not turned into a fake answer', async () => {
    const t = make([], vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(t.shell.respond(req('/unlisted.png'))!).rejects.toThrow('Failed to fetch')
  })
})
