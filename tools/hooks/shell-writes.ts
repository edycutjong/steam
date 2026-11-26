// What a shell command writes, as far as its text shows it. One rule, used by the session ledger (tools/evidence) and by the
// shell hooks (shell-gate, src-scan). The command is read with a small shell lexer (quotes, escapes, heredocs, $( ) and
// backticks, redirects, ; && || | & and newlines), not with a regex over the whole string.
//
// THE RULE. A command "writes under src/" when one of its simple commands (including those inside $( ), `…` and `bash -c '…'`):
//   1. redirects its output (>, >>, >|, &>, &>>, <>, >& file) to a path under src/;
//   2. is `tee [-a]`, `touch`, `truncate`, `patch`, or `dd of=` on such a path;
//   3. is `sed -i` / `perl -i` / `ruby -i` on such a path (the first word of a sed with no -e is its script, not a path);
//   4. is `cp`, `mv`, `install`, `rsync`, `ditto`, `ln` or `git mv` whose destination is such a path (the last word, or -t);
//   5. is `git checkout [rev] -- <path>`, `git restore <path>`, or `git apply`/`patch` fed a diff by heredoc whose `+++` header names one;
//   6. is an interpreter (python, node, deno, bun, tsx, ruby, perl, php) running an inline script (-c, -e, -p, -r, or a heredoc)
//      that calls a file-writing API (open(…,'w'|'a'|'x'), .write(, write_text, writeFileSync, appendFile, copyFile, cpSync,
//      renameSync, File.write, …; stdout.write and stderr.write do not count) and has a string literal that is a path under src/.
//      A script that writes and only names the folder (`'src'`, built from parts) is a write to `src/(script)`.
// "Under src/" is the path relative to the root, after `cd`, `./`, `..`, doubled slashes and a leading $VAR/ are resolved. A `cd`
// inside ( … ) or `bash -c` does not leak out, and `npx`/`bunx` and `eval` are read through (a2a round 07; these change no
// classification of the 1,826 shell calls in the session store the ledger read). With `expandVars` (shell-gate sets it), a
// variable set earlier in the same command (`f=src/x.ts; … > "$f"`) is substituted too. The ledger does not set it, so its
// published counts keep the rule they were taken with; expanding variables reclassifies one of those calls (a write to
// src/steam/derive.ts through `$f`), which would make 544 / 546 of the published 543 / 545.
// The same rule marks a write to the public catalog (kind "catalog"). A write to a test file (*.test.ts, *.spec.ts,
// src/__tests__/) is a target with test = true: it is counted, and not judged.
// WHAT IT CANNOT SEE: a script file that is run by name (node scripts/x.ts), a path built from parts that is not named
// `src`, find -exec / xargs, and a file written by a program another command started. src-scan (PostToolUse) is the backstop.
// What it sees and cannot resolve is listed in `unresolved` (a write to $VAR or ~ it cannot expand, a diff applied from a file),
// so shell-gate logs it instead of allowing it silently. `unresolved` never changes `targets`: the counts stay the same.

import { posix } from 'node:path'
import { isTestFile } from './no-imitation.ts'

export interface ShellTarget {
  /** Relative to the root with forward slashes, or `src/(script)` for a script whose path is built from parts. */
  path: string
  kind: 'src' | 'catalog'
  /** A test file (`*.test.ts`, `src/__tests__/`): not judged, as in no-imitation. */
  test: boolean
  via: string
}

export interface ShellAnalysis {
  /** False when the command could not be read (an open quote, a heredoc with no end). */
  parsed: boolean
  targets: ShellTarget[]
  /** The text the command introduces into the judged (non-test) targets. */
  text: string
  /** True when some judged target's content does not appear in the command text (cp, a redirect from another command). */
  blind: boolean
  /** Write positions the rule saw but could not resolve to a path: `redirect $f`, `git apply <file>`, `patch <file>`. */
  unresolved: string[]
}

export interface ShellOptions {
  root: string
  /** The `cwd` of the tool call, when it names one. */
  cwd?: string
  /** Substitute variables assigned earlier in the same command (the gate); off for the ledger's published counts. */
  expandVars?: boolean
}

/** Spelled in two parts: the R35.5 test lists every non-test source file that names the catalog file. */
export const CATALOG_FILE = 'catalog' + '.json'
export const CATALOG_PATH = `content/${CATALOG_FILE}`

// ---- the lexer -------------------------------------------------------------------------------------------------------

interface Redir {
  op: string
  target: string
}

interface Cmd {
  words: string[]
  redirs: Redir[]
  heredocs: string[]
  herestrings: string[]
  /** Commands joined by | share a pipeline number. */
  pipe: number
}

interface Pending {
  tag: string
  strip: boolean
  cmd: Cmd
}

const fresh = (pipe: number): Cmd => ({ words: [], redirs: [], heredocs: [], herestrings: [], pipe })
const SUB_OPEN = '\u0000('
const SUB_CLOSE = '\u0000)'
const isMarker = (c: Cmd): boolean => c.words.length === 1 && (c.words[0] === SUB_OPEN || c.words[0] === SUB_CLOSE)
const REDIRECT = /(\d*)(&>>|&>|>>|>\||>&|>|<<<|<<-|<<|<&|<>|<)/y
const WORD_END = new Set([' ', '\t', '\n', ';', '&', '|', '(', ')', '<', '>'])

class Lexer {
  s: string
  i = 0
  ok = true
  cmds: Cmd[] = []
  ctx: { pipe: number }
  private cur: Cmd
  private pending: Pending[] = []

  constructor(s: string, ctx: { pipe: number } = { pipe: 0 }) {
    this.s = s
    this.ctx = ctx
    this.cur = fresh(ctx.pipe)
  }

  /** A marker command for the start or end of a ( … ) subshell, so that a `cd` inside it does not leak out. */
  private mark(word: string): void {
    this.cmds.push({ ...fresh(this.ctx.pipe), words: [word] })
    this.ctx.pipe++
    this.cur = fresh(this.ctx.pipe)
  }

  private endCmd(seq: boolean): void {
    const c = this.cur
    if (c.words.length || c.redirs.length || c.heredocs.length || c.herestrings.length || this.pending.some((p) => p.cmd === c)) this.cmds.push(c)
    if (seq) this.ctx.pipe++
    this.cur = fresh(this.ctx.pipe)
  }

  /** Reads the bodies of the heredocs declared on the line that just ended. */
  private readHeredocs(): void {
    const s = this.s
    for (const p of this.pending) {
      const body: string[] = []
      let found = false
      while (this.i < s.length) {
        let eol = s.indexOf('\n', this.i)
        if (eol < 0) eol = s.length
        const line = s.slice(this.i, eol)
        this.i = Math.min(eol + 1, s.length)
        if ((p.strip ? line.replace(/^\t+/, '') : line) === p.tag) {
          found = true
          break
        }
        body.push(line)
      }
      if (!found) this.ok = false
      p.cmd.heredocs.push(body.join('\n'))
    }
    this.pending = []
  }

  /** A nested lexer for $( ) and backticks: its commands are analysed like the outer ones. */
  private sub(text?: string): void {
    if (text !== undefined) {
      const L = new Lexer(text, this.ctx)
      L.run(false)
      this.ok = this.ok && L.ok
      this.cmds.push(...L.cmds)
      return
    }
    const L = new Lexer(this.s, this.ctx)
    L.i = this.i
    L.run(true)
    this.i = L.i
    this.ok = this.ok && L.ok
    this.cmds.push(...L.cmds)
  }

  private word(): string {
    const s = this.s
    let v = ''
    while (this.i < s.length) {
      const c = s[this.i]!
      if (WORD_END.has(c)) {
        // `<(` and `>(` are process substitutions, handled by the caller; a `(` after `$` never gets here
        break
      }
      if (c === '\\') {
        if (s[this.i + 1] === '\n') this.i += 2
        else {
          v += s[this.i + 1] ?? ''
          this.i += 2
        }
        continue
      }
      if (c === "'") {
        const e = s.indexOf("'", this.i + 1)
        if (e < 0) {
          this.ok = false
          this.i = s.length
          break
        }
        v += s.slice(this.i + 1, e)
        this.i = e + 1
        continue
      }
      if (c === '"') {
        this.i++
        let closed = false
        while (this.i < s.length) {
          const d = s[this.i]!
          if (d === '"') {
            closed = true
            this.i++
            break
          }
          if (d === '\\' && '$`"\\\n'.includes(s[this.i + 1] ?? 'x')) {
            if (s[this.i + 1] !== '\n') v += s[this.i + 1]
            this.i += 2
            continue
          }
          if (d === '$' && s[this.i + 1] === '(') {
            this.i += 2
            this.sub()
            v += '\u0000'
            continue
          }
          if (d === '`') {
            const e = this.backtickEnd(this.i)
            this.sub(s.slice(this.i + 1, e))
            this.i = Math.min(e + 1, s.length)
            v += '\u0000'
            continue
          }
          v += d
          this.i++
        }
        if (!closed) this.ok = false
        continue
      }
      if (c === '$' && s[this.i + 1] === "'") {
        this.i += 2
        while (this.i < s.length && s[this.i] !== "'") {
          if (s[this.i] === '\\') this.i++
          v += s[this.i] ?? ''
          this.i++
        }
        if (this.i >= s.length) this.ok = false
        this.i++
        continue
      }
      if (c === '$' && s[this.i + 1] === '(') {
        this.i += 2
        this.sub()
        v += '\u0000'
        continue
      }
      if (c === '$' && s[this.i + 1] === '{') {
        const e = s.indexOf('}', this.i)
        const end = e < 0 ? s.length : e + 1
        v += s.slice(this.i, end)
        this.i = end
        continue
      }
      if (c === '`') {
        const e = this.backtickEnd(this.i)
        this.sub(s.slice(this.i + 1, e))
        this.i = Math.min(e + 1, s.length)
        v += '\u0000'
        continue
      }
      v += c
      this.i++
    }
    return v
  }

  private backtickEnd(from: number): number {
    const s = this.s
    for (let k = from + 1; k < s.length; k++) {
      if (s[k] === '\\') k++
      else if (s[k] === '`') return k
    }
    this.ok = false
    return s.length
  }

  run(closer: boolean): void {
    const s = this.s
    while (this.i < s.length) {
      const c = s[this.i]!
      if (c === ' ' || c === '\t') {
        this.i++
        continue
      }
      if (c === '\\' && s[this.i + 1] === '\n') {
        this.i += 2
        continue
      }
      if (c === '#') {
        const e = s.indexOf('\n', this.i)
        this.i = e < 0 ? s.length : e
        continue
      }
      if (c === '\n') {
        this.i++
        this.endCmd(true)
        this.readHeredocs()
        continue
      }
      if (c === ';') {
        this.i += s[this.i + 1] === ';' ? 2 : 1
        this.endCmd(true)
        continue
      }
      REDIRECT.lastIndex = this.i
      const r = REDIRECT.exec(s)
      if (r) {
        this.i = REDIRECT.lastIndex
        const op = r[2]!
        if ((op === '<' || op === '>') && s[this.i] === '(') {
          this.i++
          this.sub()
          continue
        }
        while (s[this.i] === ' ' || s[this.i] === '\t') this.i++
        const target = this.word()
        if (op === '<<' || op === '<<-') this.pending.push({ tag: target, strip: op === '<<-', cmd: this.cur })
        else if (op === '<<<') this.cur.herestrings.push(target)
        else if (!((op === '>&' || op === '<&') && /^(?:\d+|-)$/.test(target))) this.cur.redirs.push({ op, target })
        continue
      }
      if (c === '&') {
        this.i += s[this.i + 1] === '&' ? 2 : 1
        this.endCmd(true)
        continue
      }
      if (c === '|') {
        this.i++
        if (s[this.i] === '|') {
          this.i++
          this.endCmd(true)
        } else {
          if (s[this.i] === '&') this.i++
          this.endCmd(false)
        }
        continue
      }
      if (c === '(') {
        this.i++
        this.endCmd(true)
        this.mark(SUB_OPEN)
        continue
      }
      if (c === ')') {
        this.i++
        this.endCmd(true)
        if (closer) return
        this.mark(SUB_CLOSE)
        continue
      }
      const before = this.i
      const w = this.word()
      if (this.i === before) this.i++ // a character the lexer has no rule for: never loop
      else this.cur.words.push(w)
    }
    if (this.pending.length) this.ok = false
    this.endCmd(false)
  }
}

// ---- the rule --------------------------------------------------------------------------------------------------------

const LAUNCHERS = new Set(['npx', 'bunx'])
/** Drops leading assignments, wrappers (env, sudo, time…) and package launchers with their options (`npx -y -p pkg tsx` → `tsx`). */
function unwrap(words: string[]): void {
  while (words.length) {
    const w = words[0]!
    if (/^[A-Za-z_]\w*=/.test(w) || WRAPPERS.has(w)) words.shift()
    else if (LAUNCHERS.has(posix.basename(w))) {
      words.shift()
      while (words.length && words[0]!.startsWith('-')) {
        const o = words.shift()!
        if ((o === '-p' || o === '--package') && words.length) words.shift()
      }
    } else break
  }
}
const WRAPPERS = new Set(['env', 'sudo', 'time', 'nohup', 'command', 'exec', 'builtin', '!', '{', '}', 'then', 'do', 'else', 'if', 'while', 'until', 'elif', 'nice'])
const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>', '>&'])
const INTERPRETER = /^(?:python[\d.]*|node(?:js)?|deno|bun|tsx|ruby|perl|php)$/
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash'])
const INLINE_FLAG = /^(?:-[A-Za-z]*[ceEpr]|--eval|--print)$/
/** An API that writes a file. `stdout.write` and `stderr.write` are removed before this is tested. */
const WRITE_API = /writeFile|appendFile|copyFile|cpSync|\bcp\(|renameSync|createWriteStream|Bun\.write|Deno\.write|write_text|write_bytes|\.write\(|\bopen\([^)]*['"][wax][bt+]*['"]|shutil\.(?:copy|move)|os\.(?:rename|replace)|File\.(?:write|open)|IO\.write|file_put_contents|fopen\(/
const DEPTH_MAX = 3

interface State {
  root: string
  cwd: string
  targets: ShellTarget[]
  texts: string[]
  blind: boolean
  parsed: boolean
  /** NAME=value assignments made earlier in the command (a bare assignment or `export NAME=value`). */
  vars: Map<string, string>
  expandVars: boolean
  unresolved: string[]
}

/** `word` as a path relative to the root, or undefined when it lies outside or its base is unknown. */
function relOf(word: string, st: State): string | undefined {
  if (word === '' || word.includes('\u0000')) return undefined
  let w = word
  let base = st.cwd
  const known = /^\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))(?=\/|$)/.exec(w)
  const value = known && st.expandVars ? st.vars.get(known[1] ?? known[2]!) : undefined
  if (known && value !== undefined && !value.includes('$')) w = value + w.slice(known[0].length)
  else {
    const lead = /^\$(?:\{[A-Za-z_]\w*\}|[A-Za-z_]\w*)\//.exec(w)
    if (lead) {
      w = w.slice(lead[0].length)
      base = st.root
    }
  }
  if (w.startsWith('$') || w.startsWith('~')) {
    st.unresolved.push(word)
    return undefined
  }
  const abs = w.startsWith('/') ? posix.normalize(w) : posix.resolve(base, w)
  const r = posix.relative(st.root, abs)
  if (r === '' || r.startsWith('..') || posix.isAbsolute(r)) return undefined
  return w.endsWith('/') && !r.endsWith('/') ? `${r}/` : r
}

const isSrc = (rel: string): boolean => rel === 'src' || rel.startsWith('src/')

function addTarget(st: State, rel: string | undefined, via: string, loose = false): ShellTarget | undefined {
  if (rel === undefined) return undefined
  const bare = rel.replace(/\/+$/, '')
  let kind: ShellTarget['kind'] | undefined
  if (bare === CATALOG_PATH) kind = 'catalog'
  else if (loose ? rel.startsWith('src/') : isSrc(bare)) kind = 'src'
  if (!kind) return undefined
  const found = st.targets.find((t) => t.path === rel && t.kind === kind)
  if (found) return found
  const t: ShellTarget = { path: rel, kind, test: kind === 'src' && isTestFile(rel), via }
  st.targets.push(t)
  return t
}

const options = (args: string[]): { opts: string[]; rest: string[] } => ({ opts: args.filter((a) => a.startsWith('-') && a !== '-'), rest: args.filter((a) => !a.startsWith('-') || a === '-') })

/** The words of `cmd` after its name, then its heredocs and herestrings. */
const payloadOf = (cmd: Cmd, nameIndex: number): string => [...cmd.words.slice(nameIndex + 1), ...cmd.heredocs, ...cmd.herestrings].join('\n')

function scriptLiterals(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(['"`])([^'"`\s\\\n]+)\1/g)) out.push(m[2]!)
  return out
}

function analyzeScript(script: string, st: State, via: string): void {
  const stripped = script.replace(/\b(?:sys\.)?std(?:out|err)\.write\(/g, '(')
  if (!WRITE_API.test(stripped)) return
  const hits: ShellTarget[] = []
  for (const lit of scriptLiterals(script)) {
    const rel = relOf(lit, st)
    const t = rel !== undefined && (rel.startsWith('src/') || rel === CATALOG_PATH) ? addTarget(st, rel, via) : undefined
    if (t) hits.push(t)
    else if (lit === CATALOG_FILE) {
      const c = addTarget(st, CATALOG_PATH, via)
      if (c) hits.push(c)
    }
  }
  if (!hits.length && /['"]src['"]/.test(script)) {
    const t = addTarget(st, 'src/(script)', via, true)
    if (t) hits.push(t)
  }
  if (hits.some((t) => t.kind === 'src' && !t.test)) st.texts.push(script)
}

function visible(cmd: Cmd, all: Cmd[], name: string): boolean {
  if (name === 'sed' || name === 'perl' || name === 'ruby' || name === 'gsed') return true
  return all.some((c) => c.pipe === cmd.pipe && (c.heredocs.length > 0 || c.herestrings.length > 0 || /^(?:echo|printf)$/.test(base(c.words))))
}

const base = (words: string[]): string => {
  const w = words.find((x) => !/^[A-Za-z_]\w*=/.test(x) && !WRAPPERS.has(x))
  return w === undefined ? '' : posix.basename(w)
}

/** Judged text of the other commands of a pipeline (`echo … | tee src/x`). */
const pipeMates = (cmd: Cmd, all: Cmd[]): string =>
  all
    .filter((c) => c !== cmd && c.pipe === cmd.pipe)
    .map((c) => [...c.words, ...c.heredocs, ...c.herestrings].join('\n'))
    .join('\n')

function handle(cmd: Cmd, all: Cmd[], st: State, depth: number): void {
  // a bare assignment (`f=src/x.ts`) or `export f=…` is remembered for later words of the command
  const assigns = cmd.words[0] === 'export' ? cmd.words.slice(1) : cmd.words
  if (assigns.length && assigns.every((w) => /^[A-Za-z_]\w*=/.test(w))) {
    for (const a of assigns) st.vars.set(a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1))
    return
  }
  const words = cmd.words.slice()
  unwrap(words)
  const nameIndex = cmd.words.length - words.length
  const name = words.length ? posix.basename(words[0]!) : ''
  const args = words.slice(1)
  const mark: ShellTarget[] = []
  const hit = (rel: string | undefined, via: string): void => {
    const t = addTarget(st, rel, via)
    if (t) mark.push(t)
  }

  if (name === 'cd' || name === 'pushd') {
    const d = args.find((a) => !a.startsWith('-'))
    if (d !== undefined) {
      const abs = d.startsWith('/') ? posix.normalize(d) : d.startsWith('$') || d.startsWith('~') || d.includes('\u0000') ? undefined : posix.resolve(st.cwd, d)
      if (abs !== undefined) st.cwd = abs
    }
    return
  }

  for (const r of cmd.redirs) if (WRITE_OPS.has(r.op) && r.target !== '' && !r.target.startsWith('/dev/')) hit(relOf(r.target, st), 'redirect')

  const { rest } = options(args)
  switch (name) {
    case 'tee':
      for (const a of rest) hit(relOf(a, st), 'tee')
      break
    case 'sed':
    case 'gsed':
    case 'perl':
    case 'ruby': {
      const inPlace = args.some((a) => /^-[A-Za-z]*i/.test(a) || a.startsWith('--in-place'))
      if (inPlace) {
        const files: string[] = []
        let hasScript = false
        for (let k = 0; k < args.length; k++) {
          const a = args[k]!
          if (a === '-e' || a === '-f' || a === '--expression' || a === '--file' || (name !== 'sed' && /^-[A-Za-z]*e$/.test(a))) {
            hasScript = true
            k++
          } else if (a.startsWith('-')) {
            if (/^-[A-Za-z]*e/.test(a)) hasScript = true
          } else if (a !== '') files.push(a)
        }
        if (name === 'sed' && !hasScript) files.shift()
        for (const f of files) hit(relOf(f, st), 'sed-i')
      } else if (name === 'perl' || name === 'ruby') interpreter(cmd, args, st)
      break
    }
    case 'cp':
    case 'mv':
    case 'install':
    case 'rsync':
    case 'ditto':
    case 'ln': {
      const t = args.findIndex((a) => a === '-t' || a.startsWith('--target-directory'))
      if (t >= 0) hit(relOf(args[t]!.includes('=') ? args[t]!.split('=')[1]! : (args[t + 1] ?? ''), st), name)
      else if (rest.length >= 2) hit(relOf(rest[rest.length - 1]!, st), name)
      break
    }
    case 'touch':
    case 'truncate': {
      const skip = new Set<number>()
      args.forEach((a, k) => {
        if (['-s', '-t', '-d', '-r'].includes(a)) skip.add(k + 1)
      })
      args.forEach((a, k) => {
        if (!a.startsWith('-') && !skip.has(k)) hit(relOf(a, st), name)
      })
      break
    }
    case 'dd':
      for (const a of args) if (a.startsWith('of=')) hit(relOf(a.slice(3), st), 'dd')
      break
    case 'patch':
      for (const a of rest) hit(relOf(a, st), 'patch')
      if (!cmd.heredocs.length && !cmd.herestrings.length) st.unresolved.push('patch: a diff from a file or stdin')
      diffHeaders(cmd, st, hit)
      break
    case 'git': {
      let k = 0
      while (k < args.length && args[k]!.startsWith('-')) k += args[k] === '-C' || args[k] === '-c' ? 2 : 1
      const sub = args[k]
      const tail = args.slice(k + 1)
      if (sub === 'checkout') {
        const dd = tail.indexOf('--')
        for (const a of dd >= 0 ? tail.slice(dd + 1) : tail.filter((x) => !x.startsWith('-'))) hit(relOf(a, st), 'git checkout')
      } else if (sub === 'restore') {
        const skip = new Set<number>()
        tail.forEach((a, j) => {
          if (a === '-s' || a === '--source') skip.add(j + 1)
        })
        tail.forEach((a, j) => {
          if (!a.startsWith('-') && !skip.has(j)) hit(relOf(a, st), 'git restore')
        })
      } else if (sub === 'apply') {
        if (!cmd.heredocs.length && !cmd.herestrings.length) st.unresolved.push('git apply: a diff from a file or stdin')
        diffHeaders(cmd, st, hit)
      }
      else if (sub === 'mv') {
        const r = options(tail).rest
        if (r.length >= 2) hit(relOf(r[r.length - 1]!, st), 'git mv')
      }
      break
    }
    default:
      if (SHELLS.has(name)) {
        // a child shell: its cd and its variables stay inside it
        const cwd = st.cwd
        const vars = new Map(st.vars)
        const c = args.findIndex((a) => /^-[A-Za-z]*c$/.test(a))
        if (c >= 0 && args[c + 1] !== undefined && depth < DEPTH_MAX) walk(args[c + 1]!, st, depth + 1)
        else for (const h of cmd.heredocs) if (depth < DEPTH_MAX) walk(h, st, depth + 1)
        st.cwd = cwd
        st.vars = vars
      } else if (name === 'eval' && args.length && depth < DEPTH_MAX) walk(args.join(' '), st, depth + 1)
      else if (INTERPRETER.test(name)) interpreter(cmd, args, st)
  }

  const judged = mark.filter((t) => t.kind === 'src' && !t.test)
  if (judged.length) {
    st.texts.push([payloadOf(cmd, nameIndex), pipeMates(cmd, all)].filter(Boolean).join('\n'))
    if (!visible(cmd, all, name)) st.blind = true
  }
}

function diffHeaders(cmd: Cmd, st: State, hit: (rel: string | undefined, via: string) => void): void {
  for (const body of cmd.heredocs) for (const m of body.matchAll(/^\+\+\+ (?:[ab]\/)?(\S+)/gm)) hit(relOf(m[1]!, st), 'diff')
}

/** python3 -c '…', node -e '…', python3 - <<E … E: the script is the text the command introduces. */
function interpreter(cmd: Cmd, args: string[], st: State): void {
  const scripts: string[] = []
  const f = args.findIndex((a) => INLINE_FLAG.test(a))
  if (f >= 0 && args[f + 1] !== undefined) scripts.push(args[f + 1]!)
  scripts.push(...cmd.heredocs, ...cmd.herestrings)
  for (const s of scripts) analyzeScript(s, st, 'script')
}

function walk(command: string, st: State, depth: number): void {
  const L = new Lexer(command)
  L.run(false)
  if (!L.ok) st.parsed = false
  const saved: { cwd: string; vars: Map<string, string> }[] = []
  for (const c of L.cmds) {
    if (c.words[0] === SUB_OPEN && isMarker(c)) saved.push({ cwd: st.cwd, vars: new Map(st.vars) })
    else if (c.words[0] === SUB_CLOSE && isMarker(c)) {
      const s = saved.pop()
      if (s) Object.assign(st, s)
    } else handle(c, L.cmds, st, depth)
  }
}

/** The words of every simple command of `command`, in order, including those inside $( ), backticks and `bash -c '…'`. */
export function commandWords(command: string, depth = 0): string[][] {
  const L = new Lexer(command)
  L.run(false)
  const out: string[][] = []
  for (const c of L.cmds) {
    if (isMarker(c)) continue
    const words = c.words.slice()
    unwrap(words)
    if (!words.length) continue
    out.push(words)
    if (SHELLS.has(posix.basename(words[0]!)) && depth < DEPTH_MAX) {
      const k = words.findIndex((a) => /^-[A-Za-z]*c$/.test(a))
      if (k >= 0 && words[k + 1] !== undefined) out.push(...commandWords(words[k + 1]!, depth + 1))
    }
  }
  return out
}

/** True when a simple command of `command` is the one that writes the public catalog: `npm run catalog`, or steam-ingest's `catalog`. */
export function runsCatalogCommand(command: string): boolean {
  return commandWords(command).some((w) => {
    const name = posix.basename(w[0]!)
    if (/^(?:npm|pnpm|yarn|bun)$/.test(name)) {
      const rest = w.slice(1).filter((x) => x !== 'run' && x !== '--')
      return rest[0] === 'catalog' || (rest[0] === 'steam-ingest' && rest[1] === 'catalog')
    }
    // the CLI run by an interpreter, not a word that only mentions it (`echo tools/steam-ingest/cli.ts catalog`)
    if (!/^(?:tsx|node|bun|deno|ts-node)$/.test(name)) return false
    const cli = w.findIndex((x) => x.endsWith('steam-ingest/cli.ts'))
    return cli >= 1 && w[cli + 1] === 'catalog'
  })
}

export function analyzeShell(command: string, opt: ShellOptions): ShellAnalysis {
  const root = posix.normalize(opt.root).replace(/\/+$/, '') || '/'
  const cwd = opt.cwd ? (opt.cwd.startsWith('/') ? posix.normalize(opt.cwd) : posix.resolve(root, opt.cwd)) : root
  const st: State = { root, cwd, targets: [], texts: [], blind: false, parsed: true, vars: new Map(), expandVars: opt.expandVars === true, unresolved: [] }
  walk(command, st, 0)
  return { parsed: st.parsed, targets: st.targets, text: st.texts.join('\n'), blind: st.blind, unresolved: [...new Set(st.unresolved)] }
}
