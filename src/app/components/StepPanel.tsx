import { COOK, stepOf } from '../../copy/strings.ts'
import { parseReading } from '../../data/reading.ts'
import type { RecipeBundle } from '../../data/schema.ts'
import ReadingText from './ReadingText.tsx'

/** The step's text with its marks: each line's `corrected ?? merged`, joined by one space (R9.2). */
export function stepReading(bundle: RecipeBundle, stepIndex: number): string {
  const st = bundle.steps[stepIndex]
  if (!st) return ''
  return st.lineIdx.map((i) => bundle.lines.find((l) => l.i === i)).map((l) => l?.corrected ?? l?.merged ?? '').join(' ')
}

/** "Step n of N" and the step text, large enough to read at arm's length; it scrolls, focusably, when long (R9.2, R9.3). */
export default function StepPanel({ bundle, stepIndex }: { bundle: RecipeBundle; stepIndex: number }) {
  return (
    <div className="step">
      <p className="step__of">{stepOf(stepIndex + 1, bundle.steps.length)}</p>
      <div className="step__scroll" tabIndex={0} role="region" aria-label={COOK.stepText}>
        <p className="step__text">
          <ReadingText segments={parseReading(stepReading(bundle, stepIndex))} />
        </p>
      </div>
    </div>
  )
}
