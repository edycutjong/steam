// The shelf: the build-time catalog plus each recipe bundle, fetched, validated and checked (R2).
// content/catalog.json is imported rather than fetched: `steam-ingest catalog` writes it to content/ and copies only the recipe folders to public/.

import catalogJson from '../../content/catalog.json' with { type: 'json' }
import type { DeadlineTimers } from './deadline.ts'
import { displayableNotes } from './provenance.ts'
import { Catalog, RecipeBundle, type BundleNote } from './schema.ts'

type CatalogEntry = Catalog[number]

export interface LoadedRecipe {
  bundle: RecipeBundle
  notes: BundleNote[]
  withheld: { noteId: string; reason: string }[]
}
export interface Rejection {
  id: string
  reason: string
  /** The load ended on a transport failure after every retry (a2a-arch-r06 C1): asking again may work. Absent for a 404 or a content failure. */
  transient?: true
}
export interface ShelfResult {
  recipes: LoadedRecipe[]
  rejected: Rejection[]
  /** Set when the catalog itself is invalid. */
  error?: string
}

/** R2.3: the checks a valid bundle must also pass before the app shows it. Returns the first failing reason, or null. */
export function checkCookable(bundle: RecipeBundle, entry: CatalogEntry): string | null {
  if (bundle.id !== entry.id) return `bundle id ${bundle.id} is not the catalog id`
  if (bundle.gateSha256 !== entry.gateSha256) return 'gateSha256 differs between the catalog and the bundle'
  const stepNs = new Set(bundle.steps.map((s) => s.n))
  const lineIs = new Set(bundle.lines.map((l) => l.i))
  const seen = new Set<number>()
  for (const n of bundle.notes) {
    if (!stepNs.has(n.step)) return `note ${n.id} is on step ${n.step}, which does not exist`
    if (seen.has(n.step)) return `two notes share step ${n.step}`
    seen.add(n.step)
    for (const g of n.groups) if (!lineIs.has(g.line)) return `note ${n.id} quotes line ${g.line}, which does not exist`
  }
  for (const s of bundle.steps) for (const i of s.lineIdx) if (!lineIs.has(i)) return `step ${s.n} names line ${i}, which does not exist`
  return null
}

/** Waits before the second and third attempt of a recipe fetch that failed on transport (a2a-arch-r05 B5). */
export const RETRY_DELAYS_MS = [300, 1000] as const
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
/** Statuses that say "try again": request timeout, rate limit, server trouble. Every other status, 404 included, is final. */
const retryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

/** What one pass over the network says: a final answer, or a transport failure worth another try. */
type Attempt = { transient: false; result: LoadedRecipe | Rejection } | { transient: true; reason: string }
interface Outcome {
  result: LoadedRecipe | Rejection
  /** The load ended on a transport failure after every retry: the answer is not kept. */
  transient: boolean
}

/**
 * A loader with its own cache: one fetch per id (R2.7). A network rejection or a retryable status is tried up to
 * `RETRY_DELAYS_MS.length` more times (`sleep` is injectable) and, if it still fails, is not cached, so a later `load()` asks again.
 * A 404 or a content failure (JSON, schema, `checkCookable`, withholding) is final, cached and never retried.
 */
export function createShelfLoader(fetchFn: typeof fetch = (...a) => fetch(...a), catalog: unknown = catalogJson, sleep: (ms: number) => Promise<void> = wait, _timers?: DeadlineTimers) {
  const cache = new Map<string, Promise<Outcome>>()
  const attemptOne = async (entry: CatalogEntry): Promise<Attempt> => {
    const final = (reason: string): Attempt => ({ transient: false, result: { id: entry.id, reason } })
    let res: Response
    try {
      res = await fetchFn(`/recipes/${entry.id}/recipe.json`)
    } catch (e) {
      return { transient: true, reason: `recipe.json could not be loaded: ${(e as Error).message}` }
    }
    if (!res.ok) return retryableStatus(res.status) ? { transient: true, reason: `recipe.json: HTTP ${res.status}` } : final(`recipe.json: HTTP ${res.status}`)
    let json: unknown
    try {
      json = await res.json()
    } catch (e) {
      // a body that is not JSON is the content's fault; a body that did not arrive is the network's
      return e instanceof SyntaxError ? final(`recipe.json could not be loaded: ${e.message}`) : { transient: true, reason: `recipe.json could not be loaded: ${(e as Error).message}` }
    }
    try {
      const parsed = RecipeBundle.safeParse(json)
      if (!parsed.success) return final(`recipe.json is invalid: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`)
      const why = checkCookable(parsed.data, entry)
      if (why) return final(why)
      const d = displayableNotes(parsed.data)
      for (const w of d.withheld) console.warn(`shelf: ${entry.id}: note ${w.noteId} is withheld: ${w.reason}`)
      return { transient: false, result: { bundle: parsed.data, notes: d.notes, withheld: d.withheld } }
    } catch (e) {
      return final(`recipe.json could not be loaded: ${(e as Error).message}`)
    }
  }
  const loadOne = async (entry: CatalogEntry): Promise<Outcome> => {
    for (let n = 0; ; n++) {
      const a = await attemptOne(entry)
      if (!a.transient) {
        if ('reason' in a.result) console.warn(`shelf: ${entry.id} is not shown: ${a.result.reason}`)
        return { result: a.result, transient: false }
      }
      if (n >= RETRY_DELAYS_MS.length) {
        console.warn(`shelf: ${entry.id} is not shown: ${a.reason}`)
        return { result: { id: entry.id, reason: a.reason, transient: true }, transient: true }
      }
      await sleep(RETRY_DELAYS_MS[n]!)
    }
  }
  return {
    async load(): Promise<ShelfResult> {
      const c = Catalog.safeParse(catalog)
      if (!c.success) return { recipes: [], rejected: [{ id: '*', reason: 'the catalog is invalid' }], error: 'the catalog is invalid' }
      const out = await Promise.all(
        c.data.map(async (e) => {
          let p = cache.get(e.id)
          if (!p) cache.set(e.id, (p = loadOne(e)))
          const o = await p
          if (o.transient && cache.get(e.id) === p) cache.delete(e.id)
          return o.result
        }),
      )
      return { recipes: out.filter((o): o is LoadedRecipe => 'bundle' in o), rejected: out.filter((o): o is Rejection => !('bundle' in o)) }
    },
  }
}

const shared = createShelfLoader()
/** The app's loader: the build-time catalog, the real `fetch`, one cache for the session. */
export const loadShelf = (): Promise<ShelfResult> => shared.load()
