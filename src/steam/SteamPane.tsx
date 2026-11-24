// The steamed window: sash frame, upper sash, the canvas (or its static fallback), credit and load errors.
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadNoteAssets } from './assets.ts'
import type { NoteAssets } from './assets.ts'
import { derive } from './derive.ts'
import type { Derived } from './derive.ts'
import { chooseLayout, computeLayout } from './layout.ts'
import { parseParams } from './params.ts'
import { SteamRenderer } from './renderer.ts'
import './steam.css'

export const NOTE_STEM = '/hero/note-looks-red-smooth'
export const CREDIT = 'Wellcome Collection, Public Domain Mark'
export const LOAD_FAILED = 'The note could not be loaded.'

interface Loaded {
  assets: NoteAssets
  derived: Derived
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
      ro.disconnect()
      renderer.dispose()
    }
  }, [loaded, status, params])

  return (
    <section className="steam-root" aria-label="Steamed window">
      <div className="sash sash--upper">
        <div className="moon" />
      </div>
      <div className="rail rail--meeting" />
      <div className="sash sash--lower">
        {status !== 'fallback' && <canvas ref={canvasRef} className="steam-canvas" aria-hidden="true" />}
      </div>
      <div className="rail rail--bottom" />
      <div className="steam-foot">
        {status === 'error' ? <p className="load-error">{LOAD_FAILED}</p> : null}
        <p className="credit">{CREDIT}</p>
      </div>
    </section>
  )
}
