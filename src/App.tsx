import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppContext, type ShelfState } from './app/AppContext.tsx'
import Cook from './app/Cook.tsx'
import Edition from './app/Edition.tsx'
import NotFound, { type Retry } from './app/NotFound.tsx'
import Quoted from './app/Quoted.tsx'
import Shelf from './app/Shelf.tsx'
import { useRoute } from './app/useRoute.ts'
import { ANNOUNCE, NOT_FOUND, PRODUCT } from './copy/strings.ts'
import { loadShelf, type ShelfResult } from './data/catalog.ts'
import { createAudio, type Audio, type AudioCtx } from './cook/audio.ts'
import { openStore, type Store } from './data/store.ts'
import SteamPane from './steam/SteamPane.tsx'

interface Props {
  /** Injected by tests; the app uses the catalog and `fetch`. */
  loader?: () => Promise<ShelfResult>
  store?: Promise<Store>
  /** Injected by tests; the app makes a Web Audio context after the first gesture. */
  createContext?: () => AudioCtx | null
}

const webAudio = (): AudioCtx | null => {
  const C = (globalThis as { AudioContext?: new () => AudioCtx }).AudioContext
  return C ? new C() : null
}

const defaultStore = (): Promise<Store> => openStore()

export default function App({ loader = loadShelf, store, createContext = webAudio }: Props) {
  const route = useRoute()
  const [shelf, setShelf] = useState<ShelfState>({ state: 'loading' })
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const storeP = useMemo(() => store ?? defaultStore(), [store])

  const announce = useCallback((m: string): void => {
    clearTimeout(timer.current)
    setMessage('')
    timer.current = setTimeout(() => setMessage(m), 30)
  }, [])

  // The shelf loads once. A load that ended on transport (a2a-arch-r06 C1) is run again by the "Try again" button and by the window's
  // "online" event; the loader's own cache does not keep such a failure (a2a-arch-r05 B5), so each run asks the network again.
  const live = useRef(true)
  const run = useRef(0)
  const [retrying, setRetrying] = useState(false)
  const load = useCallback(
    (then?: (r: ShelfResult) => void): void => {
      const mine = ++run.current
      void loader().then((result) => {
        if (!live.current || mine !== run.current) return
        setShelf({ state: 'ready', result })
        setRetrying(false)
        then?.(result)
      })
    },
    [loader],
  )
  useEffect(() => {
    live.current = true
    announce(ANNOUNCE.openingShelf)
    load()
    return () => {
      live.current = false
      clearTimeout(timer.current)
    }
  }, [load, announce])
  const transientIds = shelf.state === 'ready' ? shelf.result.rejected.filter((r) => r.transient).map((r) => r.id) : []
  const anyTransient = transientIds.length > 0
  const retry = useCallback((): void => {
    setRetrying(true)
    announce(ANNOUNCE.retrying)
    load((r) => {
      if (r.rejected.some((x) => x.transient)) announce(NOT_FOUND.transient)
    })
  }, [announce, load])
  useEffect(() => {
    if (!anyTransient) return
    const onOnline = (): void => void load()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [anyTransient, load])

  // The simmer exists from the start but makes no context and no sound before the first gesture anywhere (R16.4).
  const [audio, setAudio] = useState<Audio | null>(null)
  useEffect(() => {
    let a: Audio | null = null
    void storeP.then((s) => {
      a = createAudio({ createContext }, s)
      setAudio(a)
    })
    return () => a?.dispose()
  }, [storeP, createContext])
  useEffect(() => {
    if (!audio) return
    const kinds = ['pointerdown', 'keydown', 'touchend'] as const
    const once = () => {
      audio.unlock()
      for (const k of kinds) window.removeEventListener(k, once, true)
    }
    for (const k of kinds) window.addEventListener(k, once, true)
    return () => {
      for (const k of kinds) window.removeEventListener(k, once, true)
    }
  }, [audio])

  const api = useMemo(() => ({ announce, shelf, store: storeP, audio }), [announce, shelf, storeP, audio])

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
    const lost: Retry | undefined = !recipe && transientIds.includes(route.id) ? { run: retry, busy: retrying } : undefined
    screen = !recipe ? <NotFound retry={lost} /> : route.name === 'edition' ? <Edition recipe={recipe} /> : route.name === 'cook' ? <Cook recipe={recipe} route={route} /> : <Quoted recipe={recipe} />
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
