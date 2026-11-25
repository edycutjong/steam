import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { hooksLogFile } from './lib.ts'
import { pipeToNode, preShell } from './recorded.ts'
import { run } from './src-scan.ts'

const CAT = 'content/' + 'catalog' + '.json'
const made: string[] = []
afterAll(() => made.forEach((r) => rmSync(r, { recursive: true, force: true })))

let root = ''
const git = (...args: string[]) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout
}
const put = (rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'steam-srcscan-'))
  made.push(root)
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@example.invalid')
  git('config', 'user.name', 't')
  put('src/a.ts', 'export const a = 1\nexport const b = 2\n')
  put('src/a.test.ts', 'expect(1).toBe(1)\n')
  put(CAT, '[]\n')
  put('README.md', 'x\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
})
const lines = () => (existsSync(hooksLogFile(root)) ? readFileSync(hooksLogFile(root), 'utf8').split('\n').filter(Boolean) : [])
const scan = (command = 'ls', at = '2026-11-25T12:00:00Z') => run(preShell(root, command, undefined, 'PostToolUse'), { now: () => new Date(at) })
const hookJson = JSON.parse(readFileSync(join(import.meta.dirname, '../../.kiro/hooks/src-scan-after-shell.json'), 'utf8'))

describe('src-scan: the hook file', () => {
  it('is a v1 PostToolUse hook with matcher "shell" that starts with node', () => {
    expect(hookJson.version).toBe('v1')
    expect(hookJson.hooks[0]).toMatchObject({ name: 'src-scan-after-shell', trigger: 'PostToolUse', matcher: 'shell', enabled: true, action: { type: 'command', command: 'node tools/hooks/src-scan.ts' } })
  })
})

describe('src-scan: a file a script wrote that the command text did not name (hook-coverage H3)', () => {
  it('fails on a new untracked file under src/ that speaks, exits 2 with the rule, and logs one line', () => {
    put('src/steam/zz-shell-probe2.ts', 'export const a = 1\nexport const say = (t: string) => speechSynthesis.speak(new SpeechSynthesisUtterance(t))\n')
    const r = scan('node scripts/x.ts')
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain('src-scan: src/steam/zz-shell-probe2.ts:2: speechSynthesis')
    expect(r.stderr).toContain('"No speech synthesis, synthetic voice, chatbot or persona."')
    expect(lines()).toEqual(['2026-11-25T12:00:00.000Z · src-scan · src/steam/zz-shell-probe2.ts · fail speechSynthesis (src/steam/zz-shell-probe2.ts:2), SpeechSynthesisUtterance (src/steam/zz-shell-probe2.ts:2)'])
  })
  it('fails on an added line in a tracked file, staged or not, and judges only the added lines', () => {
    put('src/legacy.ts', 'export const s = speechSynthesis\n') // committed below: already in HEAD, not judged again
    git('add', '-A')
    git('commit', '-q', '-m', 'legacy')
    put('src/legacy.ts', 'export const s = speechSynthesis\nexport const t = 1\n')
    expect(scan().exit).toBe(0)
    put('src/a.ts', 'export const a = 1\nexport const b = 2\nconst c = "Caveat"\nconst d = { fontFamily: "Caveat" }\n')
    git('add', 'src/a.ts')
    put('src/a.ts', 'export const a = 1\nexport const b = 2\nconst c = "Caveat"\nconst d = { fontFamily: "Caveat" }\nconst e = speechSynthesis\n')
    const r = scan()
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain('src/a.ts:4: Caveat')
    expect(r.stderr).toContain('src/a.ts:5: speechSynthesis')
    expect(r.stderr).not.toContain('src/legacy.ts')
  })
  it('does not judge a test file, and does not count it', () => {
    put('src/b.test.ts', 'expect(speechSynthesis).toBeUndefined()\n')
    put('src/a.test.ts', 'expect(speechSynthesis).toBeUndefined()\n')
    expect(scan()).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual(['2026-11-25T12:00:00.000Z · src-scan · src/ · pass (0 files)'])
  })
  it('counts the non-test files it judged in the pass line', () => {
    put('src/a.ts', 'export const a = 1\nexport const b = 3\n')
    put('src/new.ts', 'export const n = 1\n')
    put('src/new.test.ts', 'x\n')
    scan()
    expect(lines()).toEqual(['2026-11-25T12:00:00.000Z · src-scan · src/ · pass (2 files)'])
  })
  it('skips a file that is binary or over 1 MB', () => {
    writeFileSync(join(root, 'src/bin.ts'), Buffer.from([0, 1, 2, 0x73, 0x70, 0x65, 0x65, 0x63, 0x68]))
    put('src/big.ts', `${'// padding\n'.repeat(120_000)}const x = speechSynthesis\n`)
    expect(scan().exit).toBe(0)
  })
  it('judges nothing outside src/', () => {
    put('docs/a.md', 'speechSynthesis\n')
    put('tools/x.ts', 'speechSynthesis\n')
    put('e2e/x.ts', 'speechSynthesis\n')
    expect(scan().exit).toBe(0)
  })
})

describe('src-scan: one line per change of the judged state', () => {
  it('writes a line the first time, none while the state is the same, and one when it changes', () => {
    scan('ls', '2026-11-25T12:00:00Z')
    scan('ls', '2026-11-25T12:00:01Z')
    put('src/zz.ts', 'const a = speechSynthesis\n')
    expect(scan('ls', '2026-11-25T12:00:02Z').exit).toBe(2)
    expect(scan('ls', '2026-11-25T12:00:03Z').exit).toBe(2) // still a fail: the agent reads it again, the log does not repeat
    rmSync(join(root, 'src/zz.ts'))
    expect(scan('ls', '2026-11-25T12:00:04Z').exit).toBe(0)
    scan('ls', '2026-11-25T12:00:05Z')
    expect(lines().map((l) => l.replace(/^\S+ · src-scan · /, ''))).toEqual(['src/ · pass (0 files)', 'src/zz.ts · fail speechSynthesis (src/zz.ts:1)', 'src/ · pass (0 files)'])
  })
  it('keeps its hash under node_modules/.cache/steam-hooks/', () => {
    scan()
    expect(existsSync(join(root, 'node_modules/.cache/steam-hooks'))).toBe(true)
  })
  it('a cache file that is not JSON is the same as none', () => {
    scan()
    for (const f of ['src-scan.json']) writeFileSync(join(root, 'node_modules/.cache/steam-hooks', f), 'not json')
    expect(scan().exit).toBe(0)
    expect(lines()).toHaveLength(2)
  })
})

describe('src-scan: the catalog changes only through npm run catalog', () => {
  const edit = () => put(CAT, '[{"id":"x"}]\n')
  it('fails on a change of the catalog by any other command and says which file', () => {
    edit()
    const r = scan('python3 scripts/y.py')
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain(`src-scan: ${CAT} differs from HEAD and was not written by npm run catalog`)
    expect(r.stderr).toContain('Use `npm run catalog`: it verifies every recipe first and is the only writer of ' + CAT)
    expect(lines()).toEqual([`2026-11-25T12:00:00.000Z · src-scan · ${CAT} · fail the catalog differs from HEAD and was not written by npm run catalog (${CAT})`])
  })
  it('accepts the change when the command was npm run catalog (or the tsx form), and remembers its content', () => {
    edit()
    expect(scan('npm run catalog').exit).toBe(0)
    expect(scan('ls').exit).toBe(0) // an uncommitted catalog that npm run catalog wrote stays accepted
    put(CAT, '[{"id":"y"}]\n')
    expect(scan('ls').exit).toBe(2)
  })
  it('accepts the tsx form of the command', () => {
    edit()
    expect(scan('npx tsx tools/steam-ingest/cli.ts catalog').exit).toBe(0)
  })
  it('a command that only mentions the words does not make a change legitimate', () => {
    edit()
    expect(scan('echo "npm run catalog" > /tmp/x').exit).toBe(2)
  })
  it('a catalog equal to HEAD passes, including after a restore', () => {
    edit()
    expect(scan().exit).toBe(2)
    git('checkout', '--', CAT)
    expect(scan().exit).toBe(0)
  })
  it('a deleted catalog is a change', () => {
    rmSync(join(root, CAT))
    expect(scan().exit).toBe(2)
  })
})

describe('src-scan: never silent, never a block of its own making', () => {
  it('outside a git repository it allows and logs the line as unscanned', () => {
    const plain = mkdtempSync(join(tmpdir(), 'steam-srcscan-nogit-'))
    made.push(plain)
    const r = run(preShell(plain, 'ls', undefined, 'PostToolUse'), { now: () => new Date('2026-11-25T12:00:00Z') })
    expect(r.exit).toBe(0)
    expect(readFileSync(hooksLogFile(plain), 'utf8')).toMatch(/src-scan · src\/ · unscanned \(git: /)
  })
  it('stdin that is not a hook event is allowed without a line', () => {
    for (const raw of ['', 'not json', '[]']) expect(run(raw, { now: () => new Date() })).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual([])
  })
  it('an event with no command still scans (the command only decides whether a catalog change is legitimate)', () => {
    put('src/zz.ts', 'speechSynthesis\n')
    expect(run(JSON.stringify({ cwd: root, hook_event_name: 'PostToolUse', tool_name: 'execute_bash', tool_input: {} })).exit).toBe(2)
  })
})

describe('src-scan: the process, as Kiro starts it', () => {
  it('node tools/hooks/src-scan.ts exits 2 with the finding on stderr and nothing on stdout', () => {
    put('src/zz.ts', 'const a = speechSynthesis\n')
    const r = pipeToNode('tools/hooks/src-scan.ts', preShell(root, 'ls', undefined, 'PostToolUse'))
    expect(r.exit).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('src-scan: src/zz.ts:1: speechSynthesis')
  })
  it('exits 0 with empty output on a clean tree', () => {
    expect(pipeToNode('tools/hooks/src-scan.ts', preShell(root, 'ls', undefined, 'PostToolUse'))).toEqual({ exit: 0, stdout: '', stderr: '' })
  })
})
