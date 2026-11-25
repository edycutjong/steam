// The spike's page: SteamGlass plus its chrome (credit, button, live region, URL reading). Cook Mode uses SteamGlass directly.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReadingText, { DisagreeDescription, hasMarks } from '../app/components/ReadingText.tsx'
import { parseReading } from '../data/reading.ts'
import { parseParams } from './params.ts'
import SteamGlass, { LOAD_FAILED } from './SteamGlass.tsx'
import type { GlassStatus, RevealController } from './SteamGlass.tsx'
import type { Phase, RevealState } from './timeline.ts'
import './steam.css'

export type { RevealController }
export { LOAD_FAILED }
export const CREDIT = 'Wellcome Collection, Public Domain Mark'

const SHOW = 'Show the note'
const WIPE = 'Wipe the glass'
const WRITING = 'Writing…'

export function buttonLabel(phase: Phase): string {
  if (phase === 'writing') return WRITING
  return phase === 'holding' ? WIPE : SHOW
}

/** Space is left alone when focus is inside another interactive element, including our own button. */
function isInteractive(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false
  return el.closest('button, a[href], input, select, textarea, summary, [contenteditable], [role="button"]') !== null
}

export function announcement(text: string): string {
  return `The writer's note, handwritten: ${text}`
}

interface Props {
  stem: string
  paneDir: string
  noteId: string
  /** The hash query without its leading "?" (the harness route), read in place of location. */
  query?: string
}

export default function SteamPane({ stem, paneDir, noteId, query }: Props) {
  const params = useMemo(
    () => (typeof window === 'undefined' ? parseParams('', '') : query !== undefined ? parseParams('', `#/?${query}`) : parseParams(window.location.search, window.location.hash)),
    [query],
  )
  const [phase, setPhase] = useState<Phase>('fogged')
  const [status, setStatus] = useState<GlassStatus>('loading')
  const [announced, setAnnounced] = useState('')
  const [noteText, setNoteText] = useState('')
  const [reading, setReading] = useState('')
  const ctlRef = useRef<RevealController | null>(null)
  const phaseRef = useRef<Phase>('fogged')
  const frozen = params.t !== null
  const handleState = useCallback((st: RevealState): void => {
    phaseRef.current = st.phase
    setPhase(st.phase)
  }, [])

  // The announced words are the note's span (R23.3), from its own JSON.
  useEffect(() => {
    let live = true
    fetch(`${stem}.json`)
      .then((r) => r.json())
      .then((j: { span?: string; shownText?: string }) => {
        if (!live) return
        setNoteText(j.span ?? j.shownText ?? '')
        setReading(j.shownText ?? j.span ?? '')
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [stem])

  const segments = useMemo(() => parseReading(reading), [reading])

  const act = useCallback((): void => {
    const ctl = ctlRef.current
    const p = phaseRef.current
    if (!ctl || frozen || p === 'writing' || p === 'thickening') return
    if (p === 'holding') ctl.wipe()
    else ctl.startReveal()
  }, [frozen])

  // Space triggers the same action, unless focus is inside an interactive element.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || e.repeat || isInteractive(e.target)) return
      e.preventDefault()
      act()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [act])

  // Live region: set when the write-on starts, cleared on replay so it is announced again.
  useEffect(() => {
    if (phase === 'writing' && noteText) setAnnounced(announcement(noteText))
    else if (phase === 'fogged' || phase === 'thickening') setAnnounced('')
  }, [phase, noteText])

  return (
    <section className="steam-root" aria-label="Steamed window">
      <SteamGlass stem={stem} paneDir={paneDir} noteId={noteId} params={params} controllerRef={ctlRef} onState={handleState} onStatus={setStatus} showError={false} />
      <div className="steam-foot">
        {status === 'error' ? <p className="load-error">{LOAD_FAILED}</p> : null}
        <p className="credit">{CREDIT}</p>
        {phase === 'holding' && reading ? (
          <p className="note-reading" aria-hidden="true" data-note-reading>
            <ReadingText segments={segments} />
          </p>
        ) : null}
        <button
          type="button"
          className="wipe-btn"
          aria-disabled={phase === 'writing' || frozen || status === 'loading' || status === 'error' ? true : undefined}
          onClick={act}
        >
          {buttonLabel(phase)}
        </button>
      </div>
      <DisagreeDescription show={phase === 'holding' && hasMarks(segments)} />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announced}
      </div>
    </section>
  )
}
