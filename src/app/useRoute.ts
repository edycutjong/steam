import { useSyncExternalStore } from 'react'
import { parseRoute, type Route } from './router.ts'

let cache: { hash: string; route: Route } | null = null

function snapshot(): Route {
  const hash = typeof location === 'undefined' ? '' : location.hash
  if (cache?.hash !== hash) cache = { hash, route: parseRoute(hash) }
  return cache.route
}
const serverSnapshot = (): Route => parseRoute('')

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** The current route, re-read on hashchange (R1.6: back and forward work on every route). */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot)
}
