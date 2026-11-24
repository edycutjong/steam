// Hook props-on-save (PostFileSave and PostFileCreate): when an agent writes a gate input of a recipe, run the gate for that
// recipe and log one line. It gates; it never blocks the save, so the exit code is always 0.
// The gate is idempotent through its input-hash lock (R30), so the repeated firing that probe-3.5.0 saw (two File hooks per
// write, one per workflow step session) costs a no-op run.

import { resolve } from 'node:path'
import { gateCmd } from '../steam-ingest/gate.ts'
import { isMain, logHook, ok, parseHookInput, rootOf, runAsMain, toRel, type HookResult } from './lib.ts'

export const HOOK = 'props-on-save'

/**
 * `matcher` in .kiro/hooks/props-on-save.json without the leading path boundary. Kiro tests a regular expression against the
 * absolute path (probe-3.5.0: globs never fire); this one also refuses a folder that merely ends in "content".
 */
export const SAVE_PATH = /(?:^|\/)content\/recipes\/([^/]+)\/(agent\/[^/]+\.json|alignment\.json|transcription\.md|ownership-review\.json)$/

const RECIPE_ID = /^[a-z0-9][a-z0-9-]*$/

export interface Deps {
  now?: () => Date
}

export function run(raw: string, deps: Deps = {}): HookResult {
  const input = parseHookInput(raw)
  if (!input || typeof input.file_path !== 'string') return ok()
  const m = SAVE_PATH.exec(input.file_path.split('\\').join('/'))
  if (!m) return ok()
  const id = m[1]!
  // the repository the saved file lives in, from its own path; the event's cwd resolves a relative path
  const root = m[0].startsWith('/') ? resolve(rootOf(input), input.file_path.slice(0, m.index) || '/') : rootOf(input)
  const target = `${id} ← ${toRel(root, input.file_path)}`
  let result: string
  let say = ''
  try {
    if (!RECIPE_ID.test(id)) throw new Error(`"${id}" is not a recipe id`)
    const r = gateCmd(id, { root, who: HOOK, noLog: true, now: deps.now })
    if (r.state === 'pass') result = `pass P1-P6 ok${r.changed ? '' : ' · no-op (inputs unchanged)'}`
    else if (r.state === 'waiting') result = `waiting ${(r.gate.waiting ?? []).join(' · ')}`
    else {
      const failing = Object.entries(r.gate.results ?? {})
        .filter(([, v]) => !v.pass)
        .map(([k, v]) => `${k} ${v.detail.split(':')[0]}`)
      const why = failing.length ? failing.join(', ') : (r.gate.errors?.[0] ?? r.firstFailure ?? 'see gate.json')
      result = `fail ${why}${r.changed ? '' : ' · no-op (inputs unchanged)'}`
    }
    say = `${HOOK}: gate ${id}: ${result}`
  } catch (e) {
    // a recipe folder that is not ready (no source.json or lines.json yet) is an event worth a line, not a failure of the save
    // the message names the folder by its absolute path; the log is public, so keep it repository-relative
    result = `error ${(e as Error).message.split('\n')[0]!.split(`${root}/`).join('')}`
    say = `${HOOK}: gate ${id} did not run: ${result}`
  }
  const logFailure = logHook(root, HOOK, target, result, deps.now)
  return { exit: 0, stdout: say, stderr: logFailure ?? '' }
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
