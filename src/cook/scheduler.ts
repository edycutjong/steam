// The scheduler: a pure state machine from (plan, state, event) to (state, effects). It knows nothing about the pane;
// the UI turns effects into pane commands (design 4). Wall times are numbers in ms; the caller supplies them.

import { WIPE } from '../copy/strings.ts'
import type { Pace } from '../app/router.ts'
import type { Plan } from './plan.ts'
import type { Snapshot } from './session.ts'

export type { Pace }
export interface PaceSeg {
  atWall: number
  pace: Pace
}

export interface SchedState {
  status: 'idle' | 'running' | 'finished'
  stepIndex: number
  initialStep: number
  stepStartWall: number
  /** Greatest wall time seen; -Infinity while idle. */
  lastWall: number
  asleep: boolean
  /** Since stepStartWall; [0].atWall === stepStartWall. */
  paceHistory: PaceSeg[]
  /** Deep link only, initial step only. */
  holdUntilWall: number | null
  /** Note ids, whole session. */
  revealed: string[]
}

export type SchedEvent =
  | { type: 'start'; wallMs: number; pace: Pace }
  | { type: 'deepLink'; wallMs: number; stepIndex: number; leadMs: number; pace: Pace }
  | { type: 'restore'; wallMs: number; snapshot: Snapshot; pace?: Pace }
  | { type: 'tick' | 'sleep' | 'resume' | 'show' | 'wipe'; wallMs: number }
  | { type: 'setPace'; wallMs: number; pace: Pace }

export type SchedEffect =
  | { type: 'reveal'; noteId: string; stepIndex: number; cause: 'scheduled' | 'show' | 'wipe'; wallMs: number }
  | { type: 'advance'; stepIndex: number; wallMs: number }
  | { type: 'finish'; wallMs: number }

export interface Out {
  state: SchedState
  effects: SchedEffect[]
}

export const initialState: SchedState = {
  status: 'idle',
  stepIndex: 0,
  initialStep: 0,
  stepStartWall: 0,
  lastWall: -Infinity,
  asleep: false,
  paceHistory: [],
  holdUntilWall: null,
  revealed: [],
}

const same = (s: SchedState): Out => ({ state: s, effects: [] })
const currentPace = (s: SchedState): Pace => s.paceHistory[s.paceHistory.length - 1]?.pace ?? 1
const noteOf = (plan: Plan, s: SchedState) => plan.steps[s.stepIndex]?.note ?? null

export function noteState(plan: Plan, s: SchedState): 'none' | 'pending' | 'revealed' {
  const n = noteOf(plan, s)
  if (!n) return 'none'
  return s.revealed.includes(n.id) ? 'revealed' : 'pending'
}

/** Step time: the sum of pace x dt over the pace history, up to the greatest wall time seen. A wall time in the past changes nothing. */
export function elapsedMs(s: SchedState, wallMs: number): number {
  if (s.status === 'idle' || s.paceHistory.length === 0) return 0
  const w = Math.max(wallMs, s.lastWall)
  let total = 0
  s.paceHistory.forEach((seg, i) => {
    const end = i + 1 < s.paceHistory.length ? s.paceHistory[i + 1]!.atWall : w
    total += seg.pace * Math.max(0, end - seg.atWall)
  })
  return total
}

/** Adds a pace change at wall time w. Equal paces add nothing; two changes at one wall time keep the last. */
function setPaceAt(s: SchedState, w: number, pace: Pace): SchedState {
  const h = [...s.paceHistory]
  const last = h[h.length - 1]
  if (!last) return s
  if (last.atWall === w) {
    if (h.length === 1) h[0] = { atWall: w, pace }
    else {
      h.pop()
      if (h[h.length - 1]!.pace !== pace) h.push({ atWall: w, pace })
    }
  } else if (last.pace !== pace) h.push({ atWall: w, pace })
  return { ...s, paceHistory: h }
}

function reveal(plan: Plan, s: SchedState, cause: 'scheduled' | 'show' | 'wipe', w: number): Out {
  const n = noteOf(plan, s)!
  return { state: { ...s, revealed: [...s.revealed, n.id] }, effects: [{ type: 'reveal', noteId: n.id, stepIndex: s.stepIndex, cause, wallMs: w }] }
}

/** The scheduled reveal: only an awake session, a pending note, past the hold, with the step clock at or past the check time. */
function due(plan: Plan, s: SchedState, w: number): Out {
  const n = noteOf(plan, s)
  if (s.asleep || s.status !== 'running' || !n || s.revealed.includes(n.id)) return same(s)
  if (s.holdUntilWall !== null && w < s.holdUntilWall) return same(s)
  if (elapsedMs(s, w) < n.checkAtMs) return same(s)
  return reveal(plan, s, 'scheduled', w)
}

function advance(plan: Plan, r: Out, w: number): Out {
  const s = r.state
  if (s.stepIndex >= plan.steps.length - 1) return { state: { ...s, status: 'finished' }, effects: [...r.effects, { type: 'finish', wallMs: w }] }
  const arrived: SchedState = { ...s, stepIndex: s.stepIndex + 1, stepStartWall: w, paceHistory: [{ atWall: w, pace: currentPace(s) }], holdUntilWall: null }
  const d = due(plan, arrived, w)
  return { state: d.state, effects: [...r.effects, { type: 'advance', stepIndex: arrived.stepIndex, wallMs: w }, ...d.effects] }
}

function begin(plan: Plan, e: Extract<SchedEvent, { type: 'start' | 'deepLink' | 'restore' }>): Out {
  const N = plan.steps.length
  const w = e.wallMs
  let s: SchedState
  if (e.type === 'start') {
    s = { ...initialState, status: 'running', stepStartWall: w, lastWall: w, paceHistory: [{ atWall: w, pace: e.pace }] }
  } else if (e.type === 'deepLink') {
    const i = Math.min(N - 1, Math.max(0, e.stepIndex))
    s = { ...initialState, status: 'running', stepIndex: i, initialStep: i, stepStartWall: w, lastWall: w, paceHistory: [{ atWall: w, pace: e.pace }], holdUntilWall: w + Math.max(0, e.leadMs) }
  } else {
    const k = e.snapshot
    const ids = new Set(plan.steps.flatMap((x) => (x.note ? [x.note.id] : [])))
    const i = Math.min(N - 1, Math.max(0, k.stepIndex))
    const last = k.paceHistory[k.paceHistory.length - 1]!.atWall
    s = { ...initialState, status: 'running', stepIndex: i, initialStep: i, stepStartWall: k.stepStartWall, lastWall: Math.max(w, last), paceHistory: k.paceHistory.map((p) => ({ ...p })), revealed: k.revealed.filter((id) => ids.has(id)) }
    if (e.pace !== undefined) s = setPaceAt(s, s.lastWall, e.pace)
  }
  const d = due(plan, s, s.lastWall)
  return d
}

export function reduce(plan: Plan, s: SchedState, e: SchedEvent): Out {
  if (s.status === 'idle') {
    if (e.type === 'start' || e.type === 'deepLink' || e.type === 'restore') return begin(plan, e)
    return same(s)
  }
  if (e.type === 'start' || e.type === 'deepLink' || e.type === 'restore' || s.status === 'finished') return same({ ...s, lastWall: Math.max(s.lastWall, e.wallMs) })
  const w = Math.max(e.wallMs, s.lastWall)
  s = { ...s, lastWall: w }
  switch (e.type) {
    case 'tick':
      return due(plan, s, w)
    case 'sleep': {
      const r = due(plan, s, w)
      return { state: { ...r.state, asleep: true }, effects: r.effects }
    }
    case 'resume':
      return due(plan, { ...s, asleep: false }, w)
    case 'setPace': {
      const r = s.asleep ? same(s) : due(plan, s, w)
      return { state: setPaceAt(r.state, w, e.pace), effects: r.effects }
    }
    case 'show': {
      let r = due(plan, s, w)
      if (!r.state.asleep && noteState(plan, r.state) === 'pending') {
        const x = reveal(plan, r.state, 'show', w)
        r = { state: x.state, effects: [...r.effects, ...x.effects] }
      }
      return r
    }
    case 'wipe': {
      if (s.asleep) return same(s)
      let r = due(plan, s, w)
      if (noteState(plan, r.state) === 'pending') {
        const x = reveal(plan, r.state, 'wipe', w)
        r = { state: x.state, effects: [...r.effects, ...x.effects] }
      }
      return advance(plan, r, w)
    }
  }
}

/** The wall time at which a tick first emits the pending reveal; null when asleep, finished, revealed or without a note. */
export function nextDueWall(plan: Plan, s: SchedState): number | null {
  if (s.status !== 'running' || s.asleep || noteState(plan, s) !== 'pending') return null
  const n = noteOf(plan, s)!
  const need = n.checkAtMs - elapsedMs(s, s.lastWall)
  const t = s.lastWall + Math.max(0, need) / currentPace(s)
  return Math.max(t, s.holdUntilWall ?? -Infinity, s.lastWall)
}

export interface Control {
  label: string
  action: 'show' | 'wipe'
  leavesCook: boolean
}

/** The Wipe table (design 4.4). The UI adds the pane's `writing` flag on top. */
export function controlFor(plan: Plan, s: SchedState): Control {
  const ns = noteState(plan, s)
  const last = s.stepIndex >= plan.steps.length - 1
  if (ns === 'pending') return { label: WIPE.show, action: 'show', leavesCook: false }
  if (last) return { label: WIPE.quoted, action: 'wipe', leavesCook: true }
  return ns === 'revealed' ? { label: WIPE.wipe, action: 'wipe', leavesCook: false } : { label: WIPE.next, action: 'wipe', leavesCook: false }
}

export function toSnapshot(s: SchedState, recipeId: string): Snapshot {
  return { v: 1, recipeId, stepIndex: s.stepIndex, stepStartWall: s.stepStartWall, paceHistory: s.paceHistory.map((p) => ({ ...p })), revealed: [...s.revealed] }
}
