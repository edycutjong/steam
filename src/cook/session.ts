// The saved session: a snapshot of the scheduler, parsed and validated before it is trusted (R18.2, R18.3).

import { z } from 'zod'
import { RecipeId } from '../data/schema.ts'
import type { Plan } from './plan.ts'

const PaceZ = z.union([z.literal(1), z.literal(4), z.literal(12)])

export const Snapshot = z.strictObject({
  v: z.literal(1),
  recipeId: RecipeId,
  stepIndex: z.number().int().min(0),
  stepStartWall: z.number().finite(),
  paceHistory: z.array(z.strictObject({ atWall: z.number().finite(), pace: PaceZ })).min(1),
  revealed: z.array(RecipeId),
})
export type Snapshot = z.infer<typeof Snapshot>

/** A saved session older than this is discarded and a fresh one starts (R18.3). A UI limit, not a cooking time. */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000

/** R18.3: same recipe; step in range; the history starts at stepStartWall and never goes back; known, unrepeated note ids; not stale and not from the future. */
export function snapshotValid(s: Snapshot, plan: Plan, recipeId: string, nowWall: number): boolean {
  if (s.recipeId !== recipeId) return false
  if (s.stepIndex >= plan.steps.length) return false
  if (s.paceHistory[0]!.atWall !== s.stepStartWall) return false
  for (let i = 1; i < s.paceHistory.length; i++) if (s.paceHistory[i]!.atWall < s.paceHistory[i - 1]!.atWall) return false
  const known = new Set(plan.steps.flatMap((x) => (x.note ? [x.note.id] : [])))
  if (new Set(s.revealed).size !== s.revealed.length || s.revealed.some((id) => !known.has(id))) return false
  const age = nowWall - s.stepStartWall
  return age >= 0 && age <= SESSION_MAX_AGE_MS
}
