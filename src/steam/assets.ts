import { z } from 'zod'

const Int = z.number().int()

const Rect = z
  .tuple([Int, Int, Int, Int])
  .refine((r) => r[2] > r[0] && r[3] > r[1], { message: 'rect must have positive width and height' })

const Group = z.object({
  line: Int,
  rect: Rect,
  coreBand: z
    .tuple([Int, Int])
    .refine((b) => b[1] > b[0], { message: 'coreBand must be increasing' }),
  t: z
    .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
    .refine((t) => t[1] > t[0], { message: 't must be increasing' }),
  inkPx: Int.nonnegative(),
})

/** Unknown keys (spike-only fields such as `p3`, `splitDetail`) are stripped. */
export const NoteMeta = z
  .object({
    noteId: z.string().min(1),
    text: z.string().min(1),
    source: z.string().min(1),
    size: z.tuple([Int.positive(), Int.positive()]),
    pageBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    groups: z.array(Group).min(1),
  })
  .superRefine((m, ctx) => {
    const [w, h] = m.size
    m.groups.forEach((g, i) => {
      const [x0, y0, x1, y1] = g.rect
      if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) {
        ctx.addIssue({ code: 'custom', path: ['groups', i, 'rect'], message: 'rect lies outside size' })
      }
      if (g.coreBand[0] < y0 || g.coreBand[1] > y1) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', i, 'coreBand'],
          message: 'coreBand lies outside the rect y-range',
        })
      }
      if (i > 0 && g.t[0] < m.groups[i - 1].t[1]) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', i, 't'],
          message: 'group time ranges must be sorted and must not overlap',
        })
      }
    })
  })

export type NoteMeta = z.infer<typeof NoteMeta>
