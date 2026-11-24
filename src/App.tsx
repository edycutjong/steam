import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppContext, type ShelfState } from './app/AppContext.tsx'
import Cook from './app/Cook.tsx'
import Edition from './app/Edition.tsx'
import NotFound from './app/NotFound.tsx'
import Quoted from './app/Quoted.tsx'
import Shelf from './app/Shelf.tsx'
import { useRoute } from './app/useRoute.ts'
import { ANNOUNCE, PRODUCT } from './copy/strings.ts'
import { loadShelf, type ShelfResult } from './data/catalog.ts'
import { openStore, type Store } from './data/store.ts'
import SteamPane from './steam/SteamPane.tsx'

interface Props {
  /** Injected by tests; the app uses the catalog and `fetch`. */
  loader?: () => Promise<ShelfResult>
  store?: Promise<Store>
}

const defaultStore = (): Promise<Store> => openStore()

export default function App({ loader = loadShelf, store }: Props) {
  const route = useRoute()
  const [shelf, setShelf] = useState<ShelfState>({ state: 'loading' })
  const [message, setMessage] = useState('')
  const timer = useRef(0)
  const storeP = useMemo(() => store ?? defaultStore(), [store])

  const announce = useCallback((m: string): void => {
    window.clearTimeout(timer.current)
    setMessage('')
    timer.current = window.setTimeout(() => setMessage(m), 30)
  }, [])

  useEffect(() => {
    let live = true
    announce(ANNOUNCE.openingShelf)
    loader().then((result) => {
      if (live) setShelf({ state: 'ready', result })
    })
    return () => {
      live = false
      window.clearTimeout(timer.current)
    }
  }, [loader, announce])

  const api = useMemo(() => ({ announce, shelf, store: storeP }), [announce, shelf, storeP])

  let screen
  if (route.name === 'pane') {
    // The renderer harness (R15.8): linked from nowhere; its parameters come from the hash query only (R1.7).
    screen = <SteamPane stem={`/recipes/${route.id}/note-${route.noteId}`} paneDir={`/recipes/${route.id}/panes`} noteId={route.noteId} query={route.query} />
  } else if (route.name === 'notFound') {
    screen = <NotFound />
  } else if (route.name === 'shelf') {
    screen = <Shelf />
  } else if (shelf.state === 'loading') {
    screen = <main className="screen" aria-busy="true" />
  } else {
    const recipe = shelf.result.recipes.find((r) => r.bundle.id === route.id)
    screen = !recipe ? <NotFound /> : route.name === 'edition' ? <Edition recipe={recipe} /> : route.name === 'cook' ? <Cook recipe={recipe} route={route} /> : <Quoted recipe={recipe} />
  }

  return (
    <AppContext.Provider value={api}>
      <p className="sr-only">{PRODUCT}</p>
      {/* One screen at a time; the key resets a screen's own state and its focus when the route changes. */}
      <div key={route.name === 'pane' ? `pane/${route.id}/${route.noteId}?${route.query}` : route.name === 'notFound' ? 'notFound' : route.name === 'shelf' ? 'shelf' : `${route.name}/${route.id}`}>{screen}</div>
      {route.name === 'pane' ? null : (
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {message}
        </div>
      )}
    </AppContext.Provider>
  )
}
