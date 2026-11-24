// The drag recognizer: a horizontal drag across the pane wipes the glass (R14.4). Pure, so the component only feeds it samples.

export interface Sample {
  x: number
  y: number
  /** ms */
  t: number
}

/** Least horizontal travel in px; a pane wider than four times this needs a quarter of its width instead. */
export const DRAG_MIN_PX = 96
export const DRAG_MAX_MS = 2000
export const DEBOUNCE_MS = 400

export const dragThreshold = (paneWidth: number): number => Math.max(DRAG_MIN_PX, 0.25 * paneWidth)

/** Incremental form: feed samples, learn at which one the drag fires. Horizontal travel is the summed |dx|; vertical travel does not count. */
export function createDrag(paneWidth: number) {
  const need = dragThreshold(paneWidth)
  let prev: Sample | null = null
  let t0 = 0
  let travel = 0
  let fired = false
  return {
    /** Returns true exactly once, at the first sample where travel and time are both met. */
    push(p: Sample): boolean {
      if (prev === null) {
        prev = p
        t0 = p.t
        return false
      }
      travel += Math.abs(p.x - prev.x)
      prev = p
      if (fired || p.t - t0 > DRAG_MAX_MS) return false
      if (travel >= need) {
        fired = true
        return true
      }
      return false
    },
  }
}

/** The index of the sample at which the path fires, or null. */
export function dragWipe(path: readonly Sample[], paneWidth: number): number | null {
  const d = createDrag(paneWidth)
  for (let i = 0; i < path.length; i++) if (d.push(path[i]!)) return i
  return null
}

/** Collapses fires closer together than `windowMs` to the first of them. Times in ms, in order. */
export function dedupe(times: readonly number[], windowMs = DEBOUNCE_MS): number[] {
  const out: number[] = []
  for (const t of times) if (out.length === 0 || t - out[out.length - 1]! >= windowMs) out.push(t)
  return out
}
