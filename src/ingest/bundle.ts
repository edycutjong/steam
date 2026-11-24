// Verify links, check times and the recipe bundle (R23.3, R36, R37).

export interface VerifyInput {
  /** IIIF Image API service id from source.json. */
  imageService: string
  /** [x0, y0, x1, y1] in the page frame. */
  pageBox: [number, number, number, number]
  frame: { width: number; height: number }
  deskewDeg?: number
  deskewApplied?: boolean
}

const pct4 = (v: number): string => Math.min(100, Math.max(0, v)).toFixed(4)

/**
 * The rectangle of the note on the page frame as `[x, y, w, h]` px (R21.2). After an applied deskew the box is mapped back
 * to the original page by rotating its corners and taking their bounding box, and flagged approximate (R23.4). Clipped to the frame.
 * `verifyUrl` turns this same box into percentages, so the percentage link and `verifyBox` come from one computation (R21.3).
 */
export function verifyRegion(i: Omit<VerifyInput, 'imageService'>): { box: [number, number, number, number]; approximate: boolean } {
  let [x0, y0, x1, y1] = i.pageBox
  const { width: W, height: H } = i.frame
  let approximate = false
  if (i.deskewApplied && i.deskewDeg) {
    approximate = true
    // applyDeskew rotated the page by -deg; map the box corners back by +deg about the page centre
    const a = (i.deskewDeg * Math.PI) / 180
    const cx = (W - 1) / 2
    const cy = (H - 1) / 2
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => {
      const dx = x! - cx
      const dy = y! - cy
      return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)] as const
    })
    x0 = Math.min(...pts.map((p) => p[0]))
    x1 = Math.max(...pts.map((p) => p[0]))
    y0 = Math.min(...pts.map((p) => p[1]))
    y1 = Math.max(...pts.map((p) => p[1]))
  }
  const cx0 = Math.max(0, x0)
  const cy0 = Math.max(0, y0)
  const cx1 = Math.min(W, x1)
  const cy1 = Math.min(H, y1)
  return { box: [cx0, cy0, cx1 - cx0, cy1 - cy0], approximate }
}

/** `<imageService>/pct:x,y,w,h/full/0/default.jpg` for the same pixels on the archive's server (R23.3): percentages of the page frame. */
export function verifyUrl(i: VerifyInput): { url: string; approximate: boolean } {
  const { box, approximate } = verifyRegion(i)
  const { width: W, height: H } = i.frame
  const [x, y, w, h] = [(box[0] / W) * 100, (box[1] / H) * 100, (box[2] / W) * 100, (box[3] / H) * 100]
  return { url: `${i.imageService}/pct:${pct4(x)},${pct4(y)},${pct4(w)},${pct4(h)}/full/0/default.jpg`, approximate }
}

// ---------------------------------------------------------------------------------------------------------------
// Check times (R36) and recipe.json (R37)

import { RecipeBundle, type CheckAt, type Gate, type Merged, type NoteJson, type RecipeBundle as Bundle, type Source, type Timing } from '../data/schema.ts'

export const STEP_ENTRY_BASIS = 'the manuscript gives no time; the note arrives with its step'

/** R36.2, R36.3: a cited time only when its basis is a substring of the step's primary text. */
export function checkAt(noteId: string, stepText: string, timing?: Timing): { ok: true; value: CheckAt } | { ok: false; error: string } {
  const t = timing?.find((x) => x.noteId === noteId)
  if (!t) return { ok: true, value: { seconds: 0, source: 'step-entry', basis: STEP_ENTRY_BASIS } }
  if (!Number.isFinite(t.seconds) || t.seconds < 0) return { ok: false, error: `timing.json: ${noteId}: seconds must be a finite non-negative number` }
  if (!stepText.includes(t.basis)) return { ok: false, error: `timing.json: ${noteId}: basis ${JSON.stringify(t.basis)} is not in the text of its step` }
  return { ok: true, value: { seconds: t.seconds, source: 'cited', basis: t.basis } }
}

export interface BundleInput {
  id: string
  title: string
  source: Source
  gate: Gate
  gateSha256: string
  merged: Merged
  /** `by` of the fallback reading, when the readers are ["fallback"]. */
  by?: string
  steps: { n: number; lineIdx: number[]; text: string }[]
  notes: NoteJson[]
  timing?: Timing
}

/** Pure: builds and validates recipe.json; refuses a bad timing.json (R36.3). */
export function buildRecipeBundle(i: BundleInput): { ok: true; bundle: Bundle } | { ok: false; error: string } {
  const provenance = {
    institution: i.source.institution,
    shelfmark: i.source.shelfmark,
    page: i.source.page,
    date: i.source.date,
    licence: i.source.licence,
    credit: i.source.credit,
  }
  const notes: Bundle['notes'] = []
  for (const n of i.notes) {
    const step = i.steps.find((s) => s.n === n.step)
    if (!step) return { ok: false, error: `note ${n.noteId}: step ${n.step} missing` }
    const c = checkAt(n.noteId, step.text, i.timing)
    if (!c.ok) return { ok: false, error: c.error }
    notes.push({
      id: n.noteId,
      step: n.step,
      span: n.span,
      shownText: n.shownText,
      granularity: n.granularity,
      alignment: n.alignment,
      ...(n.alignmentBy ? { alignmentBy: n.alignmentBy } : {}),
      checkAt: c.value,
      pageBox: n.pageBox,
      size: n.size,
      files: { png: `note-${n.noteId}.png`, toi: `note-${n.noteId}.toi.png`, json: `note-${n.noteId}.json` },
      resampled: n.resampled,
      groups: n.groups,
      splitShare: n.splitShare,
      splitStatus: n.splitStatus,
      verifyUrl: n.verifyUrl,
      verifyApproximate: n.verifyApproximate,
      reveal: 'traced left to right from the ink',
      provenance,
    })
  }
  const bundle = {
    id: i.id,
    title: i.title,
    source: i.source,
    transcription: {
      readers: i.merged.readers,
      ...(i.by ? { by: i.by } : {}),
      disagreements: i.merged.disagreements,
      corrections: i.gate.corrections ?? [],
      ...(i.gate.goldCheck ? { goldCheck: i.gate.goldCheck } : {}),
    },
    lines: i.merged.lines.map((l) => ({ i: l.i, merged: l.merged, ...(l.corrected !== undefined ? { corrected: l.corrected } : {}), primary: l.primary })),
    steps: i.steps,
    notes,
    gateSha256: i.gateSha256,
    ownership: { autoPass: i.gate.ownership?.autoPass ?? 0, reviewedPass: i.gate.ownership?.reviewedPass ?? 0, reviewed: i.gate.reviewed ?? [] },
  }
  const v = RecipeBundle.safeParse(bundle)
  if (!v.success) return { ok: false, error: `recipe.json: ${v.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}` }
  return { ok: true, bundle: v.data }
}

/** R37.3: no "she", "her" or persona words in generated copy. Returns the offending words. */
export function personaWords(text: string): string[] {
  return [...text.matchAll(/\b(she|her|hers|herself)\b/gi)].map((m) => m[0])
}
