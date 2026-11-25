// Quality governor (steam-renderer-v1 design §8). A rolling window of frame intervals; when its p95 is over budget the
// tier rises by one and the window starts again. Pure and allocation-free after construction.

export const GOV_WINDOW = 60
export const GOV_P95_MS = 18
/**
 * An interval longer than this is not entered in the window (one GC pause or decode is not a trend). A hidden tab's gap never
 * gets here: the renderer's clock stands still while the page is hidden (a2a-arch-r05 B1).
 */
export const GOV_IGNORE_MS = 500
/** This many consecutive visible intervals over `GOV_IGNORE_MS` mean the device renders slower than 2 fps: straight to the last tier. */
export const GOV_STALL_RUN = 3
export const MAX_TIER = 3

export type Tier = 0 | 1 | 2 | 3

export class QualityGovernor {
  tier: Tier = 0
  private readonly ring = new Float64Array(GOV_WINDOW)
  private readonly sorted = new Float64Array(GOV_WINDOW)
  private n = 0
  private head = 0
  private stalls = 0

  /** Frames in the current window. */
  get filled(): number {
    return this.n
  }

  /** p95 (nearest rank) of the current window, or NaN while it is not full. */
  p95(): number {
    if (this.n < GOV_WINDOW) return Number.NaN
    this.sorted.set(this.ring)
    this.sorted.sort()
    return this.sorted[Math.ceil(0.95 * GOV_WINDOW) - 1]
  }

  /** Adds one frame interval (ms). Returns the new tier when it rose, else null. */
  push(dtMs: number): Tier | null {
    if (!(dtMs > 0) || !Number.isFinite(dtMs)) return null
    if (dtMs > GOV_IGNORE_MS) {
      // the stall path: a run of long visible intervals is real cost, and the p95 window would take minutes to fill at that rate
      this.stalls++
      if (this.stalls < GOV_STALL_RUN || this.tier >= MAX_TIER) return null
      this.tier = MAX_TIER
      this.n = 0
      this.head = 0
      return this.tier
    }
    this.stalls = 0
    this.ring[this.head] = dtMs
    this.head = (this.head + 1) % GOV_WINDOW
    if (this.n < GOV_WINDOW) this.n++
    if (this.n < GOV_WINDOW || this.tier >= MAX_TIER) return null
    if (this.p95() > GOV_P95_MS) {
      this.tier = (this.tier + 1) as Tier
      this.n = 0
      this.head = 0
      return this.tier
    }
    return null
  }
}

/**
 * Whether the governor may degrade this page. On by default. An automated browser (`navigator.webdriver`) is left at full
 * quality unless the URL says `gov=1`, because a tier change swaps the canvas for the static images in the middle of a
 * scripted run; the bench asks for `gov=1` so its rows show what the governor really does. `gov=0` turns it off anywhere.
 */
export function governorEnabled(search: string, hash: string, webdriver: boolean): boolean {
  const q = `${search}&${hash.slice(hash.indexOf('?') >= 0 ? hash.indexOf('?') : hash.length)}`
  if (/[?&]gov=1(&|$)/.test(q)) return true
  if (/[?&]gov=0(&|$)/.test(q)) return false
  return !webdriver
}
