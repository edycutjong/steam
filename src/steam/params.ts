import { LEAD_MS } from './timeline.ts'

export interface SteamParams {
  /** Frozen reveal clock in ms after reveal start, or null for the live clock. */
  t: number | null
  /** Lead-in before auto-start, ms. Ignored (default) when `t` is set. */
  lead: number
  /** Show the fps overlay. */
  fps: boolean
}

function queryOf(hash: string): URLSearchParams {
  const q = hash.indexOf('?')
  return new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '')
}

function finiteNumber(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** `search` (location.search) wins over the hash route query (location.hash). */
export function parseParams(search: string, hash: string): SteamParams {
  const s = new URLSearchParams(search)
  const h = queryOf(hash)
  const get = (key: string, ok: (v: string | null) => boolean): string | null => {
    const fromSearch = s.get(key)
    if (ok(fromSearch)) return fromSearch
    const fromHash = h.get(key)
    return ok(fromHash) ? fromHash : null
  }
  const t = finiteNumber(get('t', (v) => finiteNumber(v) !== null))
  const leadRaw = finiteNumber(get('lead', (v) => {
    const n = finiteNumber(v)
    return n !== null && n >= 0
  }))
  const fps = get('fps', (v) => v === '1') === '1'
  return { t, lead: t !== null || leadRaw === null ? LEAD_MS : leadRaw, fps }
}
