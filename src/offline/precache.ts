// The precache list of the offline shell, built at BUILD time from the real files of dist/ (offline-shell, design.md).
// Pure: it takes the dist-relative file names and the recipe ids the shelf lists, and returns the URLs the service worker stores.

/** The service worker itself is never in its own list: the browser fetches it, with no-cache (vercel.json). */
export const SW_FILE = 'sw.js'

/** Name of the cache. One per build: the prefix says whose it is, so `activate` deletes only its own old ones. */
export const CACHE_PREFIX = 'steam-shell-'

const isMap = (f: string): boolean => f.endsWith('.map')

/**
 * The pages served beside the app: the landing page, the pitch deck and the files they share (landing-deck, autopilot P4).
 * They are not the app: the shell never stores them and never answers a request for them, so a visitor who has opened the app
 * still gets the real page at /landing/ and /deck/, not the cached index.html.
 */
export const SITE_PREFIXES = ['/landing/', '/deck/', '/site/'] as const

/** True for `/landing`, `/landing/` and anything under it (same for /deck and /site). */
export const isSitePath = (pathname: string): boolean => SITE_PREFIXES.some((p) => pathname === p.slice(0, -1) || pathname.startsWith(p))

/** `assets/a.js` -> `/assets/a.js`; Windows separators and a leading `./` are normalised. */
export const urlOf = (file: string): string => '/' + file.replace(/\\/g, '/').replace(/^\.?\/+/, '')

/** The recipe file the shelf fetches for an id (src/data/catalog.ts). */
export const recipeJsonUrl = (id: string): string => `/recipes/${id}/recipe.json`

/**
 * Every file of dist/ except the worker, source maps and the pages beside the app (SITE_PREFIXES), as a URL, sorted and without duplicates, plus `/` (the navigation
 * target, served from the cached index.html). Throws when a recipe the shelf lists has no recipe.json in dist: the build must
 * not ship an offline shell that cannot open its own shelf (property O2).
 */
export function buildPrecacheList(distFiles: readonly string[], recipeIds: readonly string[]): string[] {
  const urls = new Set<string>()
  for (const f of distFiles) {
    const u = urlOf(f)
    if (u === '/' + SW_FILE || isMap(u) || isSitePath(u)) continue
    urls.add(u)
  }
  if (!urls.has('/index.html')) throw new Error('offline-shell: dist/ has no index.html')
  for (const id of recipeIds) {
    if (!urls.has(recipeJsonUrl(id))) throw new Error(`offline-shell: the shelf lists ${id} but dist/ has no ${recipeJsonUrl(id)}`)
  }
  urls.add('/')
  return [...urls].sort()
}

/** The cache name of one build: a short hash over every URL and the hash of its bytes, so any change to any file renames it. */
export function cacheNameFor(entries: readonly { url: string; hash: string }[], hashText: (s: string) => string): string {
  const body = [...entries].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)).map((e) => `${e.url}\0${e.hash}`).join('\n')
  return CACHE_PREFIX + hashText(body).slice(0, 12)
}
