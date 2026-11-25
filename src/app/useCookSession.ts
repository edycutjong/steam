import { useCallback, useEffect, useRef, useState } from 'react'
import { buildPlan, type Plan } from '../cook/plan.ts'
import { initialState, nextDueWall, reduce, toSnapshot, type Pace, type SchedEffect, type SchedEvent, type SchedState } from '../cook/scheduler.ts'
import { Snapshot, snapshotValid } from '../cook/session.ts'
import { systemClock, WAKE_MS, type Clock } from '../cook/clock.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import type { Store } from '../data/store.ts'
import type { Route } from './router.ts'

export type CookRoute = Extract<Route, { name: 'cook' }>
export type StartKind = 'start' | 'deepLink' | 'restore' | 'unknownNote'
export const DEFAULT_LEAD_S = 10

type UiEvent = { type: 'tick' | 'sleep' | 'resume' | 'show' | 'wipe' } | { type: 'setPace'; pace: Pace }

export interface Session {
  plan: Plan | null
  state: SchedState
  /** How the session began, for the caption (R18.4, R19.1, R19.5). */
  started: StartKind | null
  /** Wall time the first event was dispatched. */
  startWall: number | null
  persistent: boolean
  dispatch(e: UiEvent): void
  clock: Clock
}

export interface SessionOpts {
  recipe: LoadedRecipe
  route: CookRoute
  store: Promise<Store>
  clock?: Clock
  onEffects?: (effects: SchedEffect[], ctx: { event: SchedEvent; state: SchedState; plan: Plan }) => void
  /** The document whose visibility and lifecycle drive sleep and resume. */
  doc?: Document
  win?: Window
}

const meaningful = (a: SchedState, b: SchedState): boolean =>
  a.status !== b.status || a.stepIndex !== b.stepIndex || a.asleep !== b.asleep || a.paceHistory !== b.paceHistory || a.revealed.length !== b.revealed.length || a.holdUntilWall !== b.holdUntilWall

/** The Cook Mode session: start, deep link or restore; one timer; sleep and resume from page visibility; a snapshot after each change (design 6.1). */
export function useCookSession({ recipe, route, store, clock = systemClock, onEffects, doc = document, win = window }: SessionOpts): Session {
  const id = recipe.bundle.id
  const [plan, setPlan] = useState<Plan | null>(null)
  const [state, setState] = useState<SchedState>(initialState)
  const [started, setStarted] = useState<StartKind | null>(null)
  const [startWall, setStartWall] = useState<number | null>(null)
  const [persistent, setPersistent] = useState(true)
  const ref = useRef({ plan: null as Plan | null, state: initialState })
  const effectsRef = useRef(onEffects)
  effectsRef.current = onEffects
  const storeRef = useRef<Store | null>(null)

  const save = useCallback((s: SchedState) => {
    const st = storeRef.current
    if (!st) return
    const p = s.status === 'finished' ? st.deleteSession(id) : s.status === 'running' ? st.putSession(toSnapshot(s, id)) : Promise.resolve()
    void p.then(() => setPersistent(st.persistent)).catch(() => setPersistent(false))
  }, [id])

  const run = useCallback((e: SchedEvent) => {
    const p = ref.current.plan
    if (!p) return
    const before = ref.current.state
    const r = reduce(p, before, e)
    ref.current.state = r.state
    if (meaningful(before, r.state)) {
      setState(r.state)
      save(r.state)
    }
    if (r.effects.length) effectsRef.current?.(r.effects, { event: e, state: r.state, plan: p })
  }, [save])

  const dispatch = useCallback((e: UiEvent) => run({ ...e, wallMs: clock.now() } as SchedEvent), [run, clock])

  // Start once: a deep link, a valid saved session, or a fresh start (R18.4, R19.1 to R19.5).
  useEffect(() => {
    let live = true
    void (async () => {
      const st = await store
      if (!live) return
      storeRef.current = st
      const overrides = await st.getTiming(id).catch(() => ({}))
      const p = buildPlan(recipe.bundle, recipe.notes, overrides)
      const saved = await st.getSession(id).catch(() => null)
      if (!live) return
      ref.current.plan = p
      setPlan(p)
      setPersistent(st.persistent)
      const now = clock.now()
      let kind: StartKind
      let e: SchedEvent
      const deep = route.note ? recipe.notes.find((n) => n.id === route.note) : undefined
      const parsed = saved ? Snapshot.safeParse(saved) : null
      if (route.note && deep) {
        await st.deleteSession(id).catch(() => {})
        kind = 'deepLink'
        e = { type: 'deepLink', wallMs: now, stepIndex: deep.step - 1, leadMs: (route.lead ?? DEFAULT_LEAD_S) * 1000, pace: route.pace }
      } else if (!route.note && parsed?.success && snapshotValid(parsed.data, p, id, now)) {
        kind = 'restore'
        e = { type: 'restore', wallMs: now, snapshot: parsed.data, ...(route.pace !== 1 ? { pace: route.pace } : {}) }
      } else {
        if (saved) await st.deleteSession(id).catch(() => {})
        kind = route.note ? 'unknownNote' : 'start'
        e = { type: 'start', wallMs: now, pace: route.pace }
      }
      if (!live) return
      setStarted(kind)
      setStartWall(now)
      run(e)
    })()
    return () => {
      live = false
    }
    // the session starts once per mount of the screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One timer: wake at the next due time, and at least every WAKE_MS (R10.6, R12.8).
  // The loop reschedules itself, because a tick that changes nothing visible does not re-render.
  useEffect(() => {
    if (!plan || state.status !== 'running' || state.asleep) return
    let t: ReturnType<typeof setTimeout> | undefined
    const loop = () => {
      const due = nextDueWall(plan, ref.current.state)
      const wait = Math.max(0, Math.min(due === null ? WAKE_MS : due - clock.now(), WAKE_MS))
      t = setTimeout(() => {
        dispatch({ type: 'tick' })
        loop()
      }, wait)
    }
    loop()
    return () => clearTimeout(t)
  }, [plan, state, dispatch, clock])

  // Sleep and resume from page visibility; tick (or resume, if asleep and visible) on pageshow and focus; save on pagehide (R12.7, R18.2).
  useEffect(() => {
    const onVis = () => {
      if (doc.visibilityState === 'hidden') {
        dispatch({ type: 'sleep' })
        save(ref.current.state)
      } else dispatch({ type: 'resume' })
    }
    // pageshow and focus: a tick never clears `asleep`, so a page the engine restored as visible without a visibilitychange must be resumed
    const onTick = () => dispatch({ type: doc.visibilityState === 'visible' && ref.current.state.asleep ? 'resume' : 'tick' })
    const onHide = () => save(ref.current.state)
    doc.addEventListener('visibilitychange', onVis)
    win.addEventListener('pageshow', onTick)
    win.addEventListener('focus', onTick)
    win.addEventListener('pagehide', onHide)
    return () => {
      doc.removeEventListener('visibilitychange', onVis)
      win.removeEventListener('pageshow', onTick)
      win.removeEventListener('focus', onTick)
      win.removeEventListener('pagehide', onHide)
    }
  }, [doc, win, dispatch, save])

  return { plan, state, started, startWall, persistent, dispatch, clock }
}
