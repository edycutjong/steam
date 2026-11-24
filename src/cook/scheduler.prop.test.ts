import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Plan } from './plan.ts'
import type { Snapshot } from './session.ts'
import { controlFor, elapsedMs, initialState, nextDueWall, noteState, reduce, type Pace, type SchedEffect, type SchedEvent, type SchedState } from './scheduler.ts'

// P7 (design 13): each note is revealed exactly once. The generators are those of R13.1 (plans of 1 to 8 steps, at most one note per
// step, check times 0 to 3 600 s; up to 200 events; non-decreasing wall runs with occasional decreases; paces 1, 4, 12). The oracle below
// replays the events against its own model (an accumulated step clock, the revealed set, the hold, sleep) and is not the reducer's code.

const RUNS = 800
const paceArb = fc.constantFrom<Pace>(1, 4, 12)
const planArb: fc.Arbitrary<Plan> = fc.integer({ min: 1, max: 8 }).chain((n) =>
  fc
    .array(fc.option(fc.oneof({ weight: 2, arbitrary: fc.constant(0) }, { weight: 3, arbitrary: fc.integer({ min: 0, max: 3_600_000 }) }), { nil: null, freq: 2 }), { minLength: n, maxLength: n })
    .map((cs) => ({ steps: cs.map((c, i) => ({ note: c === null ? null : { id: `n${i}`, checkAtMs: c } })) })),
)

type Spec =
  | { kind: 'start' | 'tick' | 'sleep' | 'resume' | 'show' | 'wipe'; dt: number }
  | { kind: 'setPace'; dt: number; pace: Pace }
  | { kind: 'deepLink'; dt: number; step: number; lead: number; pace: Pace }
  | { kind: 'restore'; dt: number; step: number; age: number; segs: { off: number; pace: Pace }[]; mask: number; pace: Pace | undefined }

const dt = fc.oneof({ weight: 8, arbitrary: fc.integer({ min: 0, max: 5_000 }) }, { weight: 3, arbitrary: fc.integer({ min: 0, max: 2_000_000 }) }, { weight: 2, arbitrary: fc.integer({ min: -3_000, max: -1 }) })
const restoreSpec: fc.Arbitrary<Spec> = fc
  .tuple(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 3_000_000 }), fc.array(fc.tuple(fc.nat(1_000_000), paceArb), { minLength: 0, maxLength: 3 }), fc.nat(255), fc.option(paceArb, { nil: undefined }), dt)
  .map<Spec>(([step, age, segs, mask, pace, d]) => ({ kind: 'restore', dt: d, step, age, segs: segs.map(([off, p]) => ({ off, pace: p })), mask, pace }))
const spec: fc.Arbitrary<Spec> = fc.oneof(
  { weight: 6, arbitrary: dt.map<Spec>((d) => ({ kind: 'tick', dt: d })) },
  { weight: 2, arbitrary: dt.map<Spec>((d) => ({ kind: 'sleep', dt: d })) },
  { weight: 2, arbitrary: dt.map<Spec>((d) => ({ kind: 'resume', dt: d })) },
  { weight: 2, arbitrary: dt.map<Spec>((d) => ({ kind: 'show', dt: d })) },
  { weight: 3, arbitrary: dt.map<Spec>((d) => ({ kind: 'wipe', dt: d })) },
  { weight: 3, arbitrary: fc.tuple(dt, paceArb).map<Spec>(([d, pace]) => ({ kind: 'setPace', dt: d, pace })) },
  { weight: 1, arbitrary: dt.map<Spec>((d) => ({ kind: 'start', dt: d })) },
  { weight: 1, arbitrary: fc.tuple(dt, fc.integer({ min: -2, max: 12 }), fc.integer({ min: 0, max: 20_000 }), paceArb).map<Spec>(([d, step, lead, pace]) => ({ kind: 'deepLink', dt: d, step, lead, pace })) },
  { weight: 1, arbitrary: restoreSpec },
)
const first: fc.Arbitrary<Spec> = fc.oneof(
  { weight: 2, arbitrary: paceArb.map<Spec>(() => ({ kind: 'start', dt: 0 })) },
  { weight: 3, arbitrary: fc.tuple(fc.integer({ min: -2, max: 12 }), fc.integer({ min: 0, max: 20_000 }), paceArb).map<Spec>(([step, lead, pace]) => ({ kind: 'deepLink', dt: 0, step, lead, pace })) },
  { weight: 2, arbitrary: restoreSpec },
)
type Scenario = { plan: Plan; pre: Spec[]; first: Spec; rest: Spec[]; base: number; pace0: Pace }
const scenario: fc.Arbitrary<Scenario> = fc.record({ plan: planArb, pre: fc.array(spec.filter((s) => !['start', 'deepLink'].includes(s.kind)), { maxLength: 3 }), first, rest: fc.array(spec, { maxLength: 200 }), base: fc.integer({ min: 0, max: 1_000_000 }), pace0: paceArb })

// ---- the oracle ---------------------------------------------------------------------------------------------------------

interface Row {
  event: SchedEvent
  before: SchedState
  after: SchedState
  effects: SchedEffect[]
  want: SchedEffect[]
  wall: number // clamped wall time of the event as the oracle sees it
  asleepBefore: boolean
  accBefore: number // oracle's step clock just before the event's own handling, at the event's wall
  startWall: number
  leadMs: number | null
  kind: 'pre' | 'first' | 'later'
  /** The oracle's view at each scheduled reveal: its own step clock, the check time and the hold. */
  accAfter: number
  scheduled: { noteId: string; acc: number; check: number; hold: number | null; wall: number }[]
}

function play(plan: Plan, sc: { pre: Spec[]; first: Spec; rest: Spec[]; base: number; pace0: Pace }): { rows: Row[]; restoredRevealed: string[]; initialStep: number } {
  const N = plan.steps.length
  const ids = plan.steps.flatMap((s, i) => (s.note ? [{ id: s.note.id, i }] : []))
  let state = initialState
  let wall = sc.base
  const rows: Row[] = []
  // oracle model
  let running = false
  let finished = false
  let step = 0
  let asleep = false
  let hold: number | null = null
  let last = -Infinity
  let acc = 0
  let pace: Pace = 1
  const revealed = new Set<string>()
  let startWall = 0
  let leadMs: number | null = null
  let restoredRevealed: string[] = []
  let initialStep = 0

  const resolve = (s: Spec, w: number): SchedEvent => {
    switch (s.kind) {
      case 'setPace': return { type: 'setPace', wallMs: w, pace: s.pace }
      case 'start': return { type: 'start', wallMs: w, pace: sc.pace0 }
      case 'deepLink': return { type: 'deepLink', wallMs: w, stepIndex: s.step, leadMs: s.lead, pace: s.pace }
      case 'restore': {
        const i = Math.min(N - 1, s.step)
        const at = [0, ...s.segs.map((x) => x.off).sort((a, b) => a - b)].map((o) => Math.min(o, s.age))
        const hist = at.map((o, k) => ({ atWall: w - s.age + o, pace: k === 0 ? sc.pace0 : s.segs[k - 1]!.pace }))
        const snapshot: Snapshot = { v: 1, recipeId: 'r', stepIndex: i, stepStartWall: w - s.age, paceHistory: hist, revealed: ids.filter((_, k) => (s.mask >> (k % 8)) & 1).map((x) => x.id) }
        return { type: 'restore', wallMs: w, snapshot, ...(s.pace ? { pace: s.pace } : {}) }
      }
      default: return { type: s.kind, wallMs: w }
    }
  }
  const step1 = (s: Spec, kind: Row['kind']) => {
    wall += s.dt
    const e = resolve(s, wall)
    const before = state
    const r = reduce(plan, state, e)
    state = r.state
    const want: SchedEffect[] = []
    const scheduled: Row['scheduled'] = []
    const asleepBefore = asleep
    let accBefore = acc
    const note = () => plan.steps[step]?.note ?? null
    const pending = () => !!note() && !revealed.has(note()!.id)
    const doReveal = (cause: 'scheduled' | 'show' | 'wipe', w: number) => {
      if (cause === 'scheduled') scheduled.push({ noteId: note()!.id, acc, check: note()!.checkAtMs, hold, wall: w })
      revealed.add(note()!.id)
      want.push({ type: 'reveal', noteId: note()!.id, stepIndex: step, cause, wallMs: w })
    }
    const dueCheck = (w: number) => {
      if (!asleep && pending() && (hold === null || w >= hold) && acc >= note()!.checkAtMs) doReveal('scheduled', w)
    }
    const arrival = (w: number) => dueCheck(w)
    const isStartish = e.type === 'start' || e.type === 'deepLink' || e.type === 'restore'
    let w = e.wallMs
    if (!running) {
      if (isStartish) {
        running = true
        step = 0
        hold = null
        acc = 0
        pace = 1
        asleep = false
        startWall = e.wallMs
        if (e.type === 'start') pace = e.pace
        if (e.type === 'deepLink') {
          step = Math.min(N - 1, Math.max(0, e.stepIndex))
          pace = e.pace
          hold = e.wallMs + e.leadMs
          leadMs = e.leadMs
        }
        if (e.type === 'restore') {
          const k = e.snapshot
          step = Math.min(N - 1, k.stepIndex)
          for (const id of k.revealed) if (ids.some((x) => x.id === id)) revealed.add(id)
          restoredRevealed = [...revealed]
          // the clock of the step, integrated segment by segment up to the later of the event and the last pace change
          const lastAt = k.paceHistory[k.paceHistory.length - 1]!.atWall
          last = Math.max(e.wallMs, lastAt)
          acc = 0
          k.paceHistory.forEach((seg, j) => {
            const end = j + 1 < k.paceHistory.length ? k.paceHistory[j + 1]!.atWall : last
            acc += seg.pace * Math.max(0, end - seg.atWall)
          })
          pace = k.paceHistory[k.paceHistory.length - 1]!.pace
          if (e.pace !== undefined) pace = e.pace
          w = last
        }
        if (e.type !== 'restore') last = e.wallMs
        initialStep = step
        accBefore = 0
        arrival(w)
      }
    } else if (isStartish || finished) {
      const w2 = Math.max(last, e.wallMs)
      if (!finished) acc += pace * (w2 - last) // time passes even when the event is ignored
      last = w2
    } else {
      w = Math.max(e.wallMs, last)
      acc += pace * (w - last)
      last = w
      accBefore = acc
      switch (e.type) {
        case 'tick': dueCheck(w); break
        case 'sleep': dueCheck(w); asleep = true; break
        case 'resume': asleep = false; dueCheck(w); break
        case 'setPace': if (!asleep) dueCheck(w); pace = e.pace; break
        case 'show': dueCheck(w); if (!asleep && pending()) doReveal('show', w); break
        case 'wipe': {
          if (asleep) break
          dueCheck(w)
          if (pending()) doReveal('wipe', w)
          if (step >= N - 1) {
            finished = true
            want.push({ type: 'finish', wallMs: w })
          } else {
            step += 1
            acc = 0
            hold = null
            want.push({ type: 'advance', stepIndex: step, wallMs: w })
            arrival(w)
          }
          break
        }
      }
    }
    rows.push({ event: e, before, after: state, effects: r.effects, want, wall: w, asleepBefore, accBefore, startWall, leadMs, kind, scheduled, accAfter: acc })
  }
  for (const s of sc.pre) step1(s, 'pre')
  step1(sc.first, 'first')
  for (const s of sc.rest) step1(s, 'later')
  return { rows, restoredRevealed, initialStep }
}

const revealsOf = (rows: Row[]) => rows.flatMap((r) => r.effects.filter((e): e is Extract<SchedEffect, { type: 'reveal' }> => e.type === 'reveal'))
const assertProp = (f: (sc: Scenario, p: ReturnType<typeof play>) => void) =>
  fc.assert(fc.property(scenario, (sc) => { f(sc, play(sc.plan, sc)) }), { numRuns: RUNS })

describe('P7: each note is revealed exactly once', () => {
  it('the reducer emits the oracle\'s effects for every event', () => {
    assertProp((_sc, { rows }) => {
      for (const r of rows) {
        expect(r.effects).toEqual(r.want)
        if (r.after.status === 'running') expect(elapsedMs(r.after, r.after.lastWall)).toBe(r.accAfter) // the history sum equals the oracle's running clock
      }
    })
  })

  it('P7.1 at most once: no note id appears in two reveals, and a restored note is never revealed', () => {
    assertProp((_sc, { rows, restoredRevealed }) => {
      const ids = revealsOf(rows).map((e) => e.noteId)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of restoredRevealed) expect(ids).not.toContain(id)
    })
  })

  it('P7.2 exactly once when visited: after the flush every note from the initial step to the final step has one reveal; earlier ones none', () => {
    assertProp((sc, { rows, restoredRevealed, initialStep }) => {
      let state = rows.at(-1)!.after
      if (state.status === 'idle') return
      const plan = sc.plan
      const flush: SchedEvent[] = []
      let w = rows.at(-1)!.after.lastWall
      if (state.asleep) flush.push({ type: 'resume', wallMs: (w += 1) })
      flush.push({ type: 'tick', wallMs: (w += 1e10) })
      const effects = revealsOf(rows).map((e) => e.noteId)
      for (const e of flush) {
        const r = reduce(plan, state, e)
        state = r.state
        effects.push(...r.effects.filter((x) => x.type === 'reveal').map((x) => (x as { noteId: string }).noteId))
      }
      plan.steps.forEach((s, i) => {
        if (!s.note) return
        const count = effects.filter((id) => id === s.note!.id).length
        if (i < initialStep) expect(count).toBe(0)
        else if (i <= state.stepIndex) expect(count + (restoredRevealed.includes(s.note.id) ? 1 : 0)).toBe(1)
      })
    })
  })

  it('P7.3 never early: a scheduled reveal has the step clock at or past the check time and the wall at or past the hold; show and wipe reveals come from their events on a pending note', () => {
    assertProp((_sc, { rows }) => {
      for (const r of rows) {
        for (const m of r.scheduled) {
          expect(m.acc).toBeGreaterThanOrEqual(m.check)
          if (m.hold !== null) expect(m.wall).toBeGreaterThanOrEqual(m.hold)
        }
        for (const e of r.effects) {
          if (e.type !== 'reveal') continue
          if (e.cause === 'show') expect(r.event.type).toBe('show')
          if (e.cause === 'wipe') {
            expect(r.event.type).toBe('wipe')
            expect(r.effects.some((x) => x.type === 'advance' || x.type === 'finish')).toBe(true)
          }
        }
      }
    })
  })

  it('P7.4 never skipped: each advance and finish comes with the reveal of the note of the step it leaves', () => {
    assertProp((sc, { rows }) => {
      const seen = new Set<string>()
      for (const r of rows) {
        for (const e of r.effects) {
          if (e.type === 'reveal') seen.add(e.noteId)
          if (e.type === 'advance' || e.type === 'finish') {
            const left = sc.plan.steps[e.type === 'advance' ? e.stepIndex - 1 : r.before.stepIndex]!.note
            if (left) expect(seen.has(left.id) || r.before.revealed.includes(left.id)).toBe(true)
          }
        }
      }
    })
  })

  it('P7.5 asleep means silent, and a reveal due during sleep is emitted by the first awake event at or after the due time', () => {
    assertProp((sc, { rows }) => {
      for (const r of rows) {
        if (r.asleepBefore && r.event.type !== 'resume') expect(r.effects).toEqual([])
        if (r.event.type === 'resume' && r.before.status === 'running') {
          const note = sc.plan.steps[r.before.stepIndex]!.note
          const pending = !!note && !r.before.revealed.includes(note.id)
          const held = r.before.holdUntilWall !== null && r.wall < r.before.holdUntilWall
          if (pending && r.asleepBefore && r.accBefore >= note!.checkAtMs && !held) expect(r.effects.length).toBe(1)
        }
        // after any awake event no pending note is overdue
        if (r.after.status === 'running' && !r.after.asleep && !['setPace', 'start', 'deepLink', 'restore'].includes(r.event.type)) {
          const note = sc.plan.steps[r.after.stepIndex]!.note
          if (note && !r.after.revealed.includes(note.id) && (r.after.holdUntilWall === null || r.wall >= r.after.holdUntilWall)) {
            const w = Math.max(r.after.lastWall, r.wall)
            expect(elapsedMs(r.after, w)).toBeLessThan(note.checkAtMs)
          }
        }
      }
    })
  })

  it('P7.6 order and a monotonic timer: stepIndex never decreases, rises by 1 per advance; elapsed never decreases within a step, for any wall inputs', () => {
    assertProp((_sc, { rows }) => {
      let prevStep = 0
      let prevElapsed = 0
      for (const r of rows) {
        if (r.after.status === 'idle') continue
        const adv = r.effects.filter((e) => e.type === 'advance').length
        expect(r.after.stepIndex).toBe(r.before.status === 'idle' ? r.after.stepIndex : r.before.stepIndex + adv)
        expect(r.after.stepIndex).toBeGreaterThanOrEqual(prevStep)
        const el = elapsedMs(r.after, r.event.wallMs)
        if (r.after.stepIndex === prevStep && r.before.status !== 'idle') expect(el).toBeGreaterThanOrEqual(prevElapsed)
        prevStep = r.after.stepIndex
        prevElapsed = el
      }
    })
  })

  it('P7.7 pace-scaled: nextDueWall is the least wall time at which a tick reveals; one tick before it reveals nothing', () => {
    assertProp((sc, { rows }) => {
      for (const r of rows) {
        const due = nextDueWall(sc.plan, r.after)
        if (due === null) continue
        const t = Math.ceil(due)
        const note = sc.plan.steps[r.after.stepIndex]!.note!
        expect(reveals(sc.plan, r.after, Math.max(t, r.after.lastWall)).length).toBe(1)
        const early = Math.floor(due) - 1
        if (early >= r.after.lastWall && due - 1 >= r.after.lastWall) expect(reveals(sc.plan, r.after, early).length).toBe(0)
        expect(note.checkAtMs).toBeGreaterThanOrEqual(0)
      }
    })
  })

  it('P7.8 deep link: with a step-entry note on the initial step, the first awake event at or after start + lead reveals it and none earlier does', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 20_000 }), fc.integer({ min: 0, max: 7 }), paceArb, fc.array(fc.integer({ min: 0, max: 8_000 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 0, max: 1_000_000 }), (lead, step, pace, gaps, base) => {
        const plan: Plan = { steps: Array.from({ length: 8 }, (_, i) => ({ note: { id: `n${i}`, checkAtMs: 0 } })) }
        let s = reduce(plan, initialState, { type: 'deepLink', wallMs: base, stepIndex: step, leadMs: lead, pace }).state
        const got: number[] = []
        if (lead === 0) got.push(base)
        let w = base
        for (const g of gaps) {
          w += g
          const r = reduce(plan, s, { type: 'tick', wallMs: w })
          s = r.state
          for (const e of r.effects) if (e.type === 'reveal') got.push(e.wallMs)
        }
        const firstAtOrAfter = gaps.reduce<number[]>((acc, g) => [...acc, (acc.at(-1) ?? base) + g], []).find((t) => t >= base + lead)
        if (lead === 0) expect(got).toEqual([base])
        else if (firstAtOrAfter === undefined) expect(got).toEqual([])
        else expect(got).toEqual([firstAtOrAfter])
      }),
      { numRuns: RUNS },
    )
  })

  it('P7.9 show makes the schedule a no-op: after reveal {show} no scheduled reveal of that note follows', () => {
    assertProp((_sc, { rows }) => {
      const shown = new Set<string>()
      for (const e of revealsOf(rows)) {
        expect(shown.has(e.noteId)).toBe(false)
        if (e.cause === 'show') shown.add(e.noteId)
      }
    })
  })

  describe('P7.10 the Wipe table, as named cases', () => {
    const plan: Plan = { steps: [{ note: { id: 'p', checkAtMs: 5_000 } }, { note: null }, { note: { id: 'q', checkAtMs: 0 } }, { note: null }] }
    const at = (stepIndex: number, revealed: string[]): SchedState => ({ ...initialState, status: 'running', stepIndex, revealed, lastWall: 0, paceHistory: [{ atWall: 0, pace: 1 }] })
    it('no note, not last', () => expect(controlFor(plan, at(1, []))).toMatchObject({ label: 'Next step', action: 'wipe', leavesCook: false }))
    it('pending', () => expect(controlFor(plan, at(0, []))).toMatchObject({ label: 'Show the note', action: 'show' }))
    it('revealed, not last', () => expect(controlFor(plan, at(2, ['q']))).toMatchObject({ label: 'Wipe the glass', action: 'wipe', leavesCook: false }))
    it('last step revealed or no note', () => {
      const p: Plan = { steps: [{ note: null }, { note: { id: 'z', checkAtMs: 0 } }] }
      expect(controlFor(p, at(1, ['z']))).toMatchObject({ label: 'The hand, quoted', leavesCook: true })
      expect(controlFor(plan, at(3, []))).toMatchObject({ label: 'The hand, quoted', leavesCook: true })
    })
    it('for generated states: the control matches the table; "show" on a pending note never advances, "wipe" on a revealed note advances exactly one step or finishes', () => {
      assertProp((sc, { rows }) => {
        for (const r of rows) {
          const s = r.after
          if (s.status !== 'running' || s.asleep) continue
          const c = controlFor(sc.plan, s)
          const ns = noteState(sc.plan, s)
          const last = s.stepIndex === sc.plan.steps.length - 1
          if (ns === 'pending') expect(c.action).toBe('show')
          else expect(c.action).toBe('wipe')
          expect(c.leavesCook).toBe(last && ns !== 'pending')
          const w = s.lastWall + 1
          const out = reduce(sc.plan, s, { type: c.action, wallMs: w })
          if (ns === 'pending') {
            expect(out.effects.some((e) => e.type === 'advance' || e.type === 'finish')).toBe(false)
            expect(out.state.stepIndex).toBe(s.stepIndex)
          } else if (out.state.status === 'running') {
            expect(out.state.stepIndex).toBe(s.stepIndex + 1)
          } else {
            expect(last).toBe(true)
            expect(out.effects.some((e) => e.type === 'finish')).toBe(true)
          }
        }
      })
    })
  })

  it('P7.11 only the first event starts: later start, deepLink and restore, and any event after finish, leave the state equal but for lastWall', () => {
    assertProp((_sc, { rows }) => {
      for (const r of rows) {
        if (r.kind === 'pre' && r.before.status === 'idle' && !['start', 'deepLink', 'restore'].includes(r.event.type)) {
          expect(r.after).toEqual(r.before)
          expect(r.effects).toEqual([])
        }
        const startish = ['start', 'deepLink', 'restore'].includes(r.event.type)
        if (r.before.status === 'finished' || (startish && r.before.status === 'running')) {
          expect(r.effects).toEqual([])
          expect({ ...r.after, lastWall: 0 }).toEqual({ ...r.before, lastWall: 0 })
        }
      }
    })
  })
})

function reveals(plan: Plan, s: SchedState, wall: number) {
  return reduce(plan, s, { type: 'tick', wallMs: wall }).effects.filter((e) => e.type === 'reveal')
}
