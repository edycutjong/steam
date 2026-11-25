// The service worker entry, bundled to dist/sw.js at build time (tools/offline/vite-plugin.ts), which defines the two constants.
import { createShell } from './swCore.ts'

declare const __PRECACHE__: string[]
declare const __CACHE_NAME__: string

interface Ev {
  waitUntil(p: Promise<unknown>): void
}
interface FetchEv extends Ev {
  request: Request
  respondWith(r: Promise<Response>): void
}
interface Scope {
  location: { origin: string }
  caches: CacheStorage
  skipWaiting(): Promise<void>
  clients: { claim(): Promise<void> }
  addEventListener(type: 'install' | 'activate', cb: (e: Ev) => void): void
  addEventListener(type: 'fetch', cb: (e: FetchEv) => void): void
}
const sw = self as unknown as Scope

const shell = createShell({
  cacheName: __CACHE_NAME__,
  urls: __PRECACHE__,
  caches: sw.caches as never,
  fetchFn: (r) => fetch(r as Request),
  origin: sw.location.origin,
})

// A new build takes over at once: its cache is complete (install is all-or-nothing), the old one is deleted on activate.
sw.addEventListener('install', (e) => e.waitUntil(shell.install().then(() => sw.skipWaiting())))
sw.addEventListener('activate', (e) => e.waitUntil(shell.activate().then(() => sw.clients.claim())))
sw.addEventListener('fetch', (e) => {
  const r = shell.respond(e.request)
  if (r) e.respondWith(r)
})
