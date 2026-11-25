// Hook src-scan-after-shell (PostToolUse, matcher "shell"): the backstop of shell-gate. A script can write a file the command
// text never names (`node scripts/x.ts`, a path built from parts), so after every shell command this hook judges the working tree:
//
//   - the lines ADDED under src/ since HEAD (`git diff -U0 HEAD`, staged and unstaged, plus untracked files), non-test files only,
//     with no-imitation's `findViolations` (the file as a whole, so comments are read in context; only the added lines are reported);
//   - the public catalog: when it differs from HEAD, it must be the content that `npm run catalog` wrote (the command of this
//     event, or an earlier one whose content hash was remembered), else it fails with catalog-gate's reason.
//
// Exit 2 with the finding on a fail, on every command while the fail stands, so the agent reads it. One hooks.log line only when
// the judged state changed since the last line (a hash of the verdict under node_modules/.cache/steam-hooks/): `fail <what>
// (<file>:<line>)`, `pass (<n> files)` or `unscanned (git: …)`. Fail open on anything it cannot run, and say so in that line.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { catalogUse } from './catalog-rule.ts'
import { isMain, logHook, ok, parseHookInput, rootOf, runAsMain, type HookResult } from './lib.ts'
import { findViolations, isTestFile, RULES } from './no-imitation.ts'
import { CATALOG_PATH, runsCatalogCommand } from './shell-writes.ts'

export const HOOK = 'src-scan'

export interface Deps {
  now?: () => Date
}

const MAX_BYTES = 1024 * 1024
const CATALOG_FAIL = 'the catalog differs from HEAD and was not written by npm run catalog'

interface Cache {
  hash: string
  trusted: string[]
}

const cacheFile = (root: string): string => join(root, 'node_modules', '.cache', 'steam-hooks', 'src-scan.json')

function loadCache(root: string): Cache {
  try {
    const v = JSON.parse(readFileSync(cacheFile(root), 'utf8')) as Partial<Cache>
    return { hash: typeof v.hash === 'string' ? v.hash : '', trusted: Array.isArray(v.trusted) ? v.trusted.filter((x): x is string => typeof x === 'string') : [] }
  } catch {
    return { hash: '', trusted: [] }
  }
}

function saveCache(root: string, c: Cache): void {
  try {
    mkdirSync(join(root, 'node_modules', '.cache', 'steam-hooks'), { recursive: true })
    writeFileSync(cacheFile(root), JSON.stringify({ hash: c.hash, trusted: c.trusted.slice(-20) }))
  } catch {
    // a cache that cannot be written only means one more log line next time
  }
}

class GitError extends Error {}

function git(root: string, args: string[]): string {
  const r = spawnSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.error) throw new GitError(r.error.message)
  if (r.status !== 0) throw new GitError((r.stderr.trim().split('\n')[0] ?? `exit ${r.status}`) || `exit ${r.status}`)
  return r.stdout
}

/** Added line numbers of each file under src/, from `git diff -U0`. */
export function addedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()
  let file: string | undefined
  let n = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/\t.*$/, '')
      file = p === '/dev/null' ? undefined : p.replace(/^b\//, '')
      if (file && !out.has(file)) out.set(file, new Set())
    } else if (line.startsWith('@@')) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      n = m ? Number(m[1]) : 0
    } else if (file && line.startsWith('+')) out.get(file)!.add(n++)
  }
  return out
}

interface Finding {
  file: string
  line: number
  what: string
  kind: keyof typeof RULES | 'catalog'
}

function readable(root: string, rel: string): string | undefined {
  const p = join(root, rel)
  try {
    if (statSync(p).size > MAX_BYTES) return undefined
    const buf = readFileSync(p)
    return buf.subarray(0, 8000).includes(0) ? undefined : buf.toString('utf8')
  } catch {
    return undefined
  }
}

const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')

export function run(raw: string, deps: Deps = {}): HookResult {
  const input = parseHookInput(raw)
  if (!input) return ok()
  const root = rootOf(input)
  const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : ''
  const cache = loadCache(root)

  const finish = (exit: number, target: string, result: string, key: string, stderr = ''): HookResult => {
    const hash = sha(key)
    let failure: string | undefined
    if (hash !== cache.hash) failure = logHook(root, HOOK, target, result, deps.now)
    saveCache(root, { hash, trusted: cache.trusted })
    return { exit, stdout: '', stderr: [stderr, failure].filter(Boolean).join('\n') }
  }

  let judged = 0
  const findings: Finding[] = []
  let catalogChanged = false
  try {
    const added = addedLines(git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', 'src']))
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', 'src']).split('\0').filter(Boolean)
    const files = new Map<string, Set<number> | 'all'>()
    for (const [f, s] of added) if (s.size) files.set(f, s)
    for (const f of untracked) files.set(f, 'all')
    for (const [file, lines] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      if (!file.startsWith('src/') || isTestFile(file)) continue
      const text = readable(root, file)
      if (text === undefined) continue
      judged++
      for (const f of findViolations(text)) if (lines === 'all' || lines.has(f.line)) findings.push({ file, line: f.line, what: f.what, kind: f.kind })
    }
    catalogChanged = git(root, ['status', '--porcelain', '--untracked-files=all', '--', CATALOG_PATH]).trim() !== ''
  } catch (e) {
    const why = (e as Error).message.replace(/\s+/g, ' ').slice(0, 160)
    return finish(0, 'src/', `unscanned (git: ${why})`, `unscanned:${why}`)
  }

  if (catalogChanged) {
    const digest = existsSync(join(root, CATALOG_PATH)) ? sha(readFileSync(join(root, CATALOG_PATH))) : 'deleted'
    if (command && runsCatalogCommand(command) && !cache.trusted.includes(digest)) cache.trusted.push(digest)
    if (!cache.trusted.includes(digest)) findings.push({ file: CATALOG_PATH, line: 0, what: CATALOG_FAIL, kind: 'catalog' })
  }

  if (!findings.length) return finish(0, 'src/', `pass (${judged} files)`, `pass:${judged}`)

  const label = (f: Finding): string => (f.kind === 'catalog' ? `${f.what} (${f.file})` : `${f.what} (${f.file}:${f.line})`)
  const stderr = [
    ...findings.map((f) => {
      if (f.kind === 'catalog') return `${HOOK}: ${f.file} differs from HEAD and was not written by npm run catalog. ${catalogUse(CATALOG_PATH)} Undo the change with git checkout -- ${f.file} if it is not wanted.`
      const r = RULES[f.kind]
      return `${HOOK}: ${f.file}:${f.line}: ${f.what}. Rule (.kiro/steering/product.md, "${r.section}"): "${r.text}"`
    }),
    ...(findings.some((f) => f.kind !== 'catalog') ? [`${HOOK}: a command wrote this where shell-gate could not see it in the command text. Remove the added line (git diff -- src) and carry on; this message repeats after every shell command until it is gone.`] : []),
  ].join('\n')
  return finish(2, findings[0]!.file, `fail ${findings.map(label).join(', ')}`, `fail:${findings.map((f) => `${f.file}:${f.line}:${f.what}`).join('|')}:${judged}`, stderr)
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
