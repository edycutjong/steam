import { createContext, useContext } from 'react'
import type { Audio } from '../cook/audio.ts'
import type { ShelfResult } from '../data/catalog.ts'
import type { Store } from '../data/store.ts'

export type ShelfState = { state: 'loading' } | { state: 'ready'; result: ShelfResult }

export interface AppApi {
  /** Sets the one live region: a short clear first, so that a repeated string is announced again. */
  announce(message: string): void
  shelf: ShelfState
  /** Resolves to the device store (IndexedDB, or memory where it is not available). */
  store: Promise<Store>
  /** The simmer; null until created. Locked until the first gesture (R16.4). */
  audio: Audio | null
}

export const AppContext = createContext<AppApi | null>(null)

export function useApp(): AppApi {
  const a = useContext(AppContext)
  if (!a) throw new Error('useApp: no AppContext')
  return a
}
