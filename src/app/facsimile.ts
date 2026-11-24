// Zoom and pan of the facsimile: a pure reducer (R5.3, R5.4). The image is fitted to the viewport width at scale 1;
// x, y are the translation of the image in viewport px.

export const MAX_ZOOM = 6

export interface ZoomState {
  scale: number
  x: number
  y: number
  /** Viewport size and the image's natural size. */
  vw: number
  vh: number
  iw: number
  ih: number
}
export type ZoomAction =
  | { type: 'zoomAt'; factor: number; cx: number; cy: number }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'reset' }
  | { type: 'resize'; w: number; h: number }

export const initialZoom = (vw: number, vh: number, iw: number, ih: number): ZoomState => clamp({ scale: 1, x: 0, y: 0, vw, vh, iw, ih })

/** Displayed image height at scale 1 (fitted to the width). */
const fittedH = (s: ZoomState): number => (s.iw > 0 ? (s.vw * s.ih) / s.iw : 0)

function clampAxis(t: number, view: number, size: number): number {
  if (size >= view) return Math.min(0, Math.max(view - size, t))
  return (view - size) / 2 // smaller than the viewport: centred
}

function clamp(s: ZoomState): ZoomState {
  const scale = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(s.scale) ? s.scale : 1))
  const w = s.vw * scale
  const h = fittedH(s) * scale
  return { ...s, scale, x: clampAxis(Number.isFinite(s.x) ? s.x : 0, s.vw, w), y: clampAxis(Number.isFinite(s.y) ? s.y : 0, s.vh, h) }
}

export function zoomPan(s: ZoomState, a: ZoomAction): ZoomState {
  switch (a.type) {
    case 'zoomAt': {
      const next = Math.min(MAX_ZOOM, Math.max(1, s.scale * (Number.isFinite(a.factor) && a.factor > 0 ? a.factor : 1)))
      const k = next / s.scale
      // keep the image point under (cx, cy) fixed: cx = x + px * scale
      return clamp({ ...s, scale: next, x: a.cx - (a.cx - s.x) * k, y: a.cy - (a.cy - s.y) * k })
    }
    case 'pan':
      return clamp({ ...s, x: s.x + a.dx, y: s.y + a.dy })
    case 'reset':
      return clamp({ ...s, scale: 1, x: 0, y: 0 })
    case 'resize': {
      if (!(a.w > 0) || !(a.h > 0)) return s
      // keep the same image point at the viewport's top-left, in image fractions
      const fx = s.vw * s.scale > 0 ? -s.x / (s.vw * s.scale) : 0
      const fy = fittedH(s) * s.scale > 0 ? -s.y / (fittedH(s) * s.scale) : 0
      const n = { ...s, vw: a.w, vh: a.h }
      return clamp({ ...n, x: -fx * a.w * s.scale, y: -fy * fittedH(n) * s.scale })
    }
  }
}
