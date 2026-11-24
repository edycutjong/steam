// The six gate properties as pure functions (design section 5). One implementation for the gate, CI and the browser.

import { SPLIT_SHARE_MAX } from './constants.ts'
import type { NoteOwnership } from './masks.ts'

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
export function checkP3Notes(notes: NoteOwnership[]): P3Summary {
  const failing = notes.filter((n) => n.status === 'failed')
  const autoPass = notes.filter((n) => n.status === 'auto').length
  const reviewedPass = notes.filter((n) => n.status === 'reviewed').length
  if (failing.length) {
    const d = failing.map((n) => `${n.noteId}: split share ${pct(n.share)} over ${SPLIT_SHARE_MAX}, components ${n.flagged.join(',')}`)
    return { result: { pass: false, detail: `joined strokes: needs review (${d.join('; ')})` }, autoPass, reviewedPass }
  }
  const reviewed = notes.filter((n) => n.status === 'reviewed')
  const rev = reviewed.map((n) => `${n.noteId} reviewed (${n.flagged.length} components)`)
  return {
    result: { pass: true, detail: `${autoPass} auto${reviewed.length ? `, ${rev.join('; ')}` : ''}` },
    autoPass,
    reviewedPass,
  }
}
