import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { hooksLogFile } from './lib.ts'
import { findViolations, RULES, run, stripComments } from './no-imitation.ts'
import { pipeToScript, preFsWrite, preStrReplace } from './recorded.ts'

const root = mkdtempSync(join(tmpdir(), 'steam-noimit-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const lines = () => (existsSync(hooksLogFile(root)) ? readFileSync(hooksLogFile(root), 'utf8').split('\n').filter(Boolean) : [])
const src = (f: string) => join(root, 'src', f)
const product = readFileSync(join(import.meta.dirname, '../../.kiro/steering/product.md'), 'utf8')
const hookJson = JSON.parse(readFileSync(join(import.meta.dirname, '../../.kiro/hooks/no-imitation.json'), 'utf8'))

describe('no-imitation: the hook file and the rules it quotes', () => {
  it('is a v1 PreToolUse hook with matcher "write"', () => {
    expect(hookJson.version).toBe('v1')
    expect(hookJson.hooks[0]).toMatchObject({ trigger: 'PreToolUse', matcher: 'write', enabled: true, action: { type: 'command', command: 'npx tsx tools/hooks/no-imitation.ts' } })
  })
  it('quotes each rule verbatim from .kiro/steering/product.md, under the section it is in', () => {
    for (const r of Object.values(RULES)) {
      expect(product, r.text).toContain(r.text)
      const section = product.slice(product.indexOf(`## ${r.section}`))
      expect(section.indexOf(r.text)).toBeGreaterThan(0)
    }
  })
})

describe('no-imitation: findViolations', () => {
  it('finds speech synthesis', () => {
    expect(findViolations('const u = new SpeechSynthesisUtterance(t)\nwindow.speechSynthesis.speak(u)').map((f) => [f.kind, f.line])).toEqual([['speech', 1], ['speech', 2]])
  })
  it('finds handwriting fonts in CSS, in TS style objects and in @fontsource imports', () => {
    for (const code of [
      ".note { font-family: 'Caveat', cursive; }",
      'const s = { fontFamily: "Homemade Apple" }',
      "import '@fontsource/dancing-script'",
      "import '@fontsource-variable/great-vibes/index.css'",
      '@font-face { font-family: Kalam; src: url(k.woff2) }',
      '.a { font: 20px Pacifico }',
      '@import url("https://fonts.googleapis.com/css2?family=Satisfy&display=swap");',
      ':root { --note-font: Allura, serif }',
      '.a { font-family:\n    Caveat,\n    cursive; }',
      '.a { font-family: "My Handwriting Face" }',
    ]) expect(findViolations(code).map((f) => f.kind), code).toContain('font')
  })
  it('finds a handwriting package in import, dynamic import and require, but not a local file or prose', () => {
    for (const code of ["import h from 'handwriting.js'", "import { x } from '@scope/calligrapher'", "const m = await import('handwritten.js')", "const h = require('text-to-handwriting')"]) expect(findViolations(code).map((f) => f.kind), code).toEqual(['package'])
    expect(findViolations("import { quote } from './handwriting-note'")).toEqual([])
    expect(findViolations("import { quote } from '@/handwriting/quote'")).toEqual([])
  })
  it('passes the project\'s own fonts, prose about handwriting, generic families and comments that name a rule', () => {
    for (const code of [
      "import '@fontsource/im-fell-english'\nimport '@fontsource/literata'\nimport '@fontsource/dm-mono'",
      ":root { --note-font: 'Literata', serif } .t { font-family: 'IM Fell English', serif }",
      "const copy = 'Not a handwriting font: the writer\\'s own pixels.'",
      "const a = 'Satisfy the gate'; const b = 'recursive caveat'",
      '// never call speechSynthesis; never use a Caveat font-family or cursive\n/* import x from "handwriting" */\nexport {}',
      '<!-- font-family: Caveat -->',
      'const url = "https://example.org/a" // speechSynthesis',
      'const aria = "aria-live"',
    ]) expect(findViolations(code), code).toEqual([])
  })
  it('keeps line numbers when it strips comments', () => {
    const t = '/* a\n b */\n// c\nwindow.speechSynthesis'
    expect(stripComments(t).split('\n')).toHaveLength(4)
    expect(findViolations(t)).toEqual([{ kind: 'speech', line: 4, what: 'speechSynthesis' }])
  })
})

describe('no-imitation: recorded PreToolUse documents', () => {
  it('BLOCK: an fs_write under src/ that speaks exits 2; stderr names the file, line and the product.md rule; one "blocked" line is logged', () => {
    const code = "export function say(t: string) {\n  speechSynthesis.speak(new SpeechSynthesisUtterance(t))\n}\n"
    const r = run(preFsWrite(root, src('steam/say.ts'), code), { now: () => new Date('2026-11-25T13:00:00.000Z') })
    expect(r.exit).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('no-imitation: src/steam/say.ts:2: speechSynthesis. Rule (.kiro/steering/product.md, "Quoted, not generated"): "No speech synthesis, synthetic voice, chatbot or persona."')
    expect(lines()).toEqual(['2026-11-25T13:00:00.000Z · no-imitation · src/steam/say.ts · blocked: speechSynthesis (line 2), SpeechSynthesisUtterance (line 2)'])
  })
  it('BLOCK: a relative path is resolved against the event\'s cwd', () => {
    const r = run(preFsWrite(root, 'src/steam/rel.ts', 'speechSynthesis.cancel()'))
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain('no-imitation: src/steam/rel.ts:1: speechSynthesis')
  })
  it('BLOCK: a handwriting font in CSS, and a handwriting package, each with their rule', () => {
    const css = run(preFsWrite(root, src('index.css'), ".note-text { font-family: 'Caveat', cursive; }"))
    expect(css.exit).toBe(2)
    expect(css.stderr).toContain('Rule (.kiro/steering/product.md, "Quoted, not generated"): "Never render a note in a handwriting-style font."')
    const pkg = run(preFsWrite(root, src('app/Note.tsx'), "import hand from 'handwriting.js'\nexport const N = () => null"))
    expect(pkg.exit).toBe(2)
    expect(pkg.stderr).toContain('src/app/Note.tsx:1: handwriting.js')
    expect(pkg.stderr).toContain('"Never generate, trace into vectors, re-typeset or imitate handwriting."')
  })
  it('BLOCK: str_replace is judged by the text it introduces', () => {
    const r = run(preStrReplace(root, src('copy/strings.ts'), "font: 'Literata'", "font-family: 'Great Vibes'"))
    expect(r.exit).toBe(2)
    expect(r.stderr).toContain('src/copy/strings.ts:1: Great Vibes')
  })
  it('PASS: ordinary code under src/ exits 0 silently and one "pass" line is logged', () => {
    const before = lines().length
    const r = run(preFsWrite(root, src('cook/timing.ts', ), "import '@fontsource/literata'\nexport const t = 1 // no speechSynthesis here"), { now: () => new Date('2026-11-25T13:05:00.000Z') })
    expect(r).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toHaveLength(before + 1)
    expect(lines().at(-1)).toBe('2026-11-25T13:05:00.000Z · no-imitation · src/cook/timing.ts · pass (no speech synthesis, handwriting font or handwriting package)')
  })
  it('PASS: str_replace that removes the violation is allowed (only introduced text is judged)', () => {
    expect(run(preStrReplace(root, src('steam/say.ts'), 'speechSynthesis.speak(x)', 'noop(x)')).exit).toBe(0)
  })
  it('OUT OF SCOPE: paths outside src/, test files and non-path tools exit 0 with no log line', () => {
    const before = lines().length
    for (const raw of [
      preFsWrite(root, join(root, 'tools/x.ts'), 'speechSynthesis'),
      preFsWrite(root, join(root, 'docs/a.md'), 'speechSynthesis'),
      preFsWrite(root, src('steam/say.test.ts'), "expect(code).not.toContain('speechSynthesis')"),
      preFsWrite(root, src('__tests__/no-voice.tsx'), 'speechSynthesis'),
      preFsWrite(root, '/elsewhere/src/x.ts', 'speechSynthesis'),
      JSON.stringify({ hook_event_name: 'PreToolUse', cwd: root, tool_name: 'fs_write', tool_input: { path: src('x.ts') } }),
      'not json',
    ]) expect(run(raw)).toEqual({ exit: 0, stdout: '', stderr: '' })
    expect(lines()).toHaveLength(before)
  })
})

describe('no-imitation: the script as Kiro starts it', () => {
  it('exits 2 with the rule on stderr for a block and 0 for a pass', () => {
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src/keep.txt'), '')
    const b = pipeToScript('tools/hooks/no-imitation.ts', preFsWrite(root, src('steam/voice.ts'), 'new SpeechSynthesisUtterance("quince")'))
    expect(b.exit).toBe(2)
    expect(b.stderr).toContain('"No speech synthesis, synthetic voice, chatbot or persona."')
    const p = pipeToScript('tools/hooks/no-imitation.ts', preFsWrite(root, src('steam/ok.ts'), 'export const a = 1'))
    expect(p).toEqual({ exit: 0, stdout: '', stderr: '' })
  }, 60_000)
})
