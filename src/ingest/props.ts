// The six gate properties as pure functions (design section 5). One implementation for the gate, CI and the browser.

import { PATH_COVERAGE_MIN, SPLIT_SHARE_MAX } from './constants.ts'
import type { Rgba } from './image.ts'
import type { NoteOwnership } from './masks.ts'
import { revealTimes, zhangSuen, type GroupInput, type Trace } from './timeofink.ts'

/** Bumped whenever the definition of a property changes (R30.8). */
export const PROPS_VERSION = '1'

export interface PropResult {
  pass: boolean
  detail: string
}

export interface P3Summary {
  result: PropResult
  /** Notes that pass on the automatic rule alone. */
  autoPass: number
  /** Notes that pass only because every flagged component has a decision (R13.5). */
  reviewedPass: number
}

const pct = (x: number): string => x.toFixed(4)

/** P3, per-note part (R12, R26.2 last clause, R26.3). */
export function checkP3Notes(notes: NoteOwnership[], opts: { staleReview?: boolean } = {}): P3Summary {
  const failing = notes.filter((n) => n.status === 'failed')
  const autoPass = notes.filter((n) => n.status === 'auto').length
  const reviewedPass = notes.filter((n) => n.status === 'reviewed').length
  if (failing.length) {
    const d = failing.map((n) => `${n.noteId}: split share ${pct(n.share)} over ${SPLIT_SHARE_MAX}, components ${n.flagged.join(',')}`)
    const head = opts.staleReview ? 'stale ownership review; joined strokes: needs review' : 'joined strokes: needs review'
    return { result: { pass: false, detail: `${head} (${d.join('; ')})` }, autoPass, reviewedPass }
  }
  const reviewed = notes.filter((n) => n.status === 'reviewed')
  const rev = reviewed.map((n) => `${n.noteId} reviewed (${n.flagged.length} components, by ${n.reviewers.join(', ')})`)
  return {
    result: { pass: true, detail: `${autoPass} auto${reviewed.length ? `, ${rev.join('; ')}` : ''}` },
    autoPass,
    reviewedPass,
  }
}

export interface P6Input {
  trace: Trace
  groups: GroupInput[]
  width: number
  height: number
  s: number
  /** The decoded toi.png: R = ink alpha, G = reveal time. */
  toi: Rgba
}

/**
 * P6 (R29): every pixel with R > 0 has G = round(255 t) for the time t of the trace, 0 <= t <= 1; times along the
 * path never decrease and group ranges are ordered; the path covers at least 95% of a freshly computed skeleton.
 */
export function checkP6(i: P6Input): PropResult {
  const { trace, width: w, height: h } = i
  const fails: string[] = []
  const support = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k++) support[k] = i.toi.data[k * 4]! > 0 ? 1 : 0
  const rt = revealTimes(trace, i.groups, w, h, i.s, support)
  let n = 0
  let bad: string | null = null
  for (let y = 0; y < h && !bad; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (!support[k]) continue
      n++
      const t = rt.t[k]!
      if (!Number.isFinite(t) || t < 0 || t > 1) {
        bad = `pixel (${x},${y}) has no reveal time in [0,1]`
        break
      }
      const g = i.toi.data[k * 4 + 1]!
      if (g !== Math.round(255 * t)) {
        bad = `pixel (${x},${y}): G ${g} is not round(255 t) = ${Math.round(255 * t)}`
        break
      }
    }
  if (bad) fails.push(`quantised time: ${bad}`)
  for (let k = 1; k < trace.path.length; k++)
    if (trace.path[k]!.t < trace.path[k - 1]!.t) {
      fails.push(`path time decreases at path index ${k}`)
      break
    }
  trace.groups.forEach((g, k) => {
    if (!(0 <= g.t[0] && g.t[0] <= g.t[1] && g.t[1] <= 1)) fails.push(`group ${k} range [${g.t[0]}, ${g.t[1]}] is not within [0,1]`)
    if (k > 0 && trace.groups[k - 1]!.t[1] > g.t[0]) fails.push(`group ${k} starts before group ${k - 1} ends`)
  })
  const onPath = new Set(trace.path.map((p) => `${p.group}:${p.x},${p.y}`))
  let sk = 0
  let covered = 0
  const ordered = [...i.groups].sort((a, b) => a.line - b.line)
  ordered.forEach((g, gi) => {
    const fresh = zhangSuen(g.mask, w, h)
    for (let k = 0; k < fresh.length; k++)
      if (fresh[k]) {
        sk++
        if (onPath.has(`${gi}:${k % w},${Math.floor(k / w)}`)) covered++
      }
  })
  const coverage = sk === 0 ? 1 : covered / sk
  if (coverage < PATH_COVERAGE_MIN) fails.push(`path covers ${coverage.toFixed(3)} of the skeleton (needs ${PATH_COVERAGE_MIN})`)
  if (fails.length) return { pass: false, detail: fails.join('; ') }
  return { pass: true, detail: `${n} px timed, path coverage ${coverage.toFixed(3)}` }
}
