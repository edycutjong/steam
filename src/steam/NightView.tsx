// The upper sash (steam-renderer-v1 design §7.1): the night outside. SVG gradients and filters only, no raster, no simulation.
// `--night` sky, faint stars, a low full moon with halo and maria, seeded bare branches crossing it, a thin cloud, and a muntin
// that splits the sash into two panes. `haunt` drives the cue by CSS: the cloud slides over the moon and comes off again.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { branchPaths, NIGHT_H, NIGHT_W, prng } from './branches.ts'
import type { Haunt } from './haunt.ts'

export type { Haunt } from './haunt.ts'

export const MOON = { x: 760, y: 196, r: 58 }
export const STAR_COUNT = 22
/** The moon disc plus a 12 % margin must stay inside the visible part of the night. */
const MOON_TOP = MOON.y - MOON.r * 1.12
const MOON_BOTTOM = MOON.y + MOON.r * 1.12

/**
 * The part of the night's coordinate box that a pane of `w` x `h` css px shows. It fills the pane (slice, anchored low),
 * except that the top is never lower than the moon's top, so a wide, short pane crops the sky and the branches and never
 * the moon. Pure; the moon stays inside for any pane whose visible height is at least the moon's.
 */
export function nightViewBox(w: number, h: number): [number, number, number, number] {
  const s = Math.max(w / NIGHT_W, h / NIGHT_H)
  const vw = w / s
  const vh = h / s
  const x0 = (NIGHT_W - vw) / 2
  let y0 = NIGHT_H - vh
  if (y0 > MOON_TOP) y0 = MOON_TOP
  if (y0 + vh < MOON_BOTTOM) y0 = MOON_BOTTOM - vh
  return [x0, y0, vw, vh]
}
const BRANCH_SEED = 1750

export function stars(seed: number): { x: number; y: number; r: number; o: number }[] {
  const rnd = prng(seed)
  const out: { x: number; y: number; r: number; o: number }[] = []
  while (out.length < STAR_COUNT) {
    const x = 20 + rnd() * (NIGHT_W - 40)
    const y = 8 + rnd() * 190
    if (Math.hypot(x - MOON.x, y - MOON.y) < MOON.r * 2.2) continue
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, r: Math.round((0.6 + rnd() * 0.8) * 10) / 10, o: Math.round((0.15 + rnd() * 0.45) * 100) / 100 })
  }
  return out
}

export default function NightView({ haunt = 'calm' }: { haunt?: Haunt }) {
  const layers = useMemo(() => branchPaths(BRANCH_SEED), [])
  const starList = useMemo(() => stars(BRANCH_SEED + 1), [])
  const svgRef = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState<[number, number, number, number] | null>(null)
  useLayoutEffect(() => {
    const el = svgRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setBox(nightViewBox(r.width, r.height))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="sash sash--upper" data-haunt={haunt}>
      <svg
        ref={svgRef}
        className="night"
        viewBox={box ? box.map((v) => Math.round(v * 100) / 100).join(' ') : `0 0 ${NIGHT_W} ${NIGHT_H}`}
        preserveAspectRatio={box ? 'xMidYMid slice' : 'xMidYMax slice'}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="night-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="night__sky-top" />
            <stop offset="1" className="night__sky-low" />
          </linearGradient>
          <radialGradient id="night-halo" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" className="night__halo-in" />
            <stop offset="0.35" className="night__halo-mid" />
            <stop offset="1" className="night__halo-out" />
          </radialGradient>
          <radialGradient id="night-disc" cx="0.4" cy="0.38" r="0.7">
            <stop offset="0" className="night__disc-in" />
            <stop offset="0.7" className="night__disc-mid" />
            <stop offset="1" className="night__disc-out" />
          </radialGradient>
          <clipPath id="night-clip">
            <circle cx={MOON.x} cy={MOON.y} r={MOON.r} />
          </clipPath>
          <filter id="night-soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
          <filter id="night-cloud" x="-30%" y="-80%" width="160%" height="260%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
        </defs>
        <rect className="night__sky" x="0" y="0" width={NIGHT_W} height={NIGHT_H} fill="url(#night-sky)" />
        <g className="night__stars">
          {starList.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />
          ))}
        </g>
        <g className="night__moon">
          <circle cx={MOON.x} cy={MOON.y} r={MOON.r * 3.1} fill="url(#night-halo)" />
          <circle className="moon" cx={MOON.x} cy={MOON.y} r={MOON.r} fill="url(#night-disc)" />
          <g clipPath="url(#night-clip)" filter="url(#night-soft)" className="night__maria">
            <ellipse cx={MOON.x - 20} cy={MOON.y - 14} rx="19" ry="14" />
            <ellipse cx={MOON.x + 14} cy={MOON.y - 24} rx="13" ry="9" />
            <ellipse cx={MOON.x + 10} cy={MOON.y + 12} rx="22" ry="12" transform={`rotate(-18 ${MOON.x + 10} ${MOON.y + 12})`} />
            <ellipse cx={MOON.x - 12} cy={MOON.y + 30} rx="10" ry="6" />
            <ellipse cx={MOON.x + 34} cy={MOON.y + 2} rx="7" ry="10" />
          </g>
        </g>
        <g className="night__cloud-haunt">
          <g className="night__cloud-drift" filter="url(#night-cloud)">
            <ellipse cx="470" cy="190" rx="95" ry="12" />
            <ellipse cx="545" cy="176" rx="82" ry="10" />
            <ellipse cx="420" cy="200" rx="70" ry="8" />
            <ellipse cx="610" cy="196" rx="60" ry="8" />
          </g>
        </g>
        <g className="night__branches">
          {layers.map((l, i) => (
            <path key={i} d={l.d} strokeWidth={l.w} />
          ))}
        </g>
      </svg>
      <div className="muntin" />
    </div>
  )
}
