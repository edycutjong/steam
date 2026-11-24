// The shelf: the build-time catalog plus each recipe bundle, fetched, validated and checked (R2).
// content/catalog.json is imported rather than fetched: `steam-ingest catalog` writes it to content/ and copies only the recipe folders to public/.

import catalogJson from '../../content/catalog.json' with { type: 'json' }
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

/** A loader with its own cache: one fetch per id (R2.7). */
export function createShelfLoader(fetchFn: typeof fetch = (...a) => fetch(...a), catalog: unknown = catalogJson) {
  const cache = new Map<string, Promise<LoadedRecipe | Rejection>>()
  const loadOne = async (entry: CatalogEntry): Promise<LoadedRecipe | Rejection> => {
    const reject = (reason: string): Rejection => {
      console.warn(`shelf: ${entry.id} is not shown: ${reason}`)
      return { id: entry.id, reason }
    }
    try {
      const res = await fetchFn(`/recipes/${entry.id}/recipe.json`)
      if (!res.ok) return reject(`recipe.json: HTTP ${res.status}`)
      const parsed = RecipeBundle.safeParse(await res.json())
      if (!parsed.success) return reject(`recipe.json is invalid: ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`)
      const why = checkCookable(parsed.data, entry)
      if (why) return reject(why)
      const d = displayableNotes(parsed.data)
      for (const w of d.withheld) console.warn(`shelf: ${entry.id}: note ${w.noteId} is withheld: ${w.reason}`)
      return { bundle: parsed.data, notes: d.notes, withheld: d.withheld }
    } catch (e) {
      return reject(`recipe.json could not be loaded: ${(e as Error).message}`)
    }
  }
  return {
    async load(): Promise<ShelfResult> {
      const c = Catalog.safeParse(catalog)
      if (!c.success) return { recipes: [], rejected: [{ id: '*', reason: 'the catalog is invalid' }], error: 'the catalog is invalid' }
      const out = await Promise.all(
        c.data.map((e) => {
          let p = cache.get(e.id)
          if (!p) cache.set(e.id, (p = loadOne(e)))
          return p
        }),
      )
      return { recipes: out.filter((o): o is LoadedRecipe => 'bundle' in o), rejected: out.filter((o): o is Rejection => !('bundle' in o)) }
    },
  }
}

const shared = createShelfLoader()
/** The app's loader: the build-time catalog, the real `fetch`, one cache for the session. */
export const loadShelf = (): Promise<ShelfResult> => shared.load()
