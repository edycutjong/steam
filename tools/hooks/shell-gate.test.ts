import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { hooksLogFile } from './lib.ts'
import { pipeToNode, preShell, recordedShellEvent } from './recorded.ts'
import { run } from './shell-gate.ts'

const CAT = 'content/' + 'catalog' + '.json'
const made: string[] = []
afterAll(() => made.forEach((r) => rmSync(r, { recursive: true, force: true })))
let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'steam-shellgate-'))
  made.push(root)
})
const lines = () => (existsSync(hooksLogFile(root)) ? readFileSync(hooksLogFile(root), 'utf8').split('\n').filter(Boolean) : [])
const gate = (command: string, toolCwd?: string) => run(preShell(root, command, toolCwd), { now: () => new Date('2026-11-25T12:00:00Z') })
const hookJson = JSON.parse(readFileSync(join(import.meta.dirname, '../../.kiro/hooks/shell-gate.json'), 'utf8'))
const product = readFileSync(join(import.meta.dirname, '../../.kiro/steering/product.md'), 'utf8')

describe('shell-gate: the hook file and the recorded event (hook-coverage H2)', () => {
  it('is a v1 PreToolUse hook with matcher "shell" that starts with node, not npx tsx', () => {
    expect(hookJson.version).toBe('v1')
    expect(hookJson.hooks[0]).toMatchObject({ name: 'shell-gate', trigger: 'PreToolUse', matcher: 'shell', enabled: true, action: { type: 'command', command: 'node tools/hooks/shell-gate.ts' } })
  })
  it('the recorded shell event has the shape the gate reads: execute_bash with tool_input.command and the workspace cwd', () => {
    const e = recordedShellEvent() as { hook_event_name: string; tool_name: string; cwd: string; tool_input: { command: string } }
    expect(e.hook_event_name).toBe('PreToolUse')
    expect(e.tool_name).toBe('execute_bash')
    expect(typeof e.tool_input.command).toBe('string')
    expect(e.cwd.startsWith('/')).toBe(true)
  })
  it('allows the recorded command itself: no output, no line', () => {
    const r = run(JSON.stringify({ ...recordedShellEvent(), cwd: root }))
    expect(r).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual([])
  })
})

describe('shell-gate: a write under src/ that speaks, sets a handwriting font or pulls a handwriting package', () => {
  it('refuses a heredoc that writes speechSynthesis, quotes the rule, and logs one line', () => {
    const r = gate("cat > src/steam/zz-shell-probe.ts <<'E'\nexport const say = (t: string) => speechSynthesis.speak(new SpeechSynthesisUtterance(t))\nE")
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain('shell-gate: src/steam/zz-shell-probe.ts:1: speechSynthesis')
    expect(r.stderr).toContain(`"${'No speech synthesis, synthetic voice, chatbot or persona.'}"`)
    expect(product).toContain('No speech synthesis, synthetic voice, chatbot or persona.')
    expect(lines()).toEqual(['2026-11-25T12:00:00.000Z · shell-gate · src/steam/zz-shell-probe.ts · blocked: speechSynthesis (line 1), SpeechSynthesisUtterance (line 1)'])
  })
  it.each([
    ['an echo redirect', "echo 'speechSynthesis.cancel()' > src/a.ts", 'speechSynthesis'],
    ['a printf append', "printf '%s' 'new SpeechSynthesisUtterance(x)' >> src/a.ts", 'SpeechSynthesisUtterance'],
    ['a tee pipe', "echo 'speechSynthesis.speak(u)' | tee src/a.ts", 'speechSynthesis'],
    ['sed -i with a replacement', "sed -i 's/speak/speechSynthesis.speak/' src/a.ts", 'speechSynthesis'],
    ['a python heredoc', "python3 - <<'E'\np = 'src/a.ts'\nopen(p, 'w').write('speechSynthesis.speak(u)')\nE", 'speechSynthesis'],
    ['a python -c script', `python3 -c "open('src/a.ts','w').write('speechSynthesis.speak(u)')"`, 'speechSynthesis'],
    ['node -e', `node -e "require('fs').writeFileSync('src/a.ts', 'speechSynthesis.speak(u)')"`, 'speechSynthesis'],
    ['a handwriting font in css', "cat >> src/app/app.css <<'E'\n.note { font-family: 'Caveat', cursive; }\nE", 'Caveat'],
    ['a handwriting package import', "cat > src/a.ts <<'E'\nimport h from 'handwriting.js'\nE", 'handwriting.js'],
    ['bash -c', `bash -c "echo 'speechSynthesis.x' > src/a.ts"`, 'speechSynthesis'],
    ['a heredoc with no end (unparsed, but the text is read)', "cat > src/a.ts <<'E'\nspeechSynthesis.speak(u)", 'speechSynthesis'],
  ])('refuses %s', (_n, cmd, what) => {
    const r = gate(cmd)
    expect(r.exit, r.stderr).toBe(2)
    expect(r.stderr).toContain(what)
    expect(r.stderr).toContain('.kiro/steering/product.md')
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('shell-gate · src/')
    expect(lines()[0]).toContain('blocked: ')
  })
  it('allows a clean write and logs one pass line with the target', () => {
    const r = gate("cat > src/steam/clean.ts <<'E'\nexport const a = 1\nE")
    expect(r).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual(['2026-11-25T12:00:00.000Z · shell-gate · src/steam/clean.ts · pass (no speech synthesis, handwriting font or handwriting package in the text the command introduces)'])
  })
  it('says when the content is not in the command text (cp, a redirect from another command)', () => {
    expect(gate('cp /tmp/x.ts src/a.ts').exit).toBe(0)
    expect(gate('git show HEAD:src/b.ts > src/b.ts').exit).toBe(0)
    expect(lines()).toHaveLength(2)
    for (const l of lines()) expect(l).toContain('the content is not in the command text; src-scan judges the file after')
  })
  it('does not judge a test file and writes no line for it', () => {
    expect(gate("cat > src/a.test.ts <<'E'\nexpect(speechSynthesis).toBeUndefined()\nE")).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual([])
  })
  it('judges the text the command introduces, not the whole command: speechSynthesis named only in a grep or in a write elsewhere is allowed', () => {
    expect(gate('grep -rn speechSynthesis src/ | head').exit).toBe(0)
    expect(gate("echo 'speechSynthesis' > docs/a.md && echo 'export const a = 1' > src/a.ts").exit).toBe(0)
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('pass')
  })
  it('uses the cwd of the tool call for a relative path', () => {
    const r = gate("echo 'speechSynthesis.x' > a.ts", join(root, 'src'))
    expect(r.exit).toBe(2)
    expect(lines()[0]).toContain('shell-gate · src/a.ts · blocked')
  })
})

describe('shell-gate: a write to the public catalog', () => {
  it.each([
    ['an echo redirect', `echo '{}' > ${CAT}`],
    ['a heredoc', `cat > ${CAT} <<'E'\n[]\nE`],
    ['a cp', `cp /tmp/c.json ${CAT}`],
    ['a tee', `echo '[]' | tee ${CAT}`],
    ['sed -i', `sed -i 's/a/b/' ${CAT}`],
    ['a python one-liner', `python3 -c "open('${CAT}','w').write('[]')"`],
    ['node -e', `node -e "require('fs').writeFileSync('${CAT}','[]')"`],
  ])('refuses %s with catalog-gate\'s reason', (_n, cmd) => {
    const r = gate(cmd)
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain('Use `npm run catalog`: it verifies every recipe first and is the only writer of ' + CAT)
    expect(r.stderr).toContain('"Note crops and the gate": a recipe reaches Cook Mode only when P1-P6 pass in its gate.json.')
    expect(lines()).toEqual([`2026-11-25T12:00:00.000Z · shell-gate · ${CAT} · blocked: a shell command writes the catalog; only npm run catalog writes it`])
  })
  it('refuses an absolute path to the catalog inside the root', () => {
    const r = gate(`echo '[]' > ${root}/${CAT}`)
    expect(r.exit).toBe(2)
    expect(lines()[0]).toContain(`shell-gate · ${CAT} · blocked`)
  })
  it('allows npm run catalog, the tsx form, and a read of the catalog; writes no line', () => {
    for (const c of ['npm run catalog', 'npx tsx tools/steam-ingest/cli.ts catalog', `cat ${CAT}`, `git diff -- ${CAT}`, 'echo x > content/recipes/quinces-marmalade/notes.md']) expect(gate(c), c).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual([])
  })
  it('one command that writes src/ and the catalog gets one line with both reasons', () => {
    const r = gate(`echo 'speechSynthesis.x' > src/a.ts && echo '[]' > ${CAT}`)
    expect(r.exit).toBe(2)
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('blocked: speechSynthesis (line 1) | a shell command writes the catalog')
  })
})

describe('shell-gate: no spam, and never silent', () => {
  it.each(['ls -la', 'npm test 2>&1 | tail -5', 'git status --short', "echo x > docs/a.md", "cat > e2e/x.spec.ts <<'E'\nimport { a } from '../src/a'\nE", 'grep -rn foo src/', 'node scripts/render-static-panes.ts', 'rm -f src/a.ts', 'cp src/a.ts /tmp/b.ts'])('%s: exit 0, no output, no line', (cmd) => {
    expect(gate(cmd)).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual([])
  })
  it('a command it cannot parse that names src/ is allowed and logged as unparsed', () => {
    const r = gate("echo 'open quote > src/a.ts")
    expect(r.exit).toBe(0)
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatch(/shell-gate · \(unparsed command\) · pass \(unparsed: /)
  })
  it('an unparsed command that names the catalog is logged as unparsed too, and one that names neither writes no line', () => {
    expect(gate(`echo "open > ${CAT}`).exit).toBe(0)
    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toContain('unparsed')
    expect(gate("echo 'open quote").exit).toBe(0)
    expect(lines()).toHaveLength(1)
  })
  it('stdin that is not a hook event, or an event with no command, is allowed without a line', () => {
    for (const raw of ['', 'not json', '[]', '{}', JSON.stringify({ cwd: root, tool_name: 'execute_bash', tool_input: {} })]) expect(run(raw)).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual([])
  })
  it('a log write that fails does not change the verdict', () => {
    const r = run(preShell('/nonexistent-root/\u0000x', "echo 'speechSynthesis.x' > src/a.ts"))
    expect(r.exit).toBe(2)
  })
})

describe('shell-gate: the process, as Kiro starts it', () => {
  it('node tools/hooks/shell-gate.ts exits 2 on a violation with the rule on stderr and nothing else on stdout', () => {
    const r = pipeToNode('tools/hooks/shell-gate.ts', preShell(root, "echo 'speechSynthesis.x' > src/a.ts"))
    expect(r.exit).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('shell-gate: src/a.ts:1: speechSynthesis')
    expect(lines()).toHaveLength(1)
  })
  it('exits 0 with empty output on a clean command (node prints no warning)', () => {
    const r = pipeToNode('tools/hooks/shell-gate.ts', preShell(root, 'ls src'))
    expect(r).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toEqual([])
  })
})
