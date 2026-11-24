// steam-ingest fallback <id> --structure <file>: the labelled frozen reading as a single reader (R34).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Fallback, Lines } from '../../src/data/schema.ts'
import { mergeSingle } from '../../src/ingest/merge.ts'
import { checkNotes, checkSteps, effectiveLines } from '../../src/ingest/notes.ts'
import { sha256, writeJson } from './io.ts'

const Structure = z.strictObject({
  titleLine: z.number().int().nonnegative().nullable(),
  steps: z.array(z.strictObject({ n: z.number().int().min(1), lineIdx: z.array(z.number().int().nonnegative()).min(1), text: z.string().min(1) })),
  notes: z.array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      step: z.number().int().min(1),
      span: z.string().min(1),
      quote: z.array(z.strictObject({ line: z.number().int().nonnegative(), fromWord: z.number().int().nonnegative(), toWord: z.number().int().nonnegative() })).min(1),
    }),
  ),
  rationale: z.string().optional(),
})
export type Structure = z.infer<typeof Structure>

const Gold = z.object({
  recipe: z.string(),
  by: z.string().min(1),
  title: z.string().min(1),
  lines: z.array(z.object({ text: z.string().min(1), uncertain: z.array(z.object({ token: z.string(), alt: z.array(z.string()) })).optional() })),
})

export interface FallbackInput {
  recipeDir: string
  goldPath: string
  /** Path written into the file as `source` (relative to the repo). */
  goldName: string
  structurePath: string
}

/** Builds fallback/reading.json; refuses a count mismatch or a structure that breaks R17. Never touches agent/*. */
export function fallbackCmd(i: FallbackInput): Fallback {
  const goldBytes = readFileSync(i.goldPath)
  const gold = Gold.parse(JSON.parse(goldBytes.toString('utf8')))
  const lines = Lines.parse(JSON.parse(readFileSync(join(i.recipeDir, 'lines.json'), 'utf8')))
  const st = Structure.parse(JSON.parse(readFileSync(i.structurePath, 'utf8')))
  const off = st.titleLine === null ? 0 : 1
  if (st.titleLine !== null && st.titleLine !== 0) throw new Error('fallback: the title can only be line 0 (gold lines follow it)')
  const body = lines.lines.length - off
  if (gold.lines.length !== body) throw new Error(`fallback: gold has ${gold.lines.length} body lines, lines.json has ${body} after the title offset ${off}`)
  const readingLines = [
    ...(off ? [{ i: 0, text: gold.title }] : []),
    ...gold.lines.map((l, j) => ({ i: j + off, text: l.text, ...(l.uncertain ? { uncertain: l.uncertain } : {}) })),
  ]
  const fb: Fallback = Fallback.parse({
    segmentRun: lines.segmentRun,
    readers: ['fallback'],
    by: gold.by,
    source: i.goldName,
    sourceSha256: sha256(goldBytes),
    title: gold.title,
    titleLine: st.titleLine,
    lines: readingLines,
    steps: st.steps,
    notes: st.notes,
  })
  const eff = effectiveLines(mergeSingle(fb))
  const errs = [...checkSteps(eff, fb.steps), ...checkNotes(eff, fb.steps, fb.notes).errors]
  if (errs.length) throw new Error(`fallback: the structure breaks R17: ${errs.join('; ')}`)
  writeJson(join(i.recipeDir, 'fallback', 'reading.json'), fb)
  return fb
}
