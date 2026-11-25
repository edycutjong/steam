// The steamed glass: sash frame, upper sash, the canvas (or its static fallback) and the load error.
// It reads nothing from the URL; whoever mounts it hands it `params`. SteamPane adds the chrome of the spike (credit, button, live region);
// Cook Mode drives it through `controllerRef`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { loadNoteAssets } from './assets.ts'
import type { NoteAssets, NoteCheck } from './assets.ts'
import { derive } from './derive.ts'
import { buildSplits } from './gaps.ts'
import type { Derived } from './derive.ts'
import Candle from './Candle.tsx'
import { chooseLayout, computeLayout } from './layout.ts'
import NightView from './NightView.tsx'
import type { Haunt } from './NightView.tsx'
import type { Layout } from './layout.ts'
import type { SteamParams } from './params.ts'
import { SteamRenderer } from './renderer.ts'
import StaticPane from './StaticPane.tsx'
import { WRITE_ON_MS } from './timeline.ts'
import type { RevealState } from './timeline.ts'
import { usePrefersReducedMotion } from './useReducedMotion.ts'
import './steam.css'

export const LOAD_FAILED = 'The note could not be loaded.'

export interface Loaded {
  assets: NoteAssets
  derived: Derived
}

/** What the button, the Space key and Cook Mode drive. Implemented by the live renderer and by the static pane. */
export interface RevealController {
  startReveal(): void
  wipe(): void
}

export type GlassStatus = 'loading' | 'ready' | 'error' | 'fallback'

export interface SteamGlassProps {
  /** URL of the note's three files without extension: `<stem>.json`, `<stem>.png`, `<stem>.toi.png`. */
  stem: string
  /** Folder and id of the StaticPane images (`<paneDir>/<noteId>-<kind>-<state>.webp`). */
  paneDir: string
  noteId: string
  params: SteamParams
  controllerRef: RefObject<RevealController | null>
  onState?: (s: RevealState) => void
  /** Called once, when the first frame is drawn or the static images are decoded. */
  onReady?: () => void
  /** `held` starts the pane already holding, without replaying the write-on. */
  initial?: 'fogged' | 'held'
  /** Checks the note's own JSON against the bundle (R15.3). */
  check?: NoteCheck
  /** Already decoded and derived (Cook Mode prepares notes ahead). */
  prepared?: Loaded | Promise<Loaded>
  /** Called once with the error when the note cannot be loaded. */
  onError?: (e: unknown) => void
  onStatus?: (s: GlassStatus) => void
  /** Show the `LOAD_FAILED` text on the glass. Default true. */
  showError?: boolean
}

/** Test-only: the placement in use, read by the e2e specs from `data-layout` on the canvas. */
function publishLayout(canvas: HTMLCanvasElement, layout: Layout): void {
  canvas.dataset.layout = JSON.stringify({
    kind: layout.kind,
    fits: layout.fits,
    groups: layout.groups.map((g) => ({ index: g.index, part: g.part, rect: g.rect, dst: g.dst, inked: g.inked, scale: g.scale, coreBandCssPx: g.coreBandCssPx })),
  })
}

export default function SteamGlass({ stem, paneDir, noteId, params, controllerRef, onState, onReady, initial = 'fogged', check, prepared, onError, onStatus, showError = true }: SteamGlassProps) {
  const reducedMotion = usePrefersReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [contextLost, setContextLost] = useState(false)
  const [noWebGl, setNoWebGl] = useState(false)
  const readyOnce = useRef(false)
  const latest = useRef({ onState, onReady, onError, onStatus })
  latest.current = { onState, onReady, onError, onStatus }
  const { t, lead: paramLead, fps, bloom } = params
  // A held pane has its reveal clock started a whole write-on ago, so its first frame is `holding` (R15.4).
  const effective = useMemo<SteamParams>(() => (initial === 'held' ? { t: null, lead: -WRITE_ON_MS, fps, bloom } : { t, lead: paramLead, fps, bloom }), [initial, t, paramLead, fps, bloom])
  // The last state the pane reported and when, so a static pane that replaces a lost live one carries on from it (Q8).
  const lastState = useRef<{ state: RevealState; at: number } | null>(null)
  const [haunt, setHaunt] = useState<Haunt>(initial === 'held' ? 'clear' : 'calm')
  const pushState = useCallback((s: RevealState): void => {
    lastState.current = { state: s, at: performance.now() }
    const h: Haunt = s.phase === 'fogged' ? 'calm' : s.phase === 'thickening' || s.phase === 'writing' ? 'gather' : 'clear'
    setHaunt((prev) => (prev === h ? prev : h))
    latest.current.onState?.(s)
  }, [])
  const fpsRef = useRef<HTMLDivElement>(null)

  const markReady = (): void => {
    if (readyOnce.current) return
    readyOnce.current = true
    latest.current.onReady?.()
  }

  // Load, validate and derive once per note.
  useEffect(() => {
    const ctl = new AbortController()
    readyOnce.current = false
    setLoaded(null)
    setFailed(false)
    const work: Promise<Loaded> = prepared
      ? Promise.resolve(prepared)
      : loadNoteAssets(stem, check, ctl.signal).then((assets) => {
          const start = performance.now()
          const derived = derive(assets.toi, assets.noteData)
          // Read by scripts/measure-steam.ts (R15.5: the one-time derivation against its 50 ms budget).
          performance.measure('steam:derive', { start, end: performance.now() })
          return { assets, derived }
        })
    work
      .then((l) => {
        if (!ctl.signal.aborted) setLoaded(l)
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return
        console.error('steam: could not load the note', e)
        setFailed(true)
        latest.current.onError?.(e)
      })
    return () => ctl.abort()
    // `check` and `prepared` are identity-stable for a note; the stem names it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stem])

  const useStatic = reducedMotion || noWebGl || contextLost
  const status: GlassStatus = failed ? 'error' : useStatic ? 'fallback' : loaded ? 'ready' : 'loading'
  useEffect(() => latest.current.onStatus?.(status), [status])

  // Create the renderer once assets are in and the live path is selected.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!loaded || !canvas || status !== 'ready') return
    const { assets, derived } = loaded
    const meta = assets.meta
    const p = effective
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const splits = buildSplits({ ink: derived.ink, toi: assets.toi.data, width: meta.size[0], height: meta.size[1], groups: meta.groups })
    const layout = computeLayout(chooseLayout(w), w, h, meta, splits)
    const renderer = SteamRenderer.create(canvas, { meta, note: assets.note, derived }, layout, { dprCap: 2, frozenT: p.t, lead: p.lead, bloom: p.bloom })
    if (!renderer) {
      setNoWebGl(true)
      return
    }
    renderer.resize(w, h, layout)
    publishLayout(canvas, layout)
    controllerRef.current = renderer
    renderer.onState(pushState)
    const measureCandle = (): void => {
      const candle = canvas.parentElement?.querySelector('.candle')
      if (!candle) return
      const c = candle.getBoundingClientRect()
      const g = canvas.getBoundingClientRect()
      if (g.width < 1 || g.height < 1) return
      renderer.setCandle((c.left + c.width / 2 - g.left) / g.width, (c.top - 6 - g.top) / g.height)
    }
    measureCandle()
    let fpsTimer = 0
    if (p.fps) {
      renderer.resetStats()
      fpsTimer = window.setInterval(() => {
        const el = fpsRef.current
        const { frames, sumMs, worstMs, over } = renderer.stats
        if (!el || frames === 0 || sumMs === 0) return
        el.textContent = `${((frames * 1000) / sumMs).toFixed(1)} fps  worst ${worstMs.toFixed(1)} ms  over 18.2 ms: ${over}  tier ${renderer.tier}`
      }, 250)
    }
    renderer.onContextLost(() => setContextLost(true))
    // governor tier 3: the static images, at the current phase, through the lost-context path
    renderer.onDegrade(() => setContextLost(true))
    if (p.t !== null) renderer.setClock(p.t)
    renderer.play()
    // Ready once the first frame is on screen: two animation frames after play().
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(markReady)
    })

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (!box || box.width < 1 || box.height < 1) return
      const next = computeLayout(chooseLayout(box.width), box.width, box.height, meta, splits)
      renderer.resize(box.width, box.height, next)
      publishLayout(canvas, next)
      measureCandle()
    })
    ro.observe(canvas)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearInterval(fpsTimer)
      ro.disconnect()
      controllerRef.current = null
      renderer.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, status])

  return (
    <>
      <NightView haunt={haunt} />
      <div className="rail rail--meeting" />
      <div className="sash sash--lower">
        {status === 'fallback' || status === 'error' ? (
          <StaticPane
            params={effective}
            paneDir={paneDir}
            noteId={noteId}
            controllerRef={controllerRef}
            onState={pushState}
            onReady={markReady}
            fogOnly={status === 'error'}
            resume={contextLost ? lastState.current : null}
          />
        ) : (
          <canvas ref={canvasRef} className="steam-canvas" aria-hidden="true" />
        )}
        <Candle haunt={haunt} />
        {fps ? <div ref={fpsRef} className="fps" /> : null}
        {status === 'error' && showError ? <p className="load-error load-error--glass">{LOAD_FAILED}</p> : null}
      </div>
      <div className="rail rail--bottom" />
    </>
  )
}
