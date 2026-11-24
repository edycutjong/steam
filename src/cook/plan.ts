// The plan: which step carries which note, and when the note is due (R8.1, R12.1, R15.5).

import type { BundleNote, RecipeBundle } from '../data/schema.ts'
import { effectiveCheckAt } from './timing.ts'

export { effectiveCheckAt }

export interface PlanStep {
  note: { id: string; checkAtMs: number } | null
}
export interface Plan {
  steps: PlanStep[]
}

/** One entry per step of the bundle, in order. Withheld notes are simply not in `notes`, so their step is empty. */
export function buildPlan(bundle: RecipeBundle, notes: readonly BundleNote[], overrides: Record<string, number>): Plan {
  const steps = [...bundle.steps].sort((a, b) => a.n - b.n)
  return {
    steps: steps.map((s) => {
      const n = notes.find((x) => x.step === s.n)
      return { note: n ? { id: n.id, checkAtMs: effectiveCheckAt(n, overrides).seconds * 1000 } : null }
    }),
  }
}

/** The note the pane shows at a step: its own, else the next note ahead, else the last note of the plan, else none (R15.5). */
export function paneNoteFor(plan: Plan, stepIndex: number): string | null {
  const own = plan.steps[stepIndex]?.note
  if (own) return own.id
  for (let i = stepIndex + 1; i < plan.steps.length; i++) {
    const n = plan.steps[i]!.note
    if (n) return n.id
  }
  for (let i = Math.min(stepIndex, plan.steps.length) - 1; i >= 0; i--) {
    const n = plan.steps[i]?.note
    if (n) return n.id
  }
  return null
}
