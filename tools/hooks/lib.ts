// Shared plumbing for the Kiro hook scripts: parse the hook's stdin JSON, append ONE line to docs/kiro-evidence/hooks.log,
// and map a result to an exit code. Shapes were recorded on kiro-cli 3.5.0 (docs/kiro-evidence/probe-3.5.0/*.hooks.log).

import { readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { appendHookLine } from '../steam-ingest/hookslog.ts'

/** What Kiro writes to a hook's stdin. File hooks carry `file_path`; tool hooks carry `tool_name` and `tool_input`. */
export interface HookInput {
  session_id?: string
  hook_event_name?: string
  cwd?: string
  file_path?: string
  tool_name?: string
  tool_input?: Record<string, unknown>
  tool_response?: unknown
}

export interface HookResult {
  /** 0 allow / ok, 2 block (PreToolUse; stderr goes back to the agent), anything else warns and allows. */
  exit: number
  stdout: string
  stderr: string
}

export const ok = (stdout = ''): HookResult => ({ exit: 0, stdout, stderr: '' })

export function parseHookInput(raw: string): HookInput | null {
  try {
    const v: unknown = JSON.parse(raw)
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as HookInput) : null
  } catch {
    return null
  }
}

export const hooksLogFile = (root: string): string => join(root, 'docs', 'kiro-evidence', 'hooks.log')

const one = (s: string): string => s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()

/** `<ISO time> · <hook> · <target> · <result>`, the same U+00B7 shape as the gate's own lines (R33.1). */
export function hookLine(at: Date, hook: string, target: string, result: string): string {
  const r = one(result)
  return `${at.toISOString()} · ${one(hook)} · ${one(target)} · ${r.length > 400 ? `${r.slice(0, 399)}…` : r}\n`
}

/** Appends one line. Returns a message when the append failed; a hook never lets a log failure change its verdict. */
export function logHook(root: string, hook: string, target: string, result: string, now: () => Date = () => new Date()): string | undefined {
  try {
    appendHookLine(hooksLogFile(root), hookLine(now(), hook, target, result))
    return undefined
  } catch (e) {
    return `${hook}: could not append to hooks.log: ${(e as Error).message}`
  }
}

/** The workspace root a hook event belongs to. */
export const rootOf = (i: HookInput): string => (typeof i.cwd === 'string' && isAbsolute(i.cwd) ? i.cwd : process.cwd())

/** `p` relative to `root` with forward slashes, or `p` unchanged when it lies outside. */
export function toRel(root: string, p: string): string {
  const r = relative(resolve(root), resolve(root, p))
  return r === '' || r.startsWith('..') || isAbsolute(r) ? p : r.split('\\').join('/')
}

/** Runs `fn` on stdin and exits with its code. Only called when the file is the entry point. */
export function runAsMain(fn: (raw: string) => HookResult): void {
  let r: HookResult
  try {
    r = fn(readFileSync(0, 'utf8'))
  } catch (e) {
    // an unexpected exception warns (exit 1) and allows; a hook's own bug must not look like a policy block
    process.stderr.write(`${(e as Error).stack ?? String(e)}\n`)
    process.exit(1)
  }
  if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : `${r.stdout}\n`)
  if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : `${r.stderr}\n`)
  process.exit(r.exit)
}

export const isMain = (metaUrl: string): boolean => process.argv[1] !== undefined && metaUrl === pathToFileURL(process.argv[1]).href
