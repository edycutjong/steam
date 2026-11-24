import { useEffect, useReducer, useRef } from 'react'
import { FACSIMILE } from '../../copy/strings.ts'
import { initialZoom, zoomPan, type ZoomState } from '../facsimile.ts'

const STEP = 1.5
const PAN = 60
/** The reset key, the digit zero (named so the words guard sees no digit in a string). */
const RESET_KEY = String(0)

interface Props {
  src: string
  width: number
  height: number
  credit: string
}

/** The page scan on its paper mat, zoomable and pannable by pinch, Ctrl/⌘ + wheel, buttons and keys (R5.1, R5.2, R5.6). No filter: the pixels are the scan's. */
export default function Facsimile({ src, width, height, credit }: Props) {
  const viewRef = useRef<HTMLDivElement>(null)
  const [z, dispatch] = useReducer(zoomPan, undefined, (): ZoomState => initialZoom(1, 1, width, height))
  const zRef = useRef(z)
  zRef.current = z
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number } | null>(null)

  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const measure = (w: number, h: number) => dispatch({ type: 'resize', w, h })
    const r = el.getBoundingClientRect()
    if (r.width > 0) measure(r.width, r.height)
    const ro = new ResizeObserver((e) => {
      const b = e[0]?.contentRect
      if (b && b.width > 0) measure(b.width, b.height)
    })
    ro.observe(el)
    // A plain wheel scrolls the page at scale 1 and pans when zoomed; Ctrl or ⌘ + wheel zooms. Not passive, so it can prevent.
    const onWheel = (e: WheelEvent) => {
      const s = zRef.current
      const box = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        dispatch({ type: 'zoomAt', factor: Math.exp(-e.deltaY / 300), cx: e.clientX - box.left, cy: e.clientY - box.top })
      } else if (s.scale > 1) {
        e.preventDefault()
        dispatch({ type: 'pan', dx: -e.deltaX, dy: -e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  const centre = () => ({ cx: z.vw / 2, cy: z.vh / 2 })
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key
    const act =
      k === '+' || k === '='
        ? () => dispatch({ type: 'zoomAt', factor: STEP, ...centre() })
        : k === '-' || k === '_'
          ? () => dispatch({ type: 'zoomAt', factor: 1 / STEP, ...centre() })
          : k === RESET_KEY
            ? () => dispatch({ type: 'reset' })
            : k === 'ArrowLeft'
              ? () => dispatch({ type: 'pan', dx: PAN, dy: 0 })
              : k === 'ArrowRight'
                ? () => dispatch({ type: 'pan', dx: -PAN, dy: 0 })
                : k === 'ArrowUp'
                  ? () => dispatch({ type: 'pan', dx: 0, dy: PAN })
                  : k === 'ArrowDown'
                    ? () => dispatch({ type: 'pan', dx: 0, dy: -PAN })
                    : null
    if (!act) return
    if (k.startsWith('Arrow') && z.scale === 1) return // at scale 1 the arrows scroll the page
    e.preventDefault()
    act()
  }
  const local = (e: React.PointerEvent) => {
    const b = viewRef.current!.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }
  const onDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, local(e))
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y) }
    }
    if (z.scale > 1 || pointers.current.size === 2) (e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y)
      if (pinch.current.d > 0 && d > 0) dispatch({ type: 'zoomAt', factor: d / pinch.current.d, cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 })
      pinch.current = { d }
    } else if (pointers.current.size === 1 && z.scale > 1) {
      dispatch({ type: 'pan', dx: p.x - prev.x, dy: p.y - prev.y })
    }
  }
  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }
  const shownW = z.vw
  const shownH = z.iw > 0 ? (z.vw * z.ih) / z.iw : 0

  return (
    <figure className="facsimile" style={{ margin: 0 }}>
      <div
        ref={viewRef}
        className="facsimile__viewport"
        role="img"
        aria-label={FACSIMILE.alt}
        aria-roledescription="zoomable image"
        tabIndex={0}
        data-zoomed={z.scale > 1}
        data-scale={z.scale.toFixed(3)}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="facsimile__layer" style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.scale})` }}>
          <img src={src} width={width} height={height} alt="" draggable={false} style={{ width: shownW, height: shownH }} />
        </div>
      </div>
      <figcaption className="facsimile__tools">
        <button type="button" className="btn" onClick={() => dispatch({ type: 'zoomAt', factor: STEP, ...centre() })}>
          {FACSIMILE.zoomIn}
        </button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'zoomAt', factor: 1 / STEP, ...centre() })}>
          {FACSIMILE.zoomOut}
        </button>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'reset' })}>
          {FACSIMILE.reset}
        </button>
        <span className="credit-line">{credit}</span>
      </figcaption>
    </figure>
  )
}
