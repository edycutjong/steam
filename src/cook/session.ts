// The saved session: a snapshot of the scheduler, parsed and validated before it is trusted (R18.2, R18.3).

import { z } from 'zod'
import { RecipeId } from '../data/schema.ts'

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
