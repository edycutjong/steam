// Hook catalog-gate (PreToolUse, matcher "write"): an agent may not write the public catalog by hand. The catalog lists the
// recipes that reach Cook Mode, and only `npm run catalog` (steam-ingest catalog) verifies a recipe before listing it.
// A write that lists a recipe whose gate.json does not pass, whose input hashes no longer match the files, or that has no
// review.json with a reviewedBy, exits 2 and the stderr below goes back to the agent (probe-3.5.0 result 2).
// Other paths: exit 0, no output, no log line.
//
// Not covered here: a shell command that writes the file. Matcher "write" is fs_write and str_replace only. That gap is closed by
// shell-gate.ts (PreToolUse, matcher "shell") and src-scan.ts (PostToolUse), which reuse `catalogUse` below (hook-coverage).

import { existsSync, readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { Catalog, Gate, Review } from '../../src/data/schema.ts'
import { verifyRecipe } from '../steam-ingest/catalog.ts'
import { recipeDir } from '../steam-ingest/gate.ts'
import { catalogUse } from './catalog-rule.ts'
import { isMain, logHook, ok, parseHookInput, rootOf, runAsMain, toRel, type HookInput, type HookResult } from './lib.ts'

export const HOOK = 'catalog-gate'

// Spelled in two parts: the R35.5 test lists every non-test source file that names the catalog file, and this one only guards it.
const FILE = 'catalog' + '.json'
export const CATALOG_REL = `content/${FILE}`
export const CATALOG_PATH = new RegExp(`(?:^|/)content/catalog\\.json$`)

export interface Deps {
  now?: () => Date
}

/** The first line of an error; for a zod error, its first issue. */
const why1 = (e: unknown): string => {
  const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] }).issues
  if (issues?.[0]) return `${issues[0].path.map(String).join('.') || 'value'}: ${issues[0].message}`
  return (e as Error).message.split('\n')[0]!
}

type Proposed = { ok: true; text: string } | { ok: false; why: string } | { skip: string }

/** The file as it would be after the tool ran. */
function proposed(i: HookInput, path: string): Proposed {
  const t = i.tool_input ?? {}
  if (i.tool_name === 'fs_write') {
    const body = [t.text, t.content, t.file_text].find((v): v is string => typeof v === 'string')
    if (body === undefined) return { ok: false, why: 'the proposed content of this write could not be read' }
    if (t.command === 'append') return { ok: true, text: (existsSync(path) ? readFileSync(path, 'utf8') : '') + body }
    return { ok: true, text: body }
  }
  if (i.tool_name === 'str_replace') {
    if (typeof t.oldStr !== 'string' || typeof t.newStr !== 'string') return { ok: false, why: 'the proposed replacement could not be read' }
    const cur = existsSync(path) ? readFileSync(path, 'utf8') : ''
    if (!cur.includes(t.oldStr)) return { skip: 'the replacement does not apply to the current file, so the tool will refuse it' }
    return { ok: true, text: t.replace_all === true ? cur.split(t.oldStr).join(t.newStr) : cur.replace(t.oldStr, () => t.newStr as string) }
  }
  return { ok: false, why: `tool ${i.tool_name ?? '(unknown)'} writes this file in a way the hook cannot read` }
}

/** Why `id` may not be listed, or undefined when it may. */
function refuseReason(root: string, id: string, entry: { title: string; gateSha256: string }): string | undefined {
  const dir = recipeDir(root, id)
  const gp = `${dir}/gate.json`
  if (!existsSync(gp)) return `${id}: no gate.json (run \`npm run steam-ingest -- gate ${id}\`)`
  let gate
  try {
    gate = Gate.parse(JSON.parse(readFileSync(gp, 'utf8')))
  } catch (e) {
    return `${id}: gate.json is not a valid gate file (${why1(e)})`
  }
  if (!gate.pass) {
    const failing = Object.entries(gate.results ?? {})
      .filter(([, v]) => !v.pass)
      .map(([k, v]) => `${k} ${v.detail.split(':')[0]}`)
    const why = failing.length ? failing.join(', ') : gate.state === 'waiting' ? `waiting: ${(gate.waiting ?? []).join(' · ')}` : (gate.errors?.[0] ?? gate.state)
    return `${id}: gate.json pass=false (${why})`
  }
  const rp = `${dir}/review.json`
  let reviewedBy = ''
  try {
    const r = JSON.parse(readFileSync(rp, 'utf8')) as { reviewedBy?: unknown }
    reviewedBy = typeof r.reviewedBy === 'string' ? r.reviewedBy.trim() : ''
    Review.parse(r)
  } catch {
    return `${id}: no valid review.json with a reviewedBy (a named reviewer signs the transcription and the edition page prints who; an agent may not write the catalog to skip that)`
  }
  if (!reviewedBy) return `${id}: review.json has an empty reviewedBy`
  let v
  try {
    v = verifyRecipe(root, id)
  } catch (e) {
    return `${id}: could not verify (${why1(e)})`
  }
  if (!v.ok) return `${id}: ${v.reason}`
  if (entry.gateSha256 !== v.gateSha256) return `${id}: the listed gateSha256 is not the SHA-256 of its gate.json`
  if (entry.title !== v.bundle.title) return `${id}: the listed title is not the recipe's title`
  return undefined
}

export function run(raw: string, deps: Deps = {}): HookResult {
  const input = parseHookInput(raw)
  const raw0 = input?.tool_input?.path
  // normalised first, so that content/./x/../catalog or a doubled slash cannot step around the match
  const path = typeof raw0 === 'string' ? posix.normalize(raw0.split('\\').join('/')) : undefined
  if (!input || path === undefined || !CATALOG_PATH.test(path)) return ok()
  // the repository the file lives in, from its own path; a relative path (the agent may send one) belongs to the event's cwd
  const prefix = path.slice(0, path.length - CATALOG_REL.length)
  const root = prefix ? resolve(rootOf(input), prefix) : path.startsWith('/') ? '/' : rootOf(input)
  const target = toRel(root, resolve(root, CATALOG_REL))
  const finish = (exit: number, result: string, stderr = ''): HookResult => {
    const logFailure = logHook(root, HOOK, target, result, deps.now)
    return { exit, stdout: '', stderr: [stderr, logFailure].filter(Boolean).join('\n') }
  }
  const use = catalogUse(CATALOG_REL)
  const p = proposed(input, resolve(root, path))
  if ('skip' in p) return finish(0, `allowed (${p.skip})`)
  if (!p.ok) return finish(2, `blocked: ${p.why}`, `${HOOK}: refused. ${p.why}, so it cannot be checked. ${use}`)
  let list
  try {
    list = Catalog.parse(JSON.parse(p.text))
  } catch (e) {
    const why = `the proposed ${CATALOG_REL} is not a catalog, [{id, title, gateSha256}] (${why1(e)})`
    return finish(2, `blocked: ${why}`, `${HOOK}: refused. ${why}. ${use}`)
  }
  const reasons: string[] = []
  const seen = new Set<string>()
  for (const e of list) {
    if (seen.has(e.id)) reasons.push(`${e.id}: listed twice`)
    else reasons.push(...[refuseReason(root, e.id, e)].filter((x): x is string => x !== undefined))
    seen.add(e.id)
  }
  if (reasons.length) {
    return finish(2, `blocked: ${reasons[0]}`, `${reasons.map((r) => `${HOOK}: ${r}`).join('\n')}\n${use}`)
  }
  return finish(0, `allowed: ${list.length} recipe${list.length === 1 ? '' : 's'} verified (gate pass, hashes match, review.json)`)
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
