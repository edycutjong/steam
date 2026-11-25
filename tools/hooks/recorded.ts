// Hook stdin documents in the exact shape kiro-cli 3.5.0 sent them in the probe
// (docs/kiro-evidence/probe-3.5.0/run1.hooks.log, run8.hooks.log): same keys, same nesting, same tool_input field names.
// Test helper only.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const session = 'sess_8dd0f083-ec5b-4e58-ab03-ef4f50d89af3'

export const postFile = (event: 'PostFileSave' | 'PostFileCreate', cwd: string, filePath: string): string =>
  JSON.stringify({ session_id: session, hook_event_name: event, cwd, file_path: filePath })

/** PreToolUse on fs_write: tool_input is {path, text}. */
export const preFsWrite = (cwd: string, path: string, text: string): string =>
  JSON.stringify({ session_id: session, hook_event_name: 'PreToolUse', cwd, tool_name: 'fs_write', tool_input: { path, text } })

/** PreToolUse on str_replace: tool_input is {path, oldStr, newStr, replace_all}. */
export const preStrReplace = (cwd: string, path: string, oldStr: string, newStr: string, replaceAll = false): string =>
  JSON.stringify({ session_id: session, hook_event_name: 'PreToolUse', cwd, tool_name: 'str_replace', tool_input: { path, oldStr, newStr, replace_all: replaceAll } })

/** PostTaskExec was never seen headless (probe-3.5.0 result 9); only the common keys are known. */
export const postTask = (cwd: string): string => JSON.stringify({ session_id: session, hook_event_name: 'PostTaskExec', cwd })

/** Pipes `stdin` into a hook script exactly as Kiro does (`npx tsx <script>` from the repository root). */
export function pipeToScript(script: string, stdin: string, extraEnv: Record<string, string> = {}) {
  const r = spawnSync('npx', ['tsx', script], { cwd: resolve(import.meta.dirname, '../..'), input: stdin, encoding: 'utf8', env: { ...process.env, ...extraEnv } })
  return { exit: r.status, stdout: r.stdout, stderr: r.stderr }
}

/** The shell hook stdin recorded in the session that wrote the hook-coverage spec (kiro-cli IDE, PreToolUse, tool execute_bash). */
export const recordedShellEvent = (): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../../docs/kiro-evidence/hook-coverage/shell-event.json'), 'utf8')) as Record<string, unknown>

/** PreToolUse on a shell tool: the recorded event with `cwd` and `tool_input.command` replaced (and `tool_input.cwd` when given). */
export function preShell(cwd: string, command: string, toolCwd?: string, event: 'PreToolUse' | 'PostToolUse' = 'PreToolUse'): string {
  const e = recordedShellEvent()
  const input = { ...(e.tool_input as Record<string, unknown>), command, ...(toolCwd === undefined ? {} : { cwd: toolCwd }) }
  return JSON.stringify({ ...e, hook_event_name: event, cwd, tool_input: input })
}

/** Pipes `stdin` into a hook script the way the shell hooks are started: `node <script>` from the repository root. */
export function pipeToNode(script: string, stdin: string, extraEnv: Record<string, string> = {}) {
  const r = spawnSync('node', [script], { cwd: resolve(import.meta.dirname, '../..'), input: stdin, encoding: 'utf8', env: { ...process.env, ...extraEnv } })
  return { exit: r.status, stdout: r.stdout, stderr: r.stderr }
}
