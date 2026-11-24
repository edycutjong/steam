// docs/kiro-evidence/hooks.log: one line per gate run, append only (R33).

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type GateState = 'pass' | 'fail' | 'waiting'

export function formatHookLine(at: Date, who: string, recipe: string, state: GateState, detail: string): string {
  const one = (s: string) => s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${at.toISOString()} · ${one(who)} · ${one(recipe)} · ${state}${detail ? ` ${one(detail)}` : ''}\n`
}

/** R33.2: $STEAM_WHO, then --who, then "cli", or "watch" in --once mode. */
export function whoOf(o: { env?: string; flag?: string; once?: boolean }): string {
  if (o.env) return o.env
  if (o.flag) return o.flag
  return o.once ? 'watch' : 'cli'
}

/** Appends one line; throws on any failure so that an unlogged run fails (R33.5). */
export function appendHookLine(path: string, line: string): void {
  if (!line.endsWith('\n') || line.slice(0, -1).includes('\n')) throw new Error('hooks.log: a log entry must be exactly one line')
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, line, { flag: 'a' })
}
