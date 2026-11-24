// The hash router: five routes, parsed and formatted by pure functions (R1). `location.search` is never read here.

export type Pace = 1 | 4 | 12

export type Route =
  | { name: 'shelf' }
  | { name: 'edition'; id: string }
  | { name: 'cook'; id: string; pace: Pace; note: string | null; lead: number | null; fps: boolean }
  | { name: 'quoted'; id: string }
  | { name: 'pane'; id: string; noteId: string; query: string }
  | { name: 'notFound' }

/** Longest deep-link lead-in a URL may ask for, in seconds. A UI limit, not a cooking time. */
export const LEAD_MAX_S = 120

const ID = /^[a-z0-9][a-z0-9-]*$/

/** The value of a query key that appears exactly once; undefined when absent or repeated. */
function once(q: URLSearchParams, key: string): string | undefined {
  const all = q.getAll(key)
  return all.length === 1 ? all[0] : undefined
}

function cookQuery(query: string): { pace: Pace; note: string | null; lead: number | null; fps: boolean } {
  const q = new URLSearchParams(query)
  const p = once(q, 'pace')
  const pace: Pace = p !== undefined && /^4$/.test(p) ? 4 : p !== undefined && /^12$/.test(p) ? 12 : 1
  const n = once(q, 'note')
  const l = once(q, 'lead')
  let lead: number | null = null
  if (l !== undefined && /^\d+(\.\d+)?$/.test(l)) {
    const v = Number(l)
    if (Number.isFinite(v) && v >= 0 && v <= LEAD_MAX_S) lead = v
  }
  return { pace, note: n !== undefined && ID.test(n) ? n : null, lead, fps: /^1$/.test(once(q, 'fps') ?? '') }
}

export function parseRoute(hash: string): Route {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash
    const qi = raw.indexOf('?')
    const path = (qi < 0 ? raw : raw.slice(0, qi)).replace(/\/+$/, '') || '/'
    const query = qi < 0 ? '' : raw.slice(qi + 1)
    if (path === '/' || path === '') return { name: 'shelf' }
    let m = /^\/r\/([a-z0-9][a-z0-9-]*)$/.exec(path)
    if (m) return { name: 'edition', id: m[1]! }
    m = /^\/r\/([a-z0-9][a-z0-9-]*)\/cook$/.exec(path)
    if (m) return { name: 'cook', id: m[1]!, ...cookQuery(query) }
    m = /^\/r\/([a-z0-9][a-z0-9-]*)\/quoted$/.exec(path)
    if (m) return { name: 'quoted', id: m[1]! }
    m = /^\/pane\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/.exec(path)
    if (m) return { name: 'pane', id: m[1]!, noteId: m[2]!, query }
    return { name: 'notFound' }
  } catch {
    return { name: 'notFound' }
  }
}

/** Writes the non-default query values only, in the fixed order note, pace, lead, fps. */
export function formatRoute(r: Route): string {
  switch (r.name) {
    case 'shelf':
      return '#/'
    case 'notFound':
      return '#/not-found' // matches no route, so it re-parses to notFound
    case 'edition':
      return `#/r/${r.id}`
    case 'quoted':
      return `#/r/${r.id}/quoted`
    case 'pane':
      return `#/pane/${r.id}/${r.noteId}${r.query ? `?${r.query}` : ''}`
    case 'cook': {
      const q: string[] = []
      if (r.note) q.push(`note=${r.note}`)
      if (r.pace !== 1) q.push(`pace=${r.pace}`)
      if (r.lead !== null) q.push(`lead=${r.lead}`)
      if (r.fps) q.push(`fps=${Number(r.fps)}`)
      return `#/r/${r.id}/cook${q.length ? `?${q.join('&')}` : ''}`
    }
  }
}
