import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react'
import { COOK } from '../../copy/strings.ts'
import type { createRevealGate } from '../../cook/revealGate.ts'
import { quoteSegments } from '../../data/reading.ts'
import type { LoadedRecipe } from '../../data/catalog.ts'
import { createPreparer, type Preparer } from '../../steam/prepare.ts'
import SteamGlass, { type RevealController, type SteamGlassProps } from '../../steam/SteamGlass.tsx'
import { WIPE_MS, type Phase } from '../../steam/timeline.ts'
import ReadingText from './ReadingText.tsx'

export const CROSSFADE_MS = 600

export interface StageApi {
  startReveal(noteId: string): boolean
  wipe(): void
}

type Gate = ReturnType<typeof createRevealGate<{ noteId: string }>>

interface Props {
  recipe: LoadedRecipe
  /** The pane's note for the current step (paneNoteFor), or null when the recipe has none. */
  noteId: string | null
  /** Notes already revealed when the screen opened (a restore): their pane starts held (R15.4). */
  heldAtMount: readonly string[]
  gate: Gate
  fps?: boolean
  apiRef: RefObject<StageApi | null>
  onPhase?: (noteId: string, phase: Phase) => void
  onReady?: (noteId: string) => void
  onFailed?: (noteId: string) => void
  /** Injected in tests: a stand-in for SteamGlass. */
  Glass?: ComponentType<SteamGlassProps>
  preparer?: Preparer
}

interface PaneEntry {
  noteId: string
  key: number
  leaving: boolean
  gone: boolean
}

let seq = 0

/** The stage: the pane of the current note and, for the length of its sweep and a 600 ms crossfade, the outgoing one (R15.4 to R15.7, R15.11, R15.12). */
export default function PaneStage({ recipe, noteId, heldAtMount, gate, fps = false, apiRef, onPhase, onReady, onFailed, Glass = SteamGlass, preparer }: Props) {
  const id = recipe.bundle.id
  const prep = useMemo(() => preparer ?? createPreparer(), [preparer])
  const [panes, setPanes] = useState<PaneEntry[]>(() => (noteId ? [{ noteId, key: ++seq, leaving: false, gone: false }] : []))
  const [failed, setFailed] = useState<string[]>([])
  const controllers = useRef(new Map<string, RefObject<RevealController | null>>())
  const phases = useRef(new Map<string, Phase>())
  const held = useRef(new Set(heldAtMount))
  const latest = useRef({ onPhase, onReady, onFailed })
  latest.current = { onPhase, onReady, onFailed }
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const writing = () => [...phases.current.values()].some((p) => p === 'writing')

  const refFor = (n: string) => {
    let r = controllers.current.get(n)
    if (!r) controllers.current.set(n, (r = { current: null }))
    return r
  }
  const noteOf = (n: string) => recipe.notes.find((x) => x.id === n)!
  const stem = (n: string) => `/recipes/${id}/note-${n}`

  // The note changed: the old pane leaves once its sweep has run (WIPE_MS after it entered 'wiped'), then fades out.
  useEffect(() => {
    setPanes((ps) => {
      const cur = ps.find((p) => !p.leaving)
      if (cur?.noteId === noteId) return ps
      const next = ps.map((p) => (p.leaving ? p : { ...p, leaving: true }))
      if (noteId) next.push({ noteId, key: ++seq, leaving: false, gone: false })
      return next
    })
  }, [noteId])

  const leaving = panes.filter((p) => p.leaving && !p.gone)
  useEffect(() => {
    if (leaving.length === 0) return
    gate.setBlocked(true)
    gate.setReady(null)
    const p = leaving[0]!
    const ph = phases.current.get(p.noteId)
    const swept = ph === 'wiped' || ph === 'holding' ? WIPE_MS : 0
    const t1 = setTimeout(() => {
      setPanes((ps) => ps.map((x) => (x.key === p.key ? { ...x, gone: true } : x)))
      gate.setBlocked(false)
      const cur = panes.find((x) => !x.leaving)
      if (cur && phases.current.has(`ready:${cur.noteId}`)) gate.setReady(cur.noteId)
      const t2 = setTimeout(() => setPanes((ps) => ps.filter((x) => x.key !== p.key)), CROSSFADE_MS)
      timers.current.push(t2)
    }, swept)
    timers.current.push(t1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving.map((p) => p.key).join(',')])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  apiRef.current = {
    startReveal: (n) => {
      const c = controllers.current.get(n)?.current
      if (!c) return false
      c.startReveal()
      return true
    },
    wipe: () => {
      const cur = panes.find((p) => !p.leaving)
      if (cur) controllers.current.get(cur.noteId)?.current?.wipe()
    },
  }

  const handleReady = useCallback((n: string) => {
    phases.current.set(`ready:${n}`, 'fogged')
    const isCurrent = n === noteIdRef.current
    if (isCurrent) gate.setReady(n)
    latest.current.onReady?.(n)
  }, [gate])
  const noteIdRef = useRef(noteId)
  noteIdRef.current = noteId

  // Prepare the other notes in idle time once the first pane is ready, never while one is writing (R15.11).
  const [firstReady, setFirstReady] = useState(false)
  useEffect(() => {
    if (!firstReady) return
    const queue = recipe.notes.filter((n) => n.id !== noteId).map((n) => ({ stem: stem(n.id), check: { noteId: n.id, size: n.size } }))
    return prep.prepareInIdle(queue, writing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstReady])

  if (!noteId && panes.length === 0) {
    return <section className="steam-root pane pane--empty" aria-hidden="true"><div className="sash sash--upper"><div className="moon" /></div><div className="rail rail--meeting" /><div className="sash sash--lower" /><div className="rail rail--bottom" /></section>
  }

  return (
    <>
      {panes.map((p) => {
        const n = noteOf(p.noteId)
        const initial = held.current.has(p.noteId) ? 'held' : 'fogged'
        return (
          <section key={p.key} className={`steam-root pane ${p.leaving ? 'pane--leaving' : ''} ${p.gone ? 'pane--gone' : ''}`} aria-hidden="true" data-note={p.noteId} data-leaving={p.leaving}>
            <Glass
              stem={stem(p.noteId)}
              paneDir={`/recipes/${id}/panes`}
              noteId={p.noteId}
              params={{ t: null, lead: Infinity, fps }}
              initial={initial}
              check={{ noteId: n.id, size: n.size }}
              prepared={prep.prepare(stem(p.noteId), { noteId: n.id, size: n.size })}
              controllerRef={refFor(p.noteId)}
              showError={false}
              onState={(s) => {
                if (phases.current.get(p.noteId) !== s.phase) {
                  phases.current.set(p.noteId, s.phase)
                  latest.current.onPhase?.(p.noteId, s.phase)
                }
              }}
              onReady={() => {
                handleReady(p.noteId)
                setFirstReady(true)
              }}
              onError={() => {
                gate.drop(p.noteId)
                setFailed((f) => (f.includes(p.noteId) ? f : [...f, p.noteId]))
                latest.current.onFailed?.(p.noteId)
                setFirstReady(true)
              }}
            />
          </section>
        )
      })}
      {noteId && failed.includes(noteId) ? (
        <div className="stage__failed" role="note">
          <p>{COOK.scanFailed}</p>
          <p className="typed">
            <ReadingText segments={quoteSegments(recipe.bundle, noteOf(noteId))} />
          </p>
          <span className="typed__label">{COOK.typedTranscription}</span>
        </div>
      ) : null}
    </>
  )
}
