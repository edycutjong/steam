// zod schemas for every ingest file (design section 2). Reader schemas are strict: a stray box, x or y is an error (R14.7).

import { z } from 'zod'

const hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'sha-256 hex')
const nonEmpty = z.string().min(1)
const int0 = z.number().int().nonnegative()
const tuple4 = z.tuple([z.number(), z.number(), z.number(), z.number()])
const tuple2 = z.tuple([z.number(), z.number()])
export const RecipeId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/)

export const SegmentRun = z.strictObject({ id: z.string().regex(/^sr-[0-9a-f]{12}$/), stripsHash: hex64 })
export type SegmentRun = z.infer<typeof SegmentRun>

export const Frame = z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive(), scaleX: z.number().positive(), scaleY: z.number().positive() })
export type Frame = z.infer<typeof Frame>

export const Source = z.strictObject({
  institution: nonEmpty,
  shelfmark: nonEmpty,
  workUrl: z.string().url(),
  manifest: z.string().url(),
  canvasIndex: int0,
  imageService: z.string().url(),
  page: nonEmpty,
  date: nonEmpty,
  licence: z.strictObject({ id: nonEmpty, label: nonEmpty, url: z.string().url() }),
  credit: nonEmpty,
  /** ISO date, or a sentence saying where the page came from when the network was not used. */
  retrieved: nonEmpty,
  frame: Frame.optional(),
})
export type Source = z.infer<typeof Source>

export const Line = z.strictObject({ i: int0, box: tuple4, coreBand: tuple2, peakRow: z.number() })
export type Line = z.infer<typeof Line>

export const Lines = z.strictObject({
  segmentRun: SegmentRun,
  frame: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }),
  region: z.strictObject({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
  selectedBy: z.enum(['default', 'curator']),
  blockIndex: int0,
  deskewDeg: z.number(),
  deskewApplied: z.boolean(),
  slant: z.number(),
  marginalia: z.array(z.strictObject({ box: tuple4, inkPx: int0 })),
  outsideRegionInkPx: int0,
  lines: z.array(Line),
})
export type Lines = z.infer<typeof Lines>

/** A token must survive the `†[a|b]` marker form of transcription.md (design 3.4). */
const safeText = (s: string): boolean => !/[|\]†]/.test(s)
const Uncertain = z.strictObject({
  token: nonEmpty.refine(safeText, 'token must not contain | ] or †'),
  alt: z.array(nonEmpty.refine(safeText, 'alternative must not contain | ] or †')),
})
const ReadingLine = z.strictObject({ i: int0, text: nonEmpty.refine(safeText, 'text must not contain | ] or †'), uncertain: z.array(Uncertain).optional() })

const readingShape = { segmentRun: SegmentRun, lines: z.array(ReadingLine) }
export const Reading = z.strictObject(readingShape)
export type Reading = z.infer<typeof Reading>

const Step = z.strictObject({ n: z.number().int().min(1), lineIdx: z.array(int0).min(1), text: nonEmpty })
const Quote = z.strictObject({ line: int0, fromWord: int0, toWord: int0 })
const NoteDef = z.strictObject({ id: RecipeId, step: z.number().int().min(1), span: nonEmpty, quote: z.array(Quote).min(1) })
export type StepDef = z.infer<typeof Step>
export type NoteDef = z.infer<typeof NoteDef>
const scribeShape = { ...readingShape, title: nonEmpty, titleLine: int0.nullable(), steps: z.array(Step), notes: z.array(NoteDef) }
export const Scribe = z.strictObject(scribeShape)
export type Scribe = z.infer<typeof Scribe>
export const Fallback = z.strictObject({
  ...scribeShape,
  readers: z.tuple([z.literal('fallback')]),
  by: nonEmpty,
  source: nonEmpty,
  sourceSha256: hex64,
})
export type Fallback = z.infer<typeof Fallback>

export const OwnershipReview = z.strictObject({
  segmentRun: SegmentRun,
  decisions: z.array(
    z.strictObject({
      componentId: z.number().int(),
      overlay: nonEmpty,
      decision: z.union([z.strictObject({ assignToLine: int0 }), z.strictObject({ splitAtRow: int0 })]),
      reviewer: nonEmpty,
      rationale: nonEmpty,
    }),
  ),
})
export type OwnershipReview = z.infer<typeof OwnershipReview>

export const Alignment = z.strictObject({
  segmentRun: SegmentRun,
  method: z.literal('curator'),
  by: nonEmpty,
  rationale: nonEmpty,
  lines: z.array(z.strictObject({ line: int0, boundaryRuns: z.array(int0) })),
})
export type Alignment = z.infer<typeof Alignment>

export const Review = z.strictObject({ reviewedBy: nonEmpty, reviewedAt: nonEmpty, gateSha256: hex64, notes: z.string().optional() })
export type Review = z.infer<typeof Review>

export const Timing = z.array(
  z.strictObject({ noteId: RecipeId, seconds: z.number().finite().nonnegative(), source: z.literal('cited'), basis: nonEmpty }),
)
export type Timing = z.infer<typeof Timing>

export const CheckAt = z.strictObject({ seconds: z.number().finite().nonnegative(), source: z.enum(['cited', 'step-entry', 'cook']), basis: nonEmpty })
export type CheckAt = z.infer<typeof CheckAt>
