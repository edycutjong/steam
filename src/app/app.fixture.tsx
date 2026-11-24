// A test AppContext: a memory store and a recorded live region.
import type { ReactNode } from 'react'
import type { Audio } from '../cook/audio.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import { openStore, type Store } from '../data/store.ts'
import { AppContext, type AppApi, type ShelfState } from './AppContext.tsx'

export function testApp(o: { recipes?: LoadedRecipe[]; shelf?: ShelfState; store?: Promise<Store>; audio?: Audio | null } = {}) {
  const said: string[] = []
  const api: AppApi = {
    announce: (m) => void said.push(m),
    shelf: o.shelf ?? { state: 'ready', result: { recipes: o.recipes ?? [], rejected: [] } },
    store: o.store ?? openStore(null),
    audio: o.audio ?? null,
  }
  const wrap = (n: ReactNode) => <AppContext.Provider value={api}>{n}</AppContext.Provider>
  return { api, said, wrap }
}
