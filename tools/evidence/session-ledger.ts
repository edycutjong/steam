// The session ledger: which tool wrote what, per Kiro session of this workspace (hook-coverage H1).
//
//   node tools/evidence/session-ledger.ts [<sessions folder>] [--workspace <path>] [--out <folder>] [--repo <path>]
//
// Reads every `sess_*/session.json` and `messages.jsonl` of the sessions folder (default: `~/.kiro/sessions/<first 16 hex of
// the SHA-256 of the workspace path>`), asks `git log` for the `[kiro]` commits, and writes `ledger.json` and `ledger.md`
// (default folder: docs/kiro-evidence/sessions). It copies NO prompt text, assistant text, tool output or command text:
// titles, ids, times, model names, counts, repository-relative paths and commit hashes and subjects only. The session store
// holds private material; the ledger is public evidence.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { analyzeShell } from '../hooks/shell-writes.ts'

export interface Commit {
  hash: string
  subject: string
  /** Author time, ISO 8601. */
  at: string
}

export interface SessionRow {
  id: string
  title: string
  createdAt: string
  lastModifiedAt: string
  modelId: string
  agentMode: string
  toolCalls: Record<string, number>
  shellWritesUnderSrc: number
  shellWritesUnderSrcNonTest: number
  shellWritesToCatalog: number
  /** Shell writes under src/ during which a ContextualHookInvoked event of the same turn was logged. */
  shellWritesSeenByAHook: number
  writeToolCallsUnderSrc: number
  writeToolPathsUnderSrc: string[]
  /** Per tool name: the calls during which at least one hook event of the same turn was logged. */
  callsWithHookEvent: Record<string, number>
  hookInvocations: Record<string, number>
  commits: Commit[]
}

export interface Totals {
  sessions: number
  toolCalls: Record<string, number>
  shellWritesUnderSrc: number
  shellWritesUnderSrcNonTest: number
  shellWritesSeenByAHook: number
  writeToolCallsUnderSrc: number
  callsWithHookEvent: Record<string, number>
  hookInvocations: Record<string, number>
}

export interface Ledger {
  workspace: string
  rule: string[]
  totals: Totals
  sessions: SessionRow[]
}

export interface RawSession {
  session: Record<string, unknown>
  messages: Record<string, unknown>[]
}

export const RULE: string[] = [
  'A shell write under src/ is an `execute_bash` command with a simple command that redirects (>, >>, tee) into src/, runs sed -i / perl -i on a path in src/, copies or moves into src/, restores a path of src/ with git, applies a diff by heredoc that names one, or runs an interpreter (python, node, ruby, perl, php, deno, bun, tsx) on an inline script or heredoc that calls a file-writing API and names a path under src/. The rule is `analyzeShell` in tools/hooks/shell-writes.ts, the same one the shell-gate hook uses.',
  'Written paths are relative to the workspace root after cd, ./, .. and a leading $VAR/ are resolved. A test file (*.test.ts, *.spec.ts, src/__tests__/) is counted in "under src" and not in "non-test".',
  'Not seen by the rule: a script file run by name, a path built from parts that is not named `src`, find -exec and xargs. The count is a lower bound.',
  'A call "had a hook event" when a ContextualHookInvoked event with the same executionId is logged between the call and its result and the hook can run for that tool (its matcher: no-imitation and catalog-gate run for fs_write and str_replace, shell-gate and src-scan-after-shell for execute_bash, props-on-save for no tool). Events are counted by hook name (the name field, else the file name of hookId).',
  'The window of a session is createdAt to the later of lastModifiedAt and its last message. A `[kiro]` commit belongs to it when its author time lies in the window, ends included. Parallel sessions can share commits.',
  'Nothing of a prompt, an assistant message, a tool result or a command is copied.',
]

const ms = (iso: unknown): number => (typeof iso === 'string' ? Date.parse(iso) : NaN)

/**
 * The tools a hook of this repository can run for, from its matcher (.kiro/hooks/*.json). Two tool calls issued together
 * overlap in time, so timing alone attributes a `no-imitation` run to a parallel shell call. A hook that is not listed
 * here is attributed by timing alone. File-event hooks (props-on-save) run on a saved file, whatever tool saved it.
 */
export const HOOK_TOOLS: Record<string, string[]> = {
  'no-imitation': ['fs_write', 'str_replace'],
  'catalog-gate': ['fs_write', 'str_replace'],
  'props-on-save-save': [],
  'props-on-save-create': [],
  'tests-after-task': [],
  'shell-gate': ['execute_bash'],
  'src-scan-after-shell': ['execute_bash'],
  'zz-record-shell': ['execute_bash'],
}
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const bump = (m: Record<string, number>, k: string, n = 1): void => {
  m[k] = (m[k] ?? 0) + n
}
const sortedKeys = (m: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)))

interface Call {
  name: string
  args: Record<string, unknown>
  start: number
  end: number
  exec: string
}

function rowOf(raw: RawSession, commits: Commit[], workspace: string): SessionRow {
  const s = raw.session
  const calls = new Map<string, Call>()
  const hooks: { name: string; at: number; exec: string }[] = []
  let last = ms(s.lastModifiedAt)
  for (const m of raw.messages) {
    const at = ms(m.timestamp)
    if (Number.isFinite(at) && !(at <= last)) last = at
    const p = m.payload as Record<string, unknown> | undefined
    if (!p) continue
    if (p.type === 'tool_call' && typeof p.toolCallId === 'string') {
      const args = typeof p.args === 'object' && p.args !== null ? (p.args as Record<string, unknown>) : {}
      calls.set(p.toolCallId, { name: str(p.toolName, 'unknown'), args, start: at, end: at, exec: str(p.executionId) })
    } else if (p.type === 'tool_result' && typeof p.toolCallId === 'string') {
      const c = calls.get(p.toolCallId)
      if (c && Number.isFinite(at)) c.end = at
    } else if (p.type === 'ContextualHookInvoked') {
      const fromId = /([^/\\]+)\.json#/.exec(str(p.hookId))?.[1]
      hooks.push({ name: str(p.name) || fromId || 'unknown', at, exec: str(p.executionId) })
    }
  }

  const row: SessionRow = {
    id: str(s.id),
    title: str(s.title),
    createdAt: str(s.createdAt),
    lastModifiedAt: str(s.lastModifiedAt),
    modelId: str(s.modelId),
    agentMode: str(s.agentMode),
    toolCalls: {},
    shellWritesUnderSrc: 0,
    shellWritesUnderSrcNonTest: 0,
    shellWritesToCatalog: 0,
    shellWritesSeenByAHook: 0,
    writeToolCallsUnderSrc: 0,
    writeToolPathsUnderSrc: [],
    callsWithHookEvent: {},
    hookInvocations: {},
    commits: [],
  }
  const paths = new Set<string>()
  for (const h of hooks) bump(row.hookInvocations, h.name)
  for (const c of calls.values()) {
    bump(row.toolCalls, c.name)
    const seen = hooks.some((h) => h.exec === c.exec && h.at >= c.start && h.at <= c.end && (HOOK_TOOLS[h.name]?.includes(c.name) ?? !(h.name in HOOK_TOOLS)))
    if (seen) bump(row.callsWithHookEvent, c.name)
    if (c.name === 'execute_bash' && typeof c.args.command === 'string') {
      const a = analyzeShell(c.args.command, { root: workspace, cwd: typeof c.args.cwd === 'string' ? c.args.cwd : undefined })
      const src = a.targets.filter((t) => t.kind === 'src')
      if (src.length) {
        row.shellWritesUnderSrc++
        if (src.some((t) => !t.test)) row.shellWritesUnderSrcNonTest++
        if (seen) row.shellWritesSeenByAHook++
      }
      if (a.targets.some((t) => t.kind === 'catalog')) row.shellWritesToCatalog++
    } else if ((c.name === 'fs_write' || c.name === 'str_replace') && typeof c.args.path === 'string') {
      const abs = c.args.path.startsWith('/') ? posix.normalize(c.args.path) : posix.resolve(workspace, c.args.path)
      const rel = posix.relative(workspace, abs)
      if (rel === 'src' || rel.startsWith('src/')) {
        row.writeToolCallsUnderSrc++
        paths.add(rel)
      }
    }
  }
  row.writeToolPathsUnderSrc = [...paths].sort()
  row.toolCalls = sortedKeys(row.toolCalls)
  row.callsWithHookEvent = sortedKeys(row.callsWithHookEvent)
  row.hookInvocations = sortedKeys(row.hookInvocations)
  const from = ms(s.createdAt)
  row.commits = commits.filter((c) => c.subject.startsWith('[kiro]') && ms(c.at) >= from && ms(c.at) <= last).sort((a, b) => ms(a.at) - ms(b.at))
  return row
}

export function buildLedger(sessions: RawSession[], commits: Commit[], workspace: string): Ledger {
  const root = posix.normalize(workspace).replace(/\/+$/, '') || '/'
  const rows = sessions.map((r) => rowOf(r, commits, root)).sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id.localeCompare(b.id))
  const totals: Totals = {
    sessions: rows.length,
    toolCalls: {},
    shellWritesUnderSrc: 0,
    shellWritesUnderSrcNonTest: 0,
    shellWritesSeenByAHook: 0,
    writeToolCallsUnderSrc: 0,
    callsWithHookEvent: {},
    hookInvocations: {},
  }
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.toolCalls)) bump(totals.toolCalls, k, v)
    for (const [k, v] of Object.entries(r.callsWithHookEvent)) bump(totals.callsWithHookEvent, k, v)
    for (const [k, v] of Object.entries(r.hookInvocations)) bump(totals.hookInvocations, k, v)
    totals.shellWritesUnderSrc += r.shellWritesUnderSrc
    totals.shellWritesUnderSrcNonTest += r.shellWritesUnderSrcNonTest
    totals.shellWritesSeenByAHook += r.shellWritesSeenByAHook
    totals.writeToolCallsUnderSrc += r.writeToolCallsUnderSrc
  }
  totals.toolCalls = sortedKeys(totals.toolCalls)
  totals.callsWithHookEvent = sortedKeys(totals.callsWithHookEvent)
  totals.hookInvocations = sortedKeys(totals.hookInvocations)
  return { workspace: root, rule: RULE, totals, sessions: rows }
}

/** Every `sess_*` folder with a readable session.json; a line of messages.jsonl that is not JSON is skipped. */
export function readSessions(dir: string): RawSession[] {
  const out: RawSession[] = []
  for (const name of readdirSync(dir).sort()) {
    if (!name.startsWith('sess_')) continue
    const d = join(dir, name)
    if (!statSync(d).isDirectory() || !existsSync(join(d, 'session.json'))) continue
    let session: Record<string, unknown>
    try {
      session = JSON.parse(readFileSync(join(d, 'session.json'), 'utf8')) as Record<string, unknown>
    } catch {
      continue
    }
    const messages: Record<string, unknown>[] = []
    const file = join(d, 'messages.jsonl')
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const v: unknown = JSON.parse(line)
          if (typeof v === 'object' && v !== null) messages.push(v as Record<string, unknown>)
        } catch {
          // a torn last line of a live session
        }
      }
    }
    out.push({ session, messages })
  }
  return out
}

/** `[kiro]` commits of the repository with their author times. */
export function gitCommits(repo: string): Commit[] {
  const r = spawnSync('git', ['-C', repo, 'log', '--format=%H%x09%aI%x09%s', '--no-merges'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git log failed: ${r.stderr.trim()}`)
  const out: Commit[] = []
  for (const line of r.stdout.split('\n')) {
    const [hash, at, ...rest] = line.split('\t')
    const subject = rest.join('\t')
    if (hash && at && subject.startsWith('[kiro]')) out.push({ hash: hash.slice(0, 7), at: new Date(at).toISOString(), subject })
  }
  return out
}

const rowTable = (rows: string[][]): string => rows.map((r) => `| ${r.join(' | ')} |`).join('\n')
const kv = (m: Record<string, number>): string =>
  Object.keys(m).length
    ? Object.entries(m)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')
    : '–'

export function renderMarkdown(l: Ledger): string {
  const t = l.totals
  const head = [
    '# Session ledger',
    '',
    `Which tool wrote what in the ${t.sessions} Kiro sessions of this workspace. Written by \`tools/evidence/session-ledger.ts\` from the session store. Titles, ids, counts, paths and commit hashes only: no prompt, assistant text, tool output or command text is copied.`,
    '',
    '## Rule',
    '',
    ...l.rule.map((r) => `- ${r}`),
    '',
    '## Totals',
    '',
    `- Tool calls: ${kv(t.toolCalls)}.`,
    `- Write-tool calls (\`fs_write\`, \`str_replace\`) under src/: ${t.writeToolCallsUnderSrc}.`,
    `- Shell writes under src/: ${t.shellWritesUnderSrc} (${t.shellWritesUnderSrcNonTest} on a non-test file), of which ${t.shellWritesSeenByAHook} had a hook event during the call.`,
    `- Calls with a hook event, by tool: ${kv(t.callsWithHookEvent)}.`,
    `- Hook invocations by hook: ${kv(t.hookInvocations)}.`,
    '',
    '## Sessions',
    '',
    rowTable([
      ['Session', 'Title', 'Created (UTC)', 'Model', 'Write-tool calls under src/', 'Shell writes under src/ (non-test)', 'Shell writes seen by a hook', 'Shell writes to the catalog', 'Hook invocations', '[kiro] commits'],
      ['---', '---', '---', '---', '---:', '---:', '---:', '---:', '---', '---:'],
      ...l.sessions.map((r) => [
        `\`${r.id.replace(/^sess_/, '').slice(0, 8)}\``,
        r.title.replace(/\|/g, '/'),
        r.createdAt.replace('T', ' ').slice(0, 16),
        r.modelId,
        String(r.writeToolCallsUnderSrc),
        `${r.shellWritesUnderSrc} (${r.shellWritesUnderSrcNonTest})`,
        String(r.shellWritesSeenByAHook),
        String(r.shellWritesToCatalog),
        kv(r.hookInvocations),
        String(r.commits.length),
      ]),
    ]),
    '',
    '## Per session',
    '',
  ]
  const per = l.sessions.flatMap((r) => [
    `### ${r.title || r.id}`,
    '',
    `- Id \`${r.id}\`, ${r.createdAt} to ${r.lastModifiedAt}, model \`${r.modelId}\`, mode \`${r.agentMode}\`.`,
    `- Tool calls: ${kv(r.toolCalls)}. Calls with a hook event: ${kv(r.callsWithHookEvent)}.`,
    `- Paths written under src/ by a write tool (${r.writeToolCallsUnderSrc} calls): ${r.writeToolPathsUnderSrc.length ? r.writeToolPathsUnderSrc.map((p) => `\`${p}\``).join(', ') : '–'}.`,
    `- [kiro] commits in the window: ${r.commits.length ? r.commits.map((c) => `\`${c.hash}\``).join(' ') : '–'}.`,
    '',
  ])
  return `${[...head, ...per].join('\n').trimEnd()}\n`
}

export function writeLedger(outDir: string, ledger: Ledger): void {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`)
  writeFileSync(join(outDir, 'ledger.md'), renderMarkdown(ledger))
}

export const sessionsFolderOf = (workspace: string, home = homedir()): string => join(home, '.kiro', 'sessions', createHash('sha256').update(resolve(workspace)).digest('hex').slice(0, 16))

function main(argv: string[]): void {
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const flagValues = new Set(['--workspace', '--out', '--repo'].flatMap((f) => (argv.includes(f) ? [argv[argv.indexOf(f) + 1]] : [])))
  const workspace = resolve(flag('--workspace') ?? process.cwd())
  const positional = argv.find((a) => !a.startsWith('--') && !flagValues.has(a))
  const dir = positional ? resolve(positional) : sessionsFolderOf(workspace)
  if (!existsSync(dir)) throw new Error(`no sessions folder at ${dir}`)
  const repo = resolve(flag('--repo') ?? workspace)
  const out = resolve(flag('--out') ?? join(repo, 'docs', 'kiro-evidence', 'sessions'))
  const ledger = buildLedger(readSessions(dir), gitCommits(repo), workspace)
  writeLedger(out, ledger)
  const t = ledger.totals
  process.stdout.write(`session-ledger: ${t.sessions} sessions → ${out}\n  write-tool calls under src/: ${t.writeToolCallsUnderSrc}; shell writes under src/: ${t.shellWritesUnderSrc} (${t.shellWritesUnderSrcNonTest} non-test), seen by a hook: ${t.shellWritesSeenByAHook}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`session-ledger: ${(e as Error).message}\n`)
    process.exit(1)
  }
}
