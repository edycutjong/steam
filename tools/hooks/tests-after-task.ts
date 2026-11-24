// Hook tests-after-task (PostTaskExec): after a spec task completes, run the unit and property tests and log the counts.
// PostTaskExec is not reachable headless (probe-3.5.0 result 9). This hook is shipped for spec runs in the IDE; the README of
// docs/kiro-evidence counts it as seen only from the hooks.log lines it has actually written.

import { spawnSync } from 'node:child_process'
import { isMain, logHook, ok, parseHookInput, rootOf, runAsMain, type HookResult } from './lib.ts'

export const HOOK = 'tests-after-task'
export const COMMAND = 'npm test -- --reporter=dot'

export interface Counts {
  tests: { passed: number; failed: number; other: string[] }
  files: { passed: number; failed: number }
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g

/** Reads vitest's closing "Test Files" and "Tests" lines. Returns undefined when they are not there. */
export function parseCounts(output: string): Counts | undefined {
  const plain = output.replace(ANSI, '')
  const pick = (label: string): Map<string, number> | undefined => {
    const m = new RegExp(`^\\s*${label}\\s+(.+)$`, 'm').exec(plain)
    if (!m) return undefined
    const found = new Map<string, number>()
    for (const c of m[1]!.matchAll(/(\d+)\s+(failed|passed|skipped|todo|expected fail)/g)) found.set(c[2]!, Number(c[1]))
    return found
  }
  const tests = pick('Tests')
  const files = pick('Test Files')
  if (!tests || !files || (!tests.size && !files.size)) return undefined
  return {
    tests: { passed: tests.get('passed') ?? 0, failed: tests.get('failed') ?? 0, other: [...tests].filter(([k]) => k !== 'passed' && k !== 'failed').map(([k, n]) => `${n} ${k}`) },
    files: { passed: files.get('passed') ?? 0, failed: files.get('failed') ?? 0 },
  }
}

export interface Exec {
  status: number | null
  output: string
}

export interface Deps {
  exec?: (root: string) => Exec
  now?: () => Date
}

/** The command line: `npm test -- --reporter=dot`, or STEAM_HOOK_TEST_CMD (a seam so the script can be piped to without running the suite). */
export function defaultExec(root: string, env: NodeJS.ProcessEnv = process.env): Exec {
  const r = spawnSync(env.STEAM_HOOK_TEST_CMD || COMMAND, { cwd: root, shell: true, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024 })
  return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}` }
}

export function run(raw: string, deps: Deps = {}): HookResult {
  const input = parseHookInput(raw)
  if (!input) return ok()
  const root = rootOf(input)
  const r = (deps.exec ?? defaultExec)(root)
  const c = parseCounts(r.output)
  let state: 'pass' | 'fail' | 'error'
  let result: string
  if (!c) {
    state = 'error'
    result = `error exit ${r.status}, no vitest summary in the output`
  } else {
    state = r.status === 0 && c.tests.failed === 0 && c.files.failed === 0 ? 'pass' : 'fail'
    const extra = c.tests.other.length ? `, ${c.tests.other.join(', ')}` : ''
    result = `${state} ${c.tests.passed} passed, ${c.tests.failed} failed${extra} · files ${c.files.passed} passed, ${c.files.failed} failed · exit ${r.status}`
  }
  const logFailure = logHook(root, HOOK, COMMAND, result, deps.now)
  if (state === 'pass') return { exit: 0, stdout: `${HOOK}: ${result}`, stderr: logFailure ?? '' }
  const tail = r.output.replace(ANSI, '').split('\n').filter((l) => l.trim()).slice(-30).join('\n')
  // exit 1 warns and does not undo the task; the failing counts are for the next turn to read
  return { exit: 1, stdout: '', stderr: `${HOOK}: ${result}\n${tail}${logFailure ? `\n${logFailure}` : ''}` }
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
