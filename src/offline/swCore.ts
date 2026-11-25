// The service worker's logic with its environment injected, so that unit tests drive it without a browser (offline-shell, design.md).
import { CACHE_PREFIX } from './precache.ts'

export interface CacheLike {
  addAll(requests: Request[]): Promise<void>
  match(request: Request | string, options?: { ignoreSearch?: boolean }): Promise<Response | undefined>
}
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
}

/** What the worker reads of a request: a real `Request` fits it (and so does a plain object, since a test cannot build a navigation Request). */
export interface ReqLike {
  method: string
  url: string
  mode: string
}

export interface SwDeps {
  cacheName: string
  /** URLs the install step stores. */
  urls: readonly string[]
  caches: CacheStorageLike
  fetchFn: (r: ReqLike) => Promise<Response>
  /** The worker's own origin: only requests to it are answered from the cache. */
  origin: string
}

export interface Shell {
  /** Stores every URL, bypassing the HTTP cache. Rejects when one fails: the old worker then stays in charge. */
  install(): Promise<void>
  /** Deletes every cache of this app that is not the current one. Returns the names it deleted. */
  activate(): Promise<string[]>
  /** The response for a request, or null when the worker leaves the request to the network (cross-origin, not GET). */
  respond(req: ReqLike): Promise<Response> | null
}

export function createShell(d: SwDeps): Shell {
  const known = new Set(d.urls)
  return {
    async install() {
      const cache = await d.caches.open(d.cacheName)
      await cache.addAll(d.urls.map((u) => new Request(new URL(u, d.origin).href, { cache: 'reload' })))
    },
    async activate() {
      const gone = (await d.caches.keys()).filter((k) => k.startsWith(CACHE_PREFIX) && k !== d.cacheName)
      await Promise.all(gone.map((k) => d.caches.delete(k)))
      return gone
    },
    respond(req) {
      if (req.method !== 'GET') return null
      const url = new URL(req.url)
      // The IIIF "verify at source" images and every other foreign origin need the network: they are never stored, never faked.
      if (url.origin !== d.origin) return null
      return (async () => {
        const cache = await d.caches.open(d.cacheName)
        // A navigation is always the single-page app: the hash router decides the screen, so `/` and any other path serve index.html.
        const key = req.mode === 'navigate' ? '/index.html' : known.has(url.pathname) ? url.pathname : null
        if (key !== null) {
          const hit = await cache.match(new URL(key, d.origin).href)
          if (hit) return hit
        }
        return d.fetchFn(req)
      })()
    },
  }
}
