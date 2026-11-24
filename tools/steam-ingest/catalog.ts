// steam-ingest catalog: the only writer of content/catalog.json (R35). Verifies every recipe before writing anything.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Fallback, Gate, Merged, NoteJson, Review, Scribe, Source, Timing, type Catalog, type RecipeBundle } from '../../src/data/schema.ts'
import { buildRecipeBundle, personaWords } from '../../src/ingest/bundle.ts'
import { pixelSha256 } from '../../src/ingest/image.ts'
import { PROPS_VERSION } from '../../src/ingest/props.ts'
import { allRecipes, recipeDir } from './gate.ts'
import { canonicalJson, decodePng, sha256, writeJson } from './io.ts'

/** gate.json input key -> file in the recipe folder. */
export const INPUT_FILES: Record<string, string> = {
  page: 'page.jpg',
  lines: 'lines.json',
  scribe: 'agent/scribe.json',
  second: 'agent/second.json',
  fallback: 'fallback/reading.json',
  alignment: 'alignment.json',
  transcription: 'transcription.md',
  ownershipReview: 'ownership-review.json',
}
const OPTIONAL_INPUTS = ['alignment', 'transcription', 'ownershipReview']

type Verdict = { id: string; ok: true; bundle: RecipeBundle; gateSha256: string; notes: string[] } | { id: string; ok: false; reason: string }

export function verifyRecipe(root: string, id: string): Verdict {
  const dir = recipeDir(root, id)
  const refuse = (reason: string): Verdict => ({ id, ok: false, reason })
  const gp = join(dir, 'gate.json')
  if (!existsSync(gp)) return refuse('no gate.json')
  const gateBytes = readFileSync(gp)
  const gv = Gate.safeParse(JSON.parse(gateBytes.toString('utf8')))
  if (!gv.success) return refuse(`gate.json invalid: ${gv.error.issues[0]?.message}`)
  const gate = gv.data
  if (!gate.pass) return refuse(`gate state ${gate.state}`)
  if (gate.propsVersion !== PROPS_VERSION) return refuse(`gate.json propsVersion ${gate.propsVersion} is not the current ${PROPS_VERSION}`)
  for (const [k, h] of Object.entries(gate.inputs)) {
    const f = INPUT_FILES[k]
    if (!f) return refuse(`gate.json names an unknown input ${k}`)
    if (!existsSync(join(dir, f))) return refuse(`input ${f} is missing`)
    if (sha256(readFileSync(join(dir, f))) !== h) return refuse(`input ${f} changed since the gate ran (hash mismatch)`)
  }
  for (const k of OPTIONAL_INPUTS) if (!(k in gate.inputs) && existsSync(join(dir, INPUT_FILES[k]!))) return refuse(`${INPUT_FILES[k]} exists but the gate did not read it (stale gate.json)`)
  for (const [rel, h] of Object.entries(gate.outputs)) {
    const p = join(dir, rel)
    if (!existsSync(p)) return refuse(`output ${rel} is missing`)
    const got = rel.endsWith('.png') ? pixelSha256(decodePng(readFileSync(p))) : sha256(readFileSync(p))
    if (got !== h) return refuse(`output ${rel} changed since the gate ran (hash mismatch)`)
  }
  const failed = gate.splits?.notes.filter((n) => n.status === 'failed') ?? []
  if (failed.length) return refuse(`notes ${failed.map((n) => n.noteId).join(', ')} have flagged components without a review decision`)
  const gateSha256 = sha256(gateBytes)
  const fallback = gate.readers?.[0] === 'fallback'
  if (!fallback) {
    const rp = join(dir, 'review.json')
    if (!existsSync(rp)) return refuse('agent-transcribed recipe without review.json')
    const rv = Review.safeParse(JSON.parse(readFileSync(rp, 'utf8')))
    if (!rv.success) return refuse(`review.json invalid: ${rv.error.issues[0]?.path.join('.')}: ${rv.error.issues[0]?.message}`)
    if (rv.data.gateSha256 !== gateSha256) return refuse('review.json reviewed another gate.json (gateSha256 mismatch)')
  }
  const source = Source.parse(JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8')))
  const merged = Merged.parse(JSON.parse(readFileSync(join(dir, 'merged.json'), 'utf8')))
  const reader = fallback ? Fallback.parse(JSON.parse(readFileSync(join(dir, 'fallback/reading.json'), 'utf8'))) : Scribe.parse(JSON.parse(readFileSync(join(dir, 'agent/scribe.json'), 'utf8')))
  const notes = Object.keys(gate.outputs)
    .filter((r) => r.endsWith('.json'))
    .sort()
    .map((r) => NoteJson.parse(JSON.parse(readFileSync(join(dir, r), 'utf8'))))
  const tp = join(dir, 'timing.json')
  const timing = existsSync(tp) ? Timing.parse(JSON.parse(readFileSync(tp, 'utf8'))) : undefined
  const b = buildRecipeBundle({
    id, title: reader.title, source, gate, gateSha256, merged, steps: reader.steps, notes, timing,
    ...(fallback ? { by: (reader as Fallback).by } : {}),
  })
  if (!b.ok) return refuse(b.error)
  const persona = personaWords(canonicalJson({ ...b.bundle, lines: [], steps: [], notes: b.bundle.notes.map((n) => ({ ...n, span: '', shownText: '' })), transcription: { ...b.bundle.transcription, disagreements: [] }, title: '' }))
  if (persona.length) return refuse(`generated copy names a persona: ${persona.join(', ')}`)
  return { id, ok: true, bundle: b.bundle, gateSha256, notes: [] }
}

export function catalogCmd(root: string): { ok: boolean; log: string[]; catalog: Catalog } {
  const ids = allRecipes(root)
  const verdicts = ids.map((id) => verifyRecipe(root, id)) // everything is checked before anything is written
  const log: string[] = []
  const catalog: Catalog = []
  for (const v of verdicts) {
    const pub = join(root, 'public', 'recipes', v.id)
    if (!v.ok) {
      log.push(`catalog: refused ${v.id}: ${v.reason}`)
      if (existsSync(pub)) {
        rmSync(pub, { recursive: true, force: true })
        log.push(`catalog: removed the stale public files of ${v.id}`)
      }
      continue
    }
    const dir = recipeDir(root, v.id)
    writeJson(join(dir, 'recipe.json'), v.bundle)
    rmSync(pub, { recursive: true, force: true })
    mkdirSync(pub, { recursive: true })
    copyFileSync(join(dir, 'recipe.json'), join(pub, 'recipe.json'))
    copyFileSync(join(dir, 'page.jpg'), join(pub, 'page.jpg'))
    for (const f of readdirSync(join(dir, 'notes'))) copyFileSync(join(dir, 'notes', f), join(pub, f))
    catalog.push({ id: v.id, title: v.bundle.title, gateSha256: v.gateSha256 })
    log.push(`catalog: accepted ${v.id} (${v.bundle.notes.length} notes; ${v.bundle.ownership.autoPass} automatic, ${v.bundle.ownership.reviewedPass} reviewed)`)
  }
  catalog.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  writeJson(join(root, 'content', 'catalog.json'), catalog)
  return { ok: verdicts.every((v) => v.ok), log, catalog }
}
