// steam-ingest gate --once: the Kiro workflow watch-node protocol (R32). One JSON object in, one JSON line out.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { Fallback, Reading, Scribe } from '../../src/data/schema.ts'
import { gateCmd, recipeDir } from './gate.ts'
import { sha256 } from './io.ts'

// Nothing but the one result line may reach stdout: a library that logs is sent to stderr.
console.log = (...a: unknown[]) => console.error(...a)

export const Cursor = z.object({ v: z.literal(1), polls: z.number().int().nonnegative(), invalid: z.record(z.string(), z.string()) })
export type Cursor = z.infer<typeof Cursor>
export const WatchOut = z.union([
  z.strictObject({ outcome: z.literal('idle'), cursor: Cursor.nullable() }),
  z.strictObject({ outcome: z.literal('terminal-state'), cursor: Cursor.nullable(), payload: z.string() }),
])
export type WatchOut = z.infer<typeof WatchOut>

export interface OnceResult {
  /** The exact bytes for stdout (one line), or '' when the exit code is not 0. */
  stdout: string
  exit: number
  stderr: string[]
}

const READERS: [string, z.ZodType][] = [
  ['agent/scribe.json', Scribe],
  ['agent/second.json', Reading],
  ['fallback/reading.json', Fallback],
]

export function once(stdin: string, env: { now?: () => Date } = {}): OnceResult {
  const stderr: string[] = []
  let input: unknown
  try {
    input = JSON.parse(stdin)
  } catch {
    return { stdout: '', exit: 2, stderr: ['--once: stdin is not JSON'] }
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { stdout: '', exit: 2, stderr: ['--once: stdin is not a JSON object'] }
  const o = input as { cursor?: unknown; config?: { recipe?: unknown }; workspacePath?: unknown }
  const id = o.config?.recipe
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(id)) return { stdout: '', exit: 2, stderr: ['--once: config.recipe is missing or not [a-z0-9][a-z0-9-]*'] }
  const root = typeof o.workspacePath === 'string' ? o.workspacePath : process.cwd()
  if (!existsSync(recipeDir(root, id))) return { stdout: '', exit: 2, stderr: [`--once: no recipe folder content/recipes/${id} under ${root}`] }
  try {
    const parsed = Cursor.safeParse(o.cursor)
    const cursor: Cursor = parsed.success ? { ...parsed.data, polls: parsed.data.polls + 1 } : { v: 1, polls: 1, invalid: {} }
    // R32.5: an invalid reader file waits one poll for an agent that may still be writing it
    const dir = recipeDir(root, id)
    const nextInvalid: Record<string, string> = {}
    let fresh = false
    for (const [f, schema] of READERS) {
      const p = join(dir, f)
      if (!existsSync(p)) continue
      const bytes = readFileSync(p)
      let ok = false
      try {
        ok = schema.safeParse(JSON.parse(bytes.toString('utf8'))).success
      } catch {
        ok = false
      }
      if (ok) continue
      const h = sha256(bytes)
      nextInvalid[f] = h
      if (cursor.invalid[f] !== h) fresh = true
    }
    const next: Cursor = { ...cursor, invalid: nextInvalid }
    if (fresh) {
      stderr.push(`--once: invalid reader file seen for the first time (${Object.keys(nextInvalid).join(', ')}); waiting one poll`)
      return { stdout: JSON.stringify(WatchOut.parse({ outcome: 'idle', cursor: next })) + '\n', exit: 0, stderr }
    }
    const r = gateCmd(id, { root, once: true, now: env.now })
    stderr.push(r.logLine?.trim() ?? '')
    let out: WatchOut
    if (r.state === 'waiting') out = { outcome: 'idle', cursor: next }
    else if (r.state === 'pass') {
      const gateSha256 = sha256(readFileSync(join(dir, 'gate.json')))
      out = { outcome: 'terminal-state', cursor: next, payload: JSON.stringify({ pass: true, gateSha256, reviewed: r.gate.reviewed ?? [] }) }
    } else {
      const failing = r.gate.results ? Object.entries(r.gate.results).filter(([, v]) => !v.pass).map(([k, v]) => `${k}: ${v.detail}`) : []
      out = { outcome: 'terminal-state', cursor: next, payload: JSON.stringify({ pass: false, failing: [...(r.gate.errors ?? []), ...failing] }) }
    }
    return { stdout: JSON.stringify(WatchOut.parse(out)) + '\n', exit: 0, stderr }
  } catch (e) {
    // R32.6: an unexpected exception is a non-zero exit other than 2 (Kiro counts an idle poll)
    return { stdout: '', exit: 1, stderr: [...stderr, (e as Error).stack ?? String(e)] }
  }
}
