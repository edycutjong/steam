// The steamed window: sash frame, upper sash, the canvas (or its static fallback), credit and load errors.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadNoteAssets } from './assets.ts'
import type { NoteAssets } from './assets.ts'
import { derive } from './derive.ts'
import type { Derived } from './derive.ts'
import { chooseLayout, computeLayout } from './layout.ts'
import { parseParams } from './params.ts'
import { SteamRenderer } from './renderer.ts'
import StaticPane from './StaticPane.tsx'
import type { Phase, RevealState } from './timeline.ts'
import './steam.css'

export const NOTE_STEM = '/hero/note-looks-red-smooth'
export const CREDIT = 'Wellcome Collection, Public Domain Mark'
export const LOAD_FAILED = 'The note could not be loaded.'

interface Loaded {
  assets: NoteAssets
  derived: Derived
}

/** What the button and the Space key drive. Implemented by the live renderer. */
export interface RevealController {
  startReveal(): void
  wipe(): void
}

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

type Status = 'loading' | 'ready' | 'error' | 'fallback'

/** True while the user prefers reduced motion. Re-evaluated when the preference changes. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (): void => setReduced(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export default function SteamPane({ stem = NOTE_STEM }: { stem?: string }) {
  const params = useMemo(() => parseParams(window.location.search, window.location.hash), [])
  const reducedMotion = usePrefersReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [contextLost, setContextLost] = useState(false)
  const [noWebGl, setNoWebGl] = useState(false)
  const [phase, setPhase] = useState<Phase>('fogged')
  const [announced, setAnnounced] = useState('')
  const ctlRef = useRef<RevealController | null>(null)
  const phaseRef = useRef<Phase>('fogged')
  const fpsRef = useRef<HTMLDivElement>(null)
  const frozen = params.t !== null
  const handleState = useCallback((st: RevealState): void => {
    phaseRef.current = st.phase
    setPhase(st.phase)
  }, [])
  const noteText = loaded?.assets.meta.text ?? ''

  // Load, validate and derive once.
  useEffect(() => {
    const ctl = new AbortController()
    loadNoteAssets(stem, ctl.signal)
      .then((assets) => {
        if (ctl.signal.aborted) return
        setLoaded({ assets, derived: derive(assets.toi, assets.noteData) })
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        console.error('steam: could not load the note', e)
        setFailed(true)
      })
    return () => ctl.abort()
  }, [stem])

  const useStatic = reducedMotion || noWebGl || contextLost
  const status: Status = failed ? 'error' : useStatic ? 'fallback' : loaded ? 'ready' : 'loading'

  // Create the renderer once assets are in and the live path is selected.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!loaded || !canvas || status !== 'ready') return
    const { assets, derived } = loaded
    const meta = assets.meta
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const layout = computeLayout(chooseLayout(w), w, h, meta)
    const renderer = SteamRenderer.create(
      canvas,
      { meta, note: assets.note, derived },
      layout,
      { dprCap: 2, frozenT: params.t, lead: params.lead },
    )
    if (!renderer) {
      setNoWebGl(true)
      return
    }
    renderer.resize(w, h, layout)
    ctlRef.current = renderer
    renderer.onState(handleState)
    let fpsTimer = 0
    if (params.fps) {
      renderer.resetStats()
      fpsTimer = window.setInterval(() => {
        const el = fpsRef.current
        const { frames, sumMs, worstMs, over } = renderer.stats
        if (!el || frames === 0 || sumMs === 0) return
        el.textContent = `${((frames * 1000) / sumMs).toFixed(1)} fps  worst ${worstMs.toFixed(1)} ms  over 18.2 ms: ${over}`
      }, 250)
    }
    renderer.onContextLost(() => setContextLost(true))
    if (params.t !== null) renderer.setClock(params.t)
    renderer.play()

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box || box.width < 1 || box.height < 1) return
      renderer.resize(box.width, box.height, computeLayout(chooseLayout(box.width), box.width, box.height, meta))
    })
    ro.observe(canvas)
    return () => {
      window.clearInterval(fpsTimer)
      ro.disconnect()
      ctlRef.current = null
      renderer.dispose()
    }
  }, [loaded, status, params, handleState])

  const act = useCallback((): void => {
    const ctl = ctlRef.current
    const p = phaseRef.current
    if (!ctl || frozen || p === 'writing') return
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
      <div className="sash sash--upper">
        <div className="moon" />
      </div>
      <div className="rail rail--meeting" />
      <div className="sash sash--lower">
        {status === 'fallback' || status === 'error' ? (
          <StaticPane params={params} controllerRef={ctlRef} onState={handleState} fogOnly={status === 'error'} />
        ) : (
          <canvas ref={canvasRef} className="steam-canvas" aria-hidden="true" />
        )}
        {params.fps ? <div ref={fpsRef} className="fps" /> : null}
      </div>
      <div className="rail rail--bottom" />
      <div className="steam-foot">
        {status === 'error' ? <p className="load-error">{LOAD_FAILED}</p> : null}
        <p className="credit">{CREDIT}</p>
        <button
          type="button"
          className="wipe-btn"
          aria-disabled={phase === 'writing' || frozen || status === 'loading' || status === 'error' ? true : undefined}
          onClick={act}
        >
          {buttonLabel(phase)}
        </button>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announced}
      </div>
    </section>
  )
}
