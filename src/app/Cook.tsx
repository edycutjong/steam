import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { COOK, ANNOUNCE } from '../copy/strings.ts'
import { compose } from '../cook/announce.ts'
import { CUE_COOLDOWN_MS } from '../cook/cue.ts'
import { DEBOUNCE_MS } from '../cook/drag.ts'
import { paneNoteFor } from '../cook/plan.ts'
import { createRevealGate } from '../cook/revealGate.ts'
import { controlFor, noteState, type Control, type Pace, type SchedEffect } from '../cook/scheduler.ts'
import { createWakeLock, type WakeLockNav, type WakeStatus } from '../cook/wakelock.ts'
import type { Clock } from '../cook/clock.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import { parseReading, quoteSegments } from '../data/reading.ts'
import Candle from '../steam/Candle.tsx'
import NightView from '../steam/NightView.tsx'
import type { SteamGlassProps } from '../steam/SteamGlass.tsx'
import { WIPE_MS, type Phase } from '../steam/timeline.ts'
import { useApp } from './AppContext.tsx'
import ArchiveSlip from './components/ArchiveSlip.tsx'
import CountUpTimer from './components/CountUpTimer.tsx'
import DragSurface from './components/DragSurface.tsx'
import FlameKnob from './components/FlameKnob.tsx'
import LampDip, { type LampHandle } from './components/LampDip.tsx'
import MuteButton from './components/MuteButton.tsx'
import PaceBadge from './components/PaceBadge.tsx'
import PaneStage, { type StageApi } from './components/PaneStage.tsx'
import ReadingText, { DisagreeDescription, hasMarks } from './components/ReadingText.tsx'
import StepPanel, { stepReading } from './components/StepPanel.tsx'
import WipeControl from './components/WipeControl.tsx'
import { formatRoute } from './router.ts'
import { useCookSession, type CookRoute } from './useCookSession.ts'
import { useScreen } from './useScreen.ts'
import { usePrefersReducedMotion } from '../steam/useReducedMotion.ts'
import './cook.css'

/** How long an arrival announcement waits for the reveal that came with it, so the two go out as one message (R23.3). */
const MERGE_WAIT_MS = 4000

export interface CookDeps {
  Glass?: ComponentType<SteamGlassProps>
  wakeNav?: WakeLockNav
  clock?: Clock
}

interface Props extends CookDeps {
  recipe: LoadedRecipe
  route: Extract<import('./router.ts').Route, { name: 'cook' }>
}

/** Cook Mode (S3). The route and a "Start again" counter key the session, so either starts a fresh one. */
export default function Cook(props: Props) {
  const [gen, setGen] = useState(0)
  return <CookSession key={`${formatRoute(props.route)}#${gen}`} {...props} restart={() => setGen((g) => g + 1)} />
}

function CookSession({ recipe, route, Glass, wakeNav = typeof navigator === 'undefined' ? undefined : (navigator as WakeLockNav), clock, restart }: Props & { restart: () => void }) {
  const b = recipe.bundle
  const N = b.steps.length
  const { announce, store, audio } = useApp()
  const h1 = useScreen(b.title, false)
  const reduced = usePrefersReducedMotion()
  const stage = useRef<StageApi | null>(null)
  const lamp = useRef<LampHandle>(null)
  const lastCue = useRef(-Infinity)
  const [phases, setPhases] = useState<Record<string, Phase>>({})
  const [ready, setReady] = useState(false)
  const [failedNotes, setFailedNotes] = useState<string[]>([])
  const [wake, setWake] = useState<WakeStatus>('idle')
  const pendingArrival = useRef<{ text: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  const finishing = useRef(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const spanOf = (id: string) => recipe.notes.find((n) => n.id === id)?.span ?? ''

  const flushArrival = (withNote?: string) => {
    const p = pendingArrival.current
    if (!p) return false
    clearTimeout(p.timer)
    pendingArrival.current = null
    announce(withNote ? `${p.text} ${ANNOUNCE.noteHandwritten(withNote)}` : p.text)
    return true
  }
  const holdArrival = (text: string) => {
    flushArrival()
    pendingArrival.current = { text, timer: setTimeout(() => flushArrival(), MERGE_WAIT_MS) }
  }

  // A reveal is applied once its pane is ready and nothing blocks it (R15.7): the write-on starts, the mark is set, the room changes.
  const gate = useMemo(
    () =>
      createRevealGate<{ noteId: string }>((e) => {
        stage.current?.startReveal(e.noteId)
        performance.mark(`cook:reveal:${e.noteId}`)
        const now = performance.now()
        if (now - lastCue.current >= CUE_COOLDOWN_MS) {
          lastCue.current = now
          lamp.current?.dip()
          audio?.duck()
        }
        if (!flushArrival(spanOf(e.noteId))) announce(ANNOUNCE.noteHandwritten(spanOf(e.noteId)))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const onEffects = useCallback(
    (effects: SchedEffect[], ctx: { state: { stepIndex: number } }) => {
      const adv = effects.find((e) => e.type === 'advance')
      const fin = effects.find((e) => e.type === 'finish')
      const revealedNow = effects.filter((e): e is Extract<SchedEffect, { type: 'reveal' }> => e.type === 'reveal')
      if (adv && adv.type === 'advance') {
        const text = compose({ kind: 'wipe', stepIndex: adv.stepIndex, stepCount: N, stepText: stepReading(b, adv.stepIndex) })
        if (revealedNow.some((r) => r.stepIndex === adv.stepIndex)) holdArrival(text)
        else announce(text)
      }
      for (const r of revealedNow) gate.enqueue({ noteId: r.noteId })
      if (fin) {
        finishing.current = true
        // the last sweep plays out, then "The hand, quoted"
        timers.current.push(setTimeout(() => (location.hash = formatRoute({ name: 'quoted', id: b.id })), WIPE_MS))
      }
      void ctx
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gate],
  )

  const session = useCookSession({ recipe, route: route as CookRoute, store, clock, onEffects })
  const { plan, state, started, dispatch } = session

  // The first announcement: how the session began, then the step (and its note, when it reveals with the arrival).
  const announcedStart = useRef(false)
  useEffect(() => {
    if (!plan || !started || announcedStart.current || state.status === 'idle') return
    announcedStart.current = true
    const i = state.stepIndex
    const arrive = compose({ kind: 'arrive', stepIndex: i, stepCount: N, stepText: stepReading(b, i) })
    const head = started === 'deepLink' ? compose({ kind: 'deepLink', stepIndex: i, stepCount: N }) : started === 'restore' ? compose({ kind: 'resume', stepIndex: i, stepCount: N }) : started === 'unknownNote' ? COOK.unknownNote(N) : ''
    const text = head ? `${head} ${arrive}` : arrive
    const note = plan.steps[i]?.note
    if (note && state.revealed.includes(note.id) && started !== 'restore') holdArrival(text)
    else if (note && state.revealed.includes(note.id)) announce(`${text} ${ANNOUNCE.noteHandwritten(spanOf(note.id))}`)
    else announce(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, started, state.status])

  useEffect(() => {
    announce(COOK.loading)
    return () => {
      timers.current.forEach(clearTimeout)
      if (pendingArrival.current) clearTimeout(pendingArrival.current.timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wake lock: held while Cook Mode is visible, released when it closes (R17).
  useEffect(() => {
    const w = createWakeLock(wakeNav)
    const sync = () => setWake(w.status)
    void w.acquire().then(sync)
    sync()
    const onVis = () => {
      if (document.visibilityState === 'visible') void w.onVisible().then(sync)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      w.release()
    }
  }, [wakeNav])

  const stepIndex = state.stepIndex
  const paneNote = plan ? paneNoteFor(plan, stepIndex) : null
  const ns = plan && state.status !== 'idle' ? noteState(plan, state) : 'none'
  const curNote = plan?.steps[stepIndex]?.note?.id ?? null
  const curPhase = curNote ? phases[curNote] : undefined
  const failedHere = curNote !== null && failedNotes.includes(curNote)
  const noteAttr = ns === 'none' ? 'none' : ns === 'pending' ? 'pending' : failedHere ? 'held' : curPhase === 'writing' || curPhase === 'thickening' ? 'writing' : curPhase === 'holding' ? 'held' : curPhase === 'wiped' ? 'wiping' : 'pending'
  // Revealed by the scheduler but not yet held on the glass (the reveal waits for its pane, or is being written): the control
  // keeps its label and does nothing, so no press can wipe a note the cook has not seen (R14.2, R14.7). A note whose scan
  // failed to load counts as shown: its typed transcription is on the glass (R15.12).
  const writing = ns === 'revealed' && noteAttr !== 'held'
  const pace: Pace = state.paceHistory.at(-1)?.pace ?? route.pace
  const control: Control = plan && state.status !== 'idle' ? controlFor(plan, state) : { label: COOK.loading, action: 'show', leavesCook: false }
  // The description of the † marks exists only where a mark is shown: in the step text, or in the typed note of a failed scan.
  const showsMarks = hasMarks(parseReading(stepReading(b, stepIndex))) || (paneNote !== null && failedNotes.includes(paneNote) && hasMarks(quoteSegments(b, recipe.notes.find((n) => n.id === paneNote)!)))
  // The reviewed reading of the note, under the pane, once the hand holds on the glass (look pass 3, R20.3). The glass itself
  // stays the scan's pixels; this is DOM text, hidden from assistive tech because the live region has announced the words.
  const readingNote = ns === 'revealed' && noteAttr === 'held' && paneNote !== null && !failedHere ? (recipe.notes.find((n) => n.id === paneNote) ?? null) : null
  const showSlip = ns === 'revealed' && (noteAttr === 'writing' || noteAttr === 'held')

  const lastAct = useRef(-Infinity)
  const perform = useCallback(
    (c: Control) => {
      if (!plan || state.status !== 'running' || writing || finishing.current) return
      const t = performance.now()
      if (t - lastAct.current < DEBOUNCE_MS) return
      lastAct.current = t
      if (c.action === 'show') dispatch({ type: 'show' })
      else {
        if (noteAttr === 'held') stage.current?.wipe()
        dispatch({ type: 'wipe' })
      }
    },
    [plan, state.status, writing, noteAttr, dispatch],
  )

  const onPace = (p: Pace) => {
    dispatch({ type: 'setPace', pace: p })
    announce(compose({ kind: 'pace', pace: p }))
  }

  const markReady = () => {
    if (ready) return
    setReady(true)
    performance.mark('cook:ready')
  }
  useEffect(() => {
    if (plan && !paneNote) markReady()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, paneNote])

  const startAgain = async () => {
    try {
      await (await store).deleteSession(b.id)
    } catch {
      /* the cook can start again whatever the store does */
    }
    const plain = formatRoute({ ...route, note: null, lead: null })
    if (location.hash !== plain) location.hash = plain
    else restart()
  }

  const caption =
    started === 'deepLink' || started === 'restore' ? (
      <>
        <span>{compose({ kind: started === 'deepLink' ? 'deepLink' : 'resume', stepIndex: state.initialStep, stepCount: N }).replace(/\.$/, '')}</span>
        <button type="button" className="btn btn--quiet" onClick={() => void startAgain()}>
          {COOK.startAgain}
        </button>
      </>
    ) : started === 'unknownNote' ? (
      <span>{COOK.unknownNote(N)}</span>
    ) : null

  return (
    <main
      className="cook"
      data-step={stepIndex + 1}
      data-step-count={N}
      data-note-state={noteAttr}
      data-pace={pace}
      data-ready={ready}
      data-wake={wake}
      data-started-at-step={started && state.status !== 'idle' ? state.initialStep + 1 : undefined}
      data-revealed={state.revealed.join(',')}
      data-reduced-motion={reduced}
    >
      <div className="cook__top">
        <h1 ref={h1} tabIndex={-1} className="cook__title">
          {b.title}
        </h1>
      </div>
      <DragSurface onDrag={() => perform(control)}>
        {plan && state.status !== 'idle' ? (
          <PaneStage
            recipe={recipe}
            noteId={paneNote}
            heldAtMount={started === 'restore' ? state.revealed : []}
            gate={gate}
            fps={route.fps}
            apiRef={stage}
            Glass={Glass}
            onPhase={(n, p) => {
              setPhases((x) => ({ ...x, [n]: p }))
              if (p === 'writing') performance.mark(`cook:write-on:${n}`)
            }}
            onReady={markReady}
            onFailed={(n) => {
              setFailedNotes((f) => (f.includes(n) ? f : [...f, n]))
              markReady()
            }}
          />
        ) : (
          <section className="steam-root pane" aria-hidden="true">
            <NightView />
            <div className="rail rail--meeting" />
            <div className="sash sash--lower"><Candle /></div>
            <div className="rail rail--bottom" />
          </section>
        )}
        <PaceBadge pace={pace} />
      </DragSurface>
      {/* the slot is always in the layout, one line high, so the reading arriving moves nothing (cook-layout-p1d L4) */}
      {readingNote ? (
        <p className="cook__reading" aria-hidden="true" data-note-reading>
          <ReadingText segments={quoteSegments(b, readingNote)} />
        </p>
      ) : (
        <div className="cook__reading" aria-hidden="true" />
      )}
      <div className="cook__under">
        {showSlip ? (
          <div className="cook__source">
            <ArchiveSlip bundle={b} compact />
          </div>
        ) : null}
        <p className="cook__caption">{caption}</p>
      </div>
      <div className="cook__panel">
        <StepPanel bundle={b} stepIndex={stepIndex} />
        <DisagreeDescription show={showsMarks} />
        <div className="cook__side">
          <CountUpTimer plan={plan} state={state} clock={session.clock} pace={pace} />
          <FlameKnob pace={pace} onPace={onPace} />
        </div>
        {session.persistent ? null : <p className="cook__keep">{COOK.noKeep}</p>}
        <div className="controls">
          <a className="btn btn--quiet" href={formatRoute({ name: 'edition', id: b.id })}>
            {COOK.back}
          </a>
          <WipeControl control={control} writing={writing} reduced={reduced} disabled={state.status !== 'running'} ready={ready} onAct={perform} />
          <MuteButton audio={audio} />
        </div>
      </div>
      <LampDip ref={lamp} />
    </main>
  )
}
