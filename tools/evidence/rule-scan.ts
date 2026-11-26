// Retroactive no-imitation scan of src/ (an outside judge-lens review, a2a round 09, asked what the shell writes that no hook
// saw had actually written). The hooks judge a write as it happens; this judges what is already in the repository, with the
// same rules (`findViolations` from tools/hooks/no-imitation.ts, comments read in context, test files skipped as the hook does):
//   1. every non-test file under src/ at HEAD, whole file;
//   2. every line ever added under src/ in history: for each commit that touched src/, the added lines of each non-test file
//      (`git show -U0`), judged inside that file's text at that commit (the same added-lines method as tools/hooks/src-scan.ts).
// Usage: npx tsx tools/evidence/rule-scan.ts [--out <file>]    exit 0 = no finding, 1 = findings listed, 2 = git failed.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { findViolations, isTestFile } from '../hooks/no-imitation.ts'
import { addedLines } from '../hooks/src-scan.ts'

const TEXT = /\.(?:[cm]?[jt]sx?|css|html?|json|md|glsl|frag|vert)$/

function git(args: string[]): string | undefined {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return r.error || r.status !== 0 ? undefined : r.stdout
}

export interface ScanRow {
  where: string
  line: number
  kind: string
  what: string
}

/** Whole-file findings for each listed file; `read` returns the file's text or undefined (binary, missing). */
export function scanFiles(files: readonly string[], read: (f: string) => string | undefined): ScanRow[] {
  const rows: ScanRow[] = []
  for (const f of files) {
    if (!f.startsWith('src/') || isTestFile(f) || !TEXT.test(f)) continue
    const text = read(f)
    if (text === undefined || text.slice(0, 8000).includes('\0')) continue
    for (const v of findViolations(text)) rows.push({ where: f, line: v.line, kind: v.kind, what: v.what })
  }
  return rows
}

/** Findings on the lines a diff adds, each judged inside the file's text at that commit. */
export function scanAdded(diff: string, read: (f: string) => string | undefined, tag: string): ScanRow[] {
  const rows: ScanRow[] = []
  for (const [f, lines] of addedLines(diff)) {
    if (!f.startsWith('src/') || isTestFile(f) || !TEXT.test(f) || lines.size === 0) continue
    const text = read(f)
    if (text === undefined || text.slice(0, 8000).includes('\0')) continue
    for (const v of findViolations(text)) if (lines.has(v.line)) rows.push({ where: `${tag} ${f}`, line: v.line, kind: v.kind, what: v.what })
  }
  return rows
}

function main(): number {
  const outIx = process.argv.indexOf('--out')
  const out = outIx > 0 ? process.argv[outIx + 1] : undefined
  const head = git(['rev-parse', '--short', 'HEAD'])?.trim()
  const listed = git(['ls-files', 'src'])
  const revs = git(['rev-list', '--reverse', 'HEAD', '--', 'src'])
  if (!head || listed === undefined || revs === undefined) return 2
  const files = listed.split('\n').filter(Boolean)
  const judged = files.filter((f) => !isTestFile(f) && TEXT.test(f))
  const atHead = scanFiles(files, (f) => git(['show', `HEAD:${f}`]))
  const commits = revs.split('\n').filter(Boolean)
  let addedTotal = 0
  const inHistory: ScanRow[] = []
  for (const c of commits) {
    const diff = git(['show', '--format=', '--unified=0', '--no-color', '--no-renames', c, '--', 'src'])
    if (diff === undefined) return 2
    for (const [f, ls] of addedLines(diff)) if (f.startsWith('src/') && !isTestFile(f) && TEXT.test(f)) addedTotal += ls.size
    inHistory.push(...scanAdded(diff, (f) => git(['show', `${c}:${f}`]), c.slice(0, 7)))
  }
  // Positive control: the test files the scan skips quote the forbidden words on purpose, so the same rules must fire on them.
  const tests = git(['ls-files', 'src', 'tools/hooks'])?.split('\n').filter((f) => f && isTestFile(f) && TEXT.test(f)) ?? []
  let control = 0
  for (const f of tests) {
    const t = git(['show', `HEAD:${f}`])
    if (t !== undefined) control += findViolations(t).length
  }
  const lines = [
    `# tools/evidence/rule-scan.ts at ${head}, ${new Date().toISOString().slice(0, 10)} (UTC) — no-imitation rules (speech synthesis, handwriting-style font, handwriting package) over src/, test files skipped`,
    `1. HEAD tree: ${judged.length} non-test text files under src/, whole file: ${atHead.length} finding(s)`,
    ...atHead.map((r) => `   ${r.where}:${r.line} ${r.kind} ${r.what}`),
    `2. History: ${commits.length} commits touched src/; ${addedTotal} added lines in non-test text files, each judged in its file at that commit: ${inHistory.length} finding(s)`,
    ...inHistory.map((r) => `   ${r.where}:${r.line} ${r.kind} ${r.what}`),
    `control: the same rules over the ${tests.length} skipped test files under src/ and tools/hooks/ (they quote the forbidden words on purpose): ${control} finding(s) — the rules fire on real repo text`,
    atHead.length + inHistory.length === 0 ? 'RESULT: no finding' : 'RESULT: findings listed above',
  ]
  const text = lines.join('\n') + '\n'
  if (out) writeFileSync(out, text)
  process.stdout.write(text)
  return atHead.length + inHistory.length === 0 ? 0 : 1
}

if (process.argv[1] && /rule-scan\.ts$/.test(process.argv[1])) process.exit(main())
