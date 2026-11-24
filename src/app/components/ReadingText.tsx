import { EDITION } from '../../copy/strings.ts'
import type { Segment } from '../../data/reading.ts'
import { plainText } from '../../data/reading.ts'

export const DISAGREE_DESC_ID = 'disagree-desc'

/**
 * The transcription with every reader disagreement shown as written, †[a|b], both readings visible (R6.3, R6.4).
 * Each mark is a labelled group that shares one hidden description.
 */
export default function ReadingText({ segments, className }: { segments: readonly Segment[]; className?: string }) {
  return (
    <span className={className}>
      {segments.map((s, i) =>
        s.kind === 'text' ? (
          <span key={i}>{s.text}</span>
        ) : (
          <span key={i} className="mark" role="group" aria-label={EDITION.marksName(s.a, s.b)} aria-describedby={DISAGREE_DESC_ID}>
            <span className="mark__dagger" aria-hidden="true">†[</span>
            {s.a}
            <span className="mark__bar" aria-hidden="true">|</span>
            {s.b}
            <span className="mark__dagger" aria-hidden="true">]</span>
          </span>
        ),
      )}
    </span>
  )
}

/** The one shared description of the marks; render it once on a screen that shows marks. */
export function DisagreeDescription() {
  return (
    <p id={DISAGREE_DESC_ID} className="sr-only">
      {EDITION.marksDescription}
    </p>
  )
}

export { plainText }
