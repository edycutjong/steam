// Device store: IndexedDB `steam` v1 (sessions, timing, settings) with an in-memory fallback (R18).
// The fallback keeps the app working where IndexedDB is missing or refuses; `persistent` then reads false.

export interface SessionRecord {
  recipeId: string
}

export interface Store {
  getSession(recipeId: string): Promise<SessionRecord | null>
  putSession(s: SessionRecord): Promise<void>
  deleteSession(recipeId: string): Promise<void>
  getTiming(recipeId: string): Promise<Record<string, number>>
  putTiming(recipeId: string, noteId: string, seconds: number): Promise<void>
  deleteTiming(recipeId: string, noteId: string): Promise<void>
  getSetting<T>(key: string): Promise<T | undefined>
  putSetting(key: string, value: unknown): Promise<void>
  /** False in the memory fallback, and once any write or read has failed. */
  readonly persistent: boolean
}

export const DB_NAME = 'steam'
export const DB_VERSION = 1
const STORES = ['sessions', 'timing', 'settings'] as const

function memoryOps() {
  const sessions = new Map<string, SessionRecord>()
  const timing = new Map<string, number>()
  const settings = new Map<string, unknown>()
  const tk = (r: string, n: string) => `${r}\u0000${n}`
  return {
    getSession: async (id: string) => (sessions.has(id) ? structuredClone(sessions.get(id)!) : null),
    putSession: async (s: SessionRecord) => void sessions.set(s.recipeId, structuredClone(s)),
    deleteSession: async (id: string) => void sessions.delete(id),
    getTiming: async (id: string) => Object.fromEntries([...timing].filter(([k]) => k.startsWith(`${id}\u0000`)).map(([k, v]) => [k.slice(id.length + 1), v])),
    putTiming: async (r: string, n: string, s: number) => void timing.set(tk(r, n), s),
    deleteTiming: async (r: string, n: string) => void timing.delete(tk(r, n)),
    getSetting: async (k: string) => settings.get(k),
    putSetting: async (k: string, v: unknown) => void settings.set(k, v),
  }
}

const req = <T>(r: IDBRequest<T>): Promise<T> => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const done = (t: IDBTransaction): Promise<void> => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error ?? new Error('transaction aborted')) })

export async function openStore(...args: [factory?: IDBFactory | null]): Promise<Store> {
  const factory = args.length ? args[0] : (globalThis as { indexedDB?: IDBFactory }).indexedDB
  const mem = memoryOps()
  let db: IDBDatabase | null = null
  let persistent = false
  if (factory) {
    try {
      db = await new Promise<IDBDatabase>((res, rej) => {
        const r = factory.open(DB_NAME, DB_VERSION)
        r.onupgradeneeded = () => {
          const d = r.result
          d.createObjectStore('sessions', { keyPath: 'recipeId' })
          d.createObjectStore('timing', { keyPath: 'key' })
          d.createObjectStore('settings', { keyPath: 'key' })
        }
        r.onsuccess = () => res(r.result)
        r.onerror = () => rej(r.error)
        r.onblocked = () => rej(new Error('blocked'))
      })
      persistent = true
    } catch {
      db = null
    }
  }
  /** Runs against IndexedDB; on any failure, falls back to memory for this and every later call. */
  const run = async <T>(idb: (d: IDBDatabase) => Promise<T>, fallback: () => Promise<T>): Promise<T> => {
    if (db && persistent) {
      try {
        return await idb(db)
      } catch {
        persistent = false
      }
    }
    return fallback()
  }
  const tx = (d: IDBDatabase, store: (typeof STORES)[number], mode: IDBTransactionMode) => {
    const t = d.transaction(store, mode)
    return { os: t.objectStore(store), t }
  }
  const tkey = (r: string, n: string) => `${r}\u0000${n}`
  return {
    get persistent() {
      return persistent
    },
    getSession: (id) => run(async (d) => { const { os } = tx(d, 'sessions', 'readonly'); return ((await req(os.get(id))) as SessionRecord | undefined) ?? null }, () => mem.getSession(id)),
    putSession: (s) => run(async (d) => { const { os, t } = tx(d, 'sessions', 'readwrite'); os.put(s); await done(t) }, () => mem.putSession(s)),
    deleteSession: (id) => run(async (d) => { const { os, t } = tx(d, 'sessions', 'readwrite'); os.delete(id); await done(t) }, () => mem.deleteSession(id)),
    getTiming: (id) =>
      run(
        async (d) => {
          const { os } = tx(d, 'timing', 'readonly')
          const all = (await req(os.getAll())) as { key: string; recipeId: string; noteId: string; seconds: number }[]
          return Object.fromEntries(all.filter((r) => r.recipeId === id).map((r) => [r.noteId, r.seconds]))
        },
        () => mem.getTiming(id),
      ),
    putTiming: (r, n, s) => run(async (d) => { const { os, t } = tx(d, 'timing', 'readwrite'); os.put({ key: tkey(r, n), recipeId: r, noteId: n, seconds: s }); await done(t) }, () => mem.putTiming(r, n, s)),
    deleteTiming: (r, n) => run(async (d) => { const { os, t } = tx(d, 'timing', 'readwrite'); os.delete(tkey(r, n)); await done(t) }, () => mem.deleteTiming(r, n)),
    getSetting: <T>(k: string) => run(async (d) => { const { os } = tx(d, 'settings', 'readonly'); return ((await req(os.get(k))) as { value: T } | undefined)?.value }, () => mem.getSetting(k) as Promise<T | undefined>),
    putSetting: (k, v) => run(async (d) => { const { os, t } = tx(d, 'settings', 'readwrite'); os.put({ key: k, value: v }); await done(t) }, () => mem.putSetting(k, v)),
  }
}
