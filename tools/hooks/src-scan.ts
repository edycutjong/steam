// Hook src-scan-after-shell (PostToolUse, matcher "shell"): the backstop of shell-gate. A script can write a file the command
// text never names (`node scripts/x.ts`, a path built from parts), so after every shell command this hook judges the working tree:
//
//   - the lines ADDED under src/ since HEAD (`git diff -U0 HEAD`, staged and unstaged, plus untracked files), non-test files only,
//     with no-imitation's `findViolations` (the file as a whole, so comments are read in context; only the added lines are reported);
//   - the lines ADDED under src/ by any commit since its previous run (`git diff -U0 <HEAD it remembered> HEAD`, an amended or reset
//     HEAD included): a command that writes and commits in one go leaves the working tree clean, so the diff from HEAD alone would
//     pass it (a2a round 07). Reported once, with the commit, since the next run remembers the new HEAD. The first run in a
//     workspace has no remembered HEAD and judges the working tree only;
//   - the public catalog: when it differs from HEAD, it must pass catalog-gate's own content check (`verifyCatalogText`: every
//     listed recipe passed its gate, its hashes match, review.json signs it), whoever wrote it. a2a round 07: this used to trust
//     the command text ("npm run catalog" anywhere in it), which `npm run catalog && node x.js` or a word that only names the
//     CLI could spoof; the bytes are what is checked now.
//
// Exit 2 with the finding on a fail, on every command while the fail stands, so the agent reads it. One hooks.log line only when
// the judged state changed since the last line (a hash of the verdict under node_modules/.cache/steam-hooks/): `fail <what>
// (<file>:<line>)`, `pass (<n> files)` or `unscanned (git: …)`. Fail open on anything it cannot run, and say so in that line.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyCatalogText } from './catalog-gate.ts'
import { catalogUse } from './catalog-rule.ts'
import { isMain, logHook, ok, parseHookInput, rootOf, runAsMain, type HookResult } from './lib.ts'
import { findViolations, isTestFile, RULES } from './no-imitation.ts'
import { CATALOG_PATH } from './shell-writes.ts'

export const HOOK = 'src-scan'

export interface Deps {
  now?: () => Date
}

const MAX_BYTES = 1024 * 1024
const CATALOG_FAIL = 'the catalog differs from HEAD and does not verify'

interface Cache {
  hash: string
  /** HEAD at the end of the previous run, '' when unknown. */
  head: string
}

const cacheFile = (root: string): string => join(root, 'node_modules', '.cache', 'steam-hooks', 'src-scan.json')

function loadCache(root: string): Cache {
  try {
    const v = JSON.parse(readFileSync(cacheFile(root), 'utf8')) as Partial<Cache>
    return {
      hash: typeof v.hash === 'string' ? v.hash : '',
      head: typeof v.head === 'string' && /^[0-9a-f]{40,64}$/.test(v.head) ? v.head : '',
    }
  } catch {
    return { hash: '', head: '' }
  }
}

function saveCache(root: string, c: Cache): void {
  try {
    mkdirSync(join(root, 'node_modules', '.cache', 'steam-hooks'), { recursive: true })
    writeFileSync(cacheFile(root), JSON.stringify({ hash: c.hash, head: c.head }))
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

/** stdout of a git command that may fail for an ordinary reason (no HEAD yet, a commit that is gone): undefined then. */
function gitMaybe(root: string, args: string[]): string | undefined {
  const r = spawnSync('git', ['-C', root, '-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.error || r.status !== 0 ? undefined : r.stdout
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
  /** Short hash of the commit that added the line, when it is no longer in the working tree diff. */
  commit?: string
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

/** A file's text at a commit, under the same limits as `readable`. */
function shown(root: string, commit: string, rel: string): string | undefined {
  const text = gitMaybe(root, ['show', `${commit}:${rel}`])
  return text === undefined || text.length > MAX_BYTES || text.slice(0, 8000).includes('\0') ? undefined : text
}

const sha = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')

export function run(raw: string, deps: Deps = {}): HookResult {
  const input = parseHookInput(raw)
  if (!input) return ok()
  const root = rootOf(input)
  const cache = loadCache(root)

  const finish = (exit: number, target: string, result: string, key: string, stderr = ''): HookResult => {
    const hash = sha(key)
    let failure: string | undefined
    if (hash !== cache.hash) failure = logHook(root, HOOK, target, result, deps.now)
    saveCache(root, { hash, head: cache.head })
    return { exit, stdout: '', stderr: [stderr, failure].filter(Boolean).join('\n') }
  }

  let judged = 0
  const skipped: string[] = [] // binary or over 1 MB: named in the line, never a silent pass (a2a r07)
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
      if (text === undefined) {
        skipped.push(file)
        continue
      }
      judged++
      for (const f of findViolations(text)) if (lines === 'all' || lines.has(f.line)) findings.push({ file, line: f.line, what: f.what, kind: f.kind })
    }
    const head = gitMaybe(root, ['rev-parse', '--verify', '-q', 'HEAD^{commit}'])?.trim() ?? ''
    if (cache.head && head && cache.head !== head && gitMaybe(root, ['cat-file', '-e', `${cache.head}^{commit}`]) !== undefined) {
      const committed = addedLines(git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', cache.head, head, '--', 'src']))
      const short = head.slice(0, 7)
      for (const [file, lines] of [...committed].sort(([a], [b]) => a.localeCompare(b))) {
        if (!lines.size || !file.startsWith('src/') || isTestFile(file)) continue
        const text = shown(root, head, file)
        if (text === undefined) continue
        judged++
        for (const f of findViolations(text)) if (lines.has(f.line)) findings.push({ file, line: f.line, what: f.what, kind: f.kind, commit: short })
      }
    }
    cache.head = head
    catalogChanged = git(root, ['status', '--porcelain', '--untracked-files=all', '--', CATALOG_PATH]).trim() !== ''
  } catch (e) {
    const why = (e as Error).message.replace(/\s+/g, ' ').slice(0, 160)
    return finish(0, 'src/', `unscanned (git: ${why})`, `unscanned:${why}`)
  }

  let catalogWhy = ''
  if (catalogChanged) {
    const file = join(root, CATALOG_PATH)
    const v = existsSync(file) ? verifyCatalogText(root, readFileSync(file, 'utf8')) : { ok: false as const, reasons: ['the file was deleted'] }
    if (!v.ok) {
      catalogWhy = v.reasons.join('; ')
      findings.push({ file: CATALOG_PATH, line: 0, what: CATALOG_FAIL, kind: 'catalog' })
    }
  }

  const notJudged = skipped.length ? `; not judged, binary or over 1 MB: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ` (+${skipped.length - 3})` : ''}` : ''
  if (!findings.length) return finish(0, 'src/', `pass (${judged} files${notJudged})`, `pass:${judged}${notJudged}`)

  const at = (f: Finding): string => (f.commit ? `, committed in ${f.commit}` : '')
  const label = (f: Finding): string => (f.kind === 'catalog' ? `${f.what} (${f.file})` : `${f.what} (${f.file}:${f.line}${at(f)})`)
  const stderr = [
    ...findings.map((f) => {
      if (f.kind === 'catalog') return `${HOOK}: ${f.file} differs from HEAD and does not verify: ${catalogWhy}. ${catalogUse(CATALOG_PATH)} Undo the change with git checkout -- ${f.file} if it is not wanted.`
      const r = RULES[f.kind]
      return `${HOOK}: ${f.file}:${f.line}: ${f.what}${at(f)}. Rule (.kiro/steering/product.md, "${r.section}"): "${r.text}"`
    }),
    ...(findings.some((f) => f.commit) ? [`${HOOK}: the command committed this, so the working tree no longer shows it and this message does not repeat. Remove the line in a new commit.`] : []),
    ...(findings.some((f) => f.kind !== 'catalog' && !f.commit) ? [`${HOOK}: a command wrote this where shell-gate could not see it in the command text. Remove the added line (git diff -- src) and carry on; this message repeats after every shell command until it is gone.`] : []),
  ].join('\n')
  return finish(2, findings[0]!.file, `fail ${findings.map(label).join(', ')}`, `fail:${findings.map((f) => `${f.file}:${f.line}:${f.what}${at(f)}`).join('|')}:${judged}`, stderr)
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
