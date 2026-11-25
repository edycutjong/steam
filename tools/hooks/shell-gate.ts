// Hook shell-gate (PreToolUse, matcher "shell"; Kiro's tag for every shell tool, `execute_bash` in the recorded event
// docs/kiro-evidence/hook-coverage/shell-event.json). The write gates no-imitation and catalog-gate match "write", which is
// fs_write and str_replace only, and most files of this repository are written by shell commands (docs/kiro-evidence/sessions/).
// This hook closes that gap before the command runs:
//
//   - a command that writes a non-test file under src/ has the text it introduces (heredoc bodies, echo/printf payloads, sed
//     replacements, inline scripts) judged by no-imitation's `findViolations`; a violation exits 2 with the rule text;
//   - a command that writes the public catalog by any means exits 2 with catalog-gate's reason: only `npm run catalog` writes it
//     (that command writes through a program, so no redirect or script of the command text names the catalog);
//   - one hooks.log line per such command (`shell-gate · <target> · blocked: … | pass (…)`), and none for any other command;
//   - a command it cannot read is allowed, and when it names src/ or the catalog the line says `unparsed`.
//
// What it cannot see is in shell-writes.ts. src-scan.ts (PostToolUse) judges the files after the command ran.

import { CATALOG_FILE, CATALOG_PATH, analyzeShell, type ShellAnalysis } from './shell-writes.ts'
import { catalogUse } from './catalog-rule.ts'
import { isMain, logHook, ok, parseHookInput, rootOf, runAsMain, type HookResult } from './lib.ts'
import { findViolations, RULES } from './no-imitation.ts'

export const HOOK = 'shell-gate'

export interface Deps {
  now?: () => Date
}

/** Spelled so that the line is true to what it judged: the same three rules as no-imitation. */
const PASS = 'no speech synthesis, handwriting font or handwriting package in the text the command introduces'
const BLIND = 'the content is not in the command text; src-scan judges the file after'
const CATALOG_REASON = 'a shell command writes the catalog; only npm run catalog writes it'

const mentionsJudged = (command: string): boolean => /(?:^|[\s'"=:>/])src\//.test(command) || command.includes(CATALOG_FILE)

export function run(raw: string, deps: Deps = {}): HookResult {
  const input = parseHookInput(raw)
  const command = input?.tool_input?.command
  if (!input || typeof command !== 'string') return ok()
  const root = rootOf(input)
  const toolCwd = input.tool_input?.cwd
  let a: ShellAnalysis
  try {
    a = analyzeShell(command, { root, cwd: typeof toolCwd === 'string' && toolCwd !== '' ? toolCwd : undefined })
  } catch {
    a = { parsed: false, targets: [], text: '', blind: false }
  }

  const srcTargets = a.targets.filter((t) => t.kind === 'src' && !t.test)
  const catalogTargets = a.targets.filter((t) => t.kind === 'catalog')
  const unparsed = !a.parsed
  if (!srcTargets.length && !catalogTargets.length && !(unparsed && mentionsJudged(command))) return ok()

  const finish = (exit: number, target: string, result: string, stderr = ''): HookResult => {
    const failure = logHook(root, HOOK, target, result, deps.now)
    return { exit, stdout: '', stderr: [stderr, failure].filter(Boolean).join('\n') }
  }

  const named = [...srcTargets, ...catalogTargets].map((t) => t.path)
  const target = named.length ? (named.length > 3 ? `${named.slice(0, 3).join(', ')} (+${named.length - 3})` : named.join(', ')) : '(unparsed command)'
  const where = srcTargets[0]?.path ?? '(command)'

  const found = srcTargets.length ? findViolations(a.text) : []
  const reasons = [found.map((f) => `${f.what} (line ${f.line})`).join(', '), ...(catalogTargets.length ? [CATALOG_REASON] : [])].filter(Boolean)
  if (reasons.length) {
    const stderr = [
      ...found.map((f) => {
        const r = RULES[f.kind]
        return `${HOOK}: ${where}:${f.line}: ${f.what}. Rule (.kiro/steering/product.md, "${r.section}"): "${r.text}"`
      }),
      ...(found.length ? [`${HOOK}: shell command refused. The writer's hand appears only as pixels from the photographed scan. Remove ${found.length === 1 ? 'this' : 'these'} and run it again. Line numbers count from the first line of the text the command introduces.`] : []),
      ...(catalogTargets.length ? [`${HOOK}: ${CATALOG_REASON}. ${catalogUse(CATALOG_PATH)}`] : []),
    ].join('\n')
    return finish(2, target, `blocked: ${reasons.join(' | ')}`, stderr)
  }
  const notes = [...(unparsed ? ['unparsed: the command could not be read to the end, so only part of it was checked; src-scan judges the files after'] : []), ...(a.blind ? [BLIND] : [])]
  return finish(0, target, `pass (${[srcTargets.length ? PASS : '', ...notes].filter(Boolean).join('; ') || 'nothing to judge'})`)
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
