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

// ---------------------------------------------------------------------------------------------------------------
// Part 2: merged, note, gate, bundle, catalog (R23, R30, R35, R37)

const PropRes = z.strictObject({ pass: z.boolean(), detail: z.string() })
const Box4 = z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()])
const Granularity = z.enum(['words', 'lines'])
const AlignMethod = z.enum(['auto', 'curator', 'lines'])
const SplitStatus = z.enum(['auto', 'reviewed', 'failed'])
export const TRACE_DESCRIPTION = 'a path traced from the ink, left to right' as const

const DisagreementZ = z.strictObject({
  line: int0,
  word: int0,
  a: z.string(),
  b: z.string(),
  countMismatch: z.literal(true).optional(),
  correctedTo: z.string().optional(),
})
const CorrectionZ = z.strictObject({ line: int0, before: z.string(), after: z.string() })
const ReaderUncertainZ = z.strictObject({ line: int0, reader: z.enum(['scribe', 'second', 'fallback']), token: z.string(), alt: z.array(z.string()) })

export const Merged = z.strictObject({
  segmentRun: SegmentRun,
  readers: z.union([z.tuple([z.literal('scribe'), z.literal('second')]), z.tuple([z.literal('fallback')])]),
  disagreements: z.array(DisagreementZ),
  readerUncertain: z.array(ReaderUncertainZ),
  lines: z.array(z.strictObject({ i: int0, merged: z.string(), corrected: z.string().optional(), primary: z.string(), wordCount: int0.nullable() })),
})
export type Merged = z.infer<typeof Merged>

const NoteGroup = z.strictObject({
  line: int0,
  rect: Box4,
  coreBand: z.tuple([z.number(), z.number()]),
  t: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  inkPx: int0,
  words: z.union([z.literal('line'), z.strictObject({ from: int0, to: int0 })]),
})

export const NoteJson = z.strictObject({
  noteId: RecipeId,
  step: z.number().int().min(1),
  span: nonEmpty,
  shownText: nonEmpty,
  granularity: Granularity,
  alignment: AlignMethod,
  alignmentBy: z.string().optional(),
  source: nonEmpty,
  pageBox: Box4,
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  resampled: z.boolean(),
  groups: z.array(NoteGroup).min(1),
  splitShare: z.number().min(0).max(1),
  splitStatus: SplitStatus,
  verifyUrl: z.string().url(),
  verifyApproximate: z.boolean(),
  trace: z.literal(TRACE_DESCRIPTION),
})
export type NoteJson = z.infer<typeof NoteJson>

const P = z.strictObject({ P1: PropRes, P2: PropRes, P3: PropRes, P4: PropRes, P5: PropRes, P6: PropRes })

export const Gate = z
  .strictObject({
    recipeId: RecipeId,
    propsVersion: nonEmpty,
    state: z.enum(['pass', 'fail', 'waiting']),
    segmentRun: SegmentRun,
    readers: z.union([z.tuple([z.literal('scribe'), z.literal('second')]), z.tuple([z.literal('fallback')])]).optional(),
    inputs: z.record(z.string(), hex64),
    outputs: z.record(z.string(), hex64),
    pass: z.boolean(),
    waiting: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
    results: P.optional(),
    splits: z
      .strictObject({
        segmentSplits: int0,
        notes: z.array(z.strictObject({ noteId: RecipeId, share: z.number().min(0).max(1), maskPx: int0, splitPx: int0, status: SplitStatus, flagged: z.array(z.number().int()) })),
      })
      .optional(),
    reviewed: z.array(z.strictObject({ note: RecipeId, components: int0, reviewer: nonEmpty })).optional(),
    ownership: z.strictObject({ autoPass: int0, reviewedPass: int0 }).optional(),
    recall: z
      .array(
        z.strictObject({
          noteId: RecipeId,
          shipped: z.strictObject({ alignment: AlignMethod, recall: z.number(), words: z.array(z.strictObject({ word: z.string(), recall: z.number(), precision: z.number(), rawPx: int0, maskPx: int0 })) }),
          auto: z.union([
            z.strictObject({ recall: z.number(), words: z.array(z.strictObject({ word: z.string(), recall: z.number(), precision: z.number(), rawPx: int0, maskPx: int0 })) }),
            z.strictObject({ notUsed: z.string() }),
          ]),
          threshold: z.number(),
          frame: z.string(),
        }),
      )
      .optional(),
    alignment: z
      .array(
        z.strictObject({
          noteId: RecipeId,
          alignment: AlignMethod,
          granularity: Granularity,
          parts: z.array(z.strictObject({ line: int0, fromWord: int0, toWord: int0, method: AlignMethod, projection: z.enum(['sheared', 'vertical']), s: z.number(), boundaries: z.array(z.number().int()), reason: z.string().optional(), autoDetail: z.string() })),
        }),
      )
      .optional(),
    corrections: z.array(CorrectionZ).optional(),
    disagreements: int0.optional(),
    goldCheck: z.strictObject({ informational: z.literal(true), equal: int0, of: int0, differing: z.array(int0) }).optional(),
    at: nonEmpty,
  })
  .superRefine((g, ctx) => {
    if (g.pass) {
      if (g.state !== 'pass') ctx.addIssue({ code: 'custom', message: 'pass: true needs state "pass"' })
      if (g.waiting?.length) ctx.addIssue({ code: 'custom', message: 'pass: true with waiting reasons' })
      if (!g.results) ctx.addIssue({ code: 'custom', message: 'pass: true without results' })
      else for (const [k, v] of Object.entries(g.results)) if (!v.pass) ctx.addIssue({ code: 'custom', message: `pass: true with failing ${k}` })
    }
    if (g.state === 'waiting' && (g.pass || !g.waiting?.length)) ctx.addIssue({ code: 'custom', message: 'waiting needs pass: false and reasons' })
    if (g.state === 'pass' && !g.pass) ctx.addIssue({ code: 'custom', message: 'state pass with pass: false' })
  })
export type Gate = z.infer<typeof Gate>

const Provenance = z.strictObject({
  institution: nonEmpty,
  shelfmark: nonEmpty,
  page: nonEmpty,
  date: nonEmpty,
  licence: z.strictObject({ id: nonEmpty, label: nonEmpty, url: z.string().url() }),
  credit: nonEmpty,
})

export const BundleNote = z.strictObject({
  id: RecipeId,
  step: z.number().int().min(1),
  span: nonEmpty,
  shownText: nonEmpty,
  granularity: Granularity,
  alignment: AlignMethod,
  alignmentBy: z.string().optional(),
  checkAt: CheckAt.refine((c) => c.source !== 'cook', 'a bundle never carries source "cook" (R36.4)'),
  pageBox: Box4,
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  files: z.strictObject({ png: nonEmpty, toi: nonEmpty, json: nonEmpty }),
  resampled: z.boolean(),
  groups: z.array(NoteGroup).min(1),
  splitShare: z.number().min(0).max(1),
  splitStatus: SplitStatus,
  verifyUrl: z.string().url(),
  verifyApproximate: z.boolean(),
  reveal: z.literal('traced left to right from the ink'),
  provenance: Provenance,
})

export const RecipeBundle = z.strictObject({
  id: RecipeId,
  title: nonEmpty,
  source: Source,
  transcription: z.strictObject({
    readers: z.union([z.tuple([z.literal('scribe'), z.literal('second')]), z.tuple([z.literal('fallback')])]),
    by: z.string().optional(),
    disagreements: z.array(DisagreementZ),
    corrections: z.array(CorrectionZ),
    goldCheck: z.strictObject({ informational: z.literal(true), equal: int0, of: int0, differing: z.array(int0) }).optional(),
  }),
  lines: z.array(z.strictObject({ i: int0, merged: z.string(), corrected: z.string().optional(), primary: z.string() })),
  steps: z.array(z.strictObject({ n: z.number().int().min(1), lineIdx: z.array(int0), text: nonEmpty })),
  notes: z.array(BundleNote),
  gateSha256: hex64,
  ownership: z.strictObject({ autoPass: int0, reviewedPass: int0, reviewed: z.array(z.strictObject({ note: RecipeId, components: int0, reviewer: nonEmpty })) }),
})
export type RecipeBundle = z.infer<typeof RecipeBundle>

export const Catalog = z.array(z.strictObject({ id: RecipeId, title: nonEmpty, gateSha256: hex64 }))
export type Catalog = z.infer<typeof Catalog>
