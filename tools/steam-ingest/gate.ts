// steam-ingest gate <id> | --all [--verify]: read, run, write, re-read, log (R30 to R33, R38.3).

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Gate } from '../../src/data/schema.ts'
import { runGate, verifyWritten, type GateCtx, type GateResult } from '../../src/ingest/gate.ts'
import { pixelSha256, type Rgba } from '../../src/ingest/image.ts'
import { formatHookLine, appendHookLine, whoOf, type GateState } from './hookslog.ts'
import { canonicalJson, decodePng, writeJson, writePng } from './io.ts'
import { loadScan } from './segment.ts'

export const recipeDir = (root: string, id: string) => join(root, 'content', 'recipes', id)
export const hooksLogPath = (root: string) => join(root, 'docs', 'kiro-evidence', 'hooks.log')

const OPTIONAL = ['agent/scribe.json', 'agent/second.json', 'fallback/reading.json', 'alignment.json', 'transcription.md', 'ownership-review.json'] as const

export interface GateOpts {
  root: string
  who?: string
  once?: boolean
  /** Write nothing; compare with the committed gate.json and files (R38.3). */
  verify?: boolean
  /** Clock for `at` and the log (tests inject one). */
  now?: () => Date
  /** Skip the hooks.log line (only for --verify, which is not a gate run of record). */
  noLog?: boolean
}

export interface GateRun {
  state: GateState
  gate: Gate
  /** True when gate.json or any artifact was (or, with --verify, would be) rewritten. */
  changed: boolean
  firstFailure?: string
  logLine?: string
  notes: string[]
}

function readCtx(root: string, id: string): GateCtx {
  const dir = recipeDir(root, id)
  const txt = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : undefined)
  const files: Record<string, string | undefined> = { 'source.json': txt('source.json'), 'lines.json': txt('lines.json') }
  if (files['source.json'] === undefined || files['lines.json'] === undefined) throw new UsageError(`${dir}: source.json and lines.json are needed (run fetch and segment)`)
  for (const f of OPTIONAL) files[f] = txt(f)
  const { scan } = loadScan(dir)
  const ctx: GateCtx = { recipeId: id, pageBytes: readFileSync(join(dir, 'page.jpg')), scan, files: files as GateCtx['files'] }
  // fixtures belong to the recipe they were made for (R20, R30.7)
  const gold = join(root, 'fixtures', 'gold-readings.json')
  if (existsSync(gold) && JSON.parse(readFileSync(gold, 'utf8')).recipe === id) {
    ctx.gold = readFileSync(gold, 'utf8')
    const hero = join(root, 'fixtures', 'hero-word-bounds.json')
    if (existsSync(hero)) ctx.heroFixture = readFileSync(hero, 'utf8')
  }
  return ctx
}

export class UsageError extends Error {}

const sameExceptAt = (a: unknown, b: unknown): boolean => {
  const strip = (g: unknown) => {
    const { at: _at, ...rest } = g as Record<string, unknown>
    void _at
    return canonicalJson(rest)
  }
  return strip(a) === strip(b)
}

/** Existing file's pixel hash (PNG) or bytes (JSON) equals the computed one. */
function sameFile(path: string, png?: Rgba, json?: unknown): boolean {
  if (!existsSync(path)) return false
  if (png) {
    try {
      return pixelSha256(decodePng(readFileSync(path))) === pixelSha256(png)
    } catch {
      return false
    }
  }
  return readFileSync(path, 'utf8') === canonicalJson(json)
}

function staleArtifacts(dir: string, r: GateResult): string[] {
  const out: string[] = []
  for (const sub of ['notes', 'ownership']) {
    const d = join(dir, sub)
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) {
      const rel = `${sub}/${f}`
      if (sub === 'ownership' && !/^flag-\d+\.png$/.test(f)) continue
      if (!r.artifacts.png.has(rel) && !r.artifacts.json.has(rel) && statSync(join(d, f)).isFile()) out.push(rel)
    }
  }
  return out
}

export function gateCmd(id: string, o: GateOpts): GateRun {
  const now = o.now ?? (() => new Date())
  const dir = recipeDir(o.root, id)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !existsSync(dir)) throw new UsageError(`no recipe folder content/recipes/${id}`)
  const r = runGate(readCtx(o.root, id))
  const notes: string[] = []
  let state: GateState = r.state
  let firstFailure = r.firstFailure
  let gateBody = r.gate

  // files the run would write
  const want: { rel: string; png?: Rgba; json?: unknown }[] = [
    ...[...r.artifacts.png].map(([rel, png]) => ({ rel, png })),
    ...[...r.artifacts.json].map(([rel, json]) => ({ rel, json })),
  ]
  const differing = want.filter((w) => !sameFile(join(dir, w.rel), w.png, w.json))
  const stale = state === 'waiting' ? [] : staleArtifacts(dir, r)
  if (!o.verify) {
    for (const w of differing) {
      if (existsSync(join(dir, w.rel))) notes.push(`rewrote ${w.rel}: it differed from the computed ${w.png ? 'pixels' : 'bytes'}`)
      if (w.png) writePng(join(dir, w.rel), w.png)
      else writeJson(join(dir, w.rel), w.json)
    }
    for (const s of stale) {
      rmSync(join(dir, s))
      notes.push(`removed stale ${s}`)
    }
  } else {
    for (const w of differing) notes.push(`${w.rel} differs from the computed ${w.png ? 'pixels' : 'bytes'}`)
    for (const s of stale) notes.push(`${s} is stale`)
  }

  // R30.1: judge what was written (or, with --verify, what is committed)
  if (r.checks.length) {
    const decoded = new Map<string, Rgba>()
    for (const c of r.checks)
      for (const p of [c.pngPath, c.toiPath]) if (existsSync(join(dir, p))) decoded.set(p, decodePng(readFileSync(join(dir, p))))
    const onDisk = verifyWritten(r.checks, decoded)
    const mem = r.gate.results!
    const mismatch = (['P4', 'P5', 'P6'] as const).filter((k) => onDisk[k].pass !== mem[k].pass || onDisk[k].detail !== mem[k].detail)
    const hashMismatch = Object.entries(r.gate.outputs).filter(([rel, h]) => rel.endsWith('.png') && (!decoded.has(rel) || pixelSha256(decoded.get(rel)!) !== h))
    if (mismatch.length || hashMismatch.length) {
      state = 'fail'
      const msg = `written files differ from computed arrays (${[...mismatch, ...hashMismatch.map(([rel]) => rel)].join(', ')})`
      firstFailure = msg
      gateBody = { ...gateBody, state: 'fail', pass: false, errors: [...(gateBody.errors ?? []), msg], results: { ...mem, ...onDisk } }
    }
  }

  const gp = join(dir, 'gate.json')
  const prev = existsSync(gp) ? JSON.parse(readFileSync(gp, 'utf8')) : undefined
  const unchanged = prev !== undefined && sameExceptAt(prev, gateBody)
  const gate = Gate.parse(unchanged ? prev : { ...gateBody, at: now().toISOString() })
  const changed = !unchanged || differing.length > 0 || stale.length > 0
  if (o.verify) {
    if (!unchanged) {
      notes.push(prev ? 'committed gate.json differs from a fresh gate run' : 'no committed gate.json')
      if (state === 'pass') {
        state = 'fail'
        firstFailure = notes[notes.length - 1]
      }
    }
    if (differing.length || stale.length) {
      if (state === 'pass') state = 'fail'
      firstFailure ??= notes[0]
    }
  } else if (!unchanged) writeJson(gp, gate)

  let logLine: string | undefined
  if (!o.noLog) {
    const detail = [state === 'waiting' ? (r.gate.waiting ?? []).join(' · ') : state === 'pass' ? r.logDetail : firstFailure && !r.logDetail.includes(firstFailure) ? `${r.logDetail} · ${firstFailure}` : r.logDetail, unchanged && !o.verify ? 'no-op (inputs unchanged)' : '']
      .filter(Boolean)
      .join(' · ')
    logLine = formatHookLine(now(), whoOf({ env: process.env.STEAM_WHO, flag: o.who, once: o.once }), id, state, detail)
    appendHookLine(hooksLogPath(o.root), logLine)
  }
  return { state, gate, changed, firstFailure, logLine, notes }
}

export function allRecipes(root: string): string[] {
  const d = join(root, 'content', 'recipes')
  return existsSync(d) ? readdirSync(d).filter((f) => statSync(join(d, f)).isDirectory()).sort() : []
}

export const exitCodeOf = (s: GateState): number => (s === 'pass' ? 0 : s === 'fail' ? 1 : 3)
