// Hook no-imitation (PreToolUse, matcher "write"): code under src/ may not speak, set a note in a handwriting-style font, or
// pull in a package that generates handwriting. Exit 2 puts the stderr back in front of the agent (probe-3.5.0 result 2).
// The rules are the "Quoted, not generated" rules of .kiro/steering/product.md; each message quotes the rule it enforces.
//
// What is judged: the text a write introduces (fs_write: the whole new text; str_replace: newStr), minus comments.
// Test files (*.test.ts, src/__tests__/) are not judged: they are not shipped, and a test that asserts the absence of
// speechSynthesis has to name it.

import { isAbsolute, relative, resolve } from 'node:path'
import { isMain, logHook, ok, parseHookInput, rootOf, runAsMain, type HookInput, type HookResult } from './lib.ts'

export const HOOK = 'no-imitation'

export const RULES = {
  speech: { section: 'Quoted, not generated', text: 'No speech synthesis, synthetic voice, chatbot or persona.' },
  font: { section: 'Quoted, not generated', text: 'Never render a note in a handwriting-style font.' },
  package: { section: 'Quoted, not generated', text: 'Never generate, trace into vectors, re-typeset or imitate handwriting.' },
} as const
type Kind = keyof typeof RULES

export interface Finding {
  kind: Kind
  line: number
  what: string
}

export const SPEECH = /speechSynthesis|SpeechSynthesisUtterance/
/** Handwriting and script families, the CSS generic `cursive`, and any family or package slug that says handwriting. */
export const HAND_FONT = /\b(?:Dancing Script|Homemade Apple|Caveat|Kalam|Satisfy|Great Vibes|Pacifico|Allura)\b|handwrit|\bcursive\b/i
export const HAND_PACKAGE = /handwriting|calligrapher|handwritten\.js/i
/** A line that declares or loads a font, as opposed to prose that mentions one. */
const FONT_SYNTAX = /font-family|fontFamily|font-face|FontFace|@fontsource|fontsource|fonts\.(?:googleapis|gstatic)|(?:^|[\s;{(])font\s*:\s*(?:(?:italic|oblique|normal|bold|bolder|lighter|\d{3})\s+)*[\d.]+(?:px|rem|em|pt|%)|--[\w-]*font[\w-]*\s*:/i

export const isTestFile = (rel: string): boolean => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(rel) || rel.startsWith('src/__tests__/')

/** Blanks comments out (line count kept) so that a comment that names a rule is not a violation. */
export function stripComments(text: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank).replace(/(^|[^:'"\w])\/\/.*$/gm, (_m, pre: string) => pre)
}

export function findViolations(text: string): Finding[] {
  const out: Finding[] = []
  const lines = stripComments(text).split('\n')
  lines.forEach((ln, k) => {
    const line = k + 1
    for (const sp of ln.matchAll(new RegExp(SPEECH.source, 'g'))) out.push({ kind: 'speech', line, what: sp[0] })
    const prev = k > 0 ? lines[k - 1]! : ''
    const fontCtx = FONT_SYNTAX.test(ln) || (FONT_SYNTAX.test(prev) && /[:,]\s*$/.test(prev))
    if (fontCtx) {
      // @fontsource/dancing-script, great_vibes: compare with the family's spaced name too
      const h = HAND_FONT.exec(ln) ?? HAND_FONT.exec(ln.replace(/[-_]/g, ' '))
      if (h) out.push({ kind: 'font', line, what: h[0] })
    }
  })
  // a package: any bare specifier of an import, dynamic import or require
  const text2 = stripComments(text)
  for (const m of text2.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"`])([^'"`\n]+)\1/g)) {
    const spec = m[2]!
    if (/^(?:[./~]|@\/|node:)/.test(spec)) continue
    if (HAND_PACKAGE.test(spec)) out.push({ kind: 'package', line: text2.slice(0, m.index).split('\n').length, what: spec })
  }
  return out.sort((a, b) => a.line - b.line)
}

/** The text a write introduces, or undefined when the tool is not one that writes src text. */
function introduced(i: HookInput): string | undefined {
  const t = i.tool_input ?? {}
  const parts = (i.tool_name === 'str_replace' ? [t.newStr] : [t.text, t.content, t.file_text, t.newStr]).filter((v): v is string => typeof v === 'string')
  return parts.length ? parts.join('\n') : undefined
}

export interface Deps {
  now?: () => Date
}

export function run(raw: string, deps: Deps = {}): HookResult {
  const input = parseHookInput(raw)
  const path = input?.tool_input?.path
  if (!input || typeof path !== 'string') return ok()
  const root = rootOf(input)
  const rel = relative(resolve(root), resolve(root, path)).split('\\').join('/')
  if (rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith('src/') || isTestFile(rel)) return ok()
  const text = introduced(input)
  if (text === undefined) return ok()
  const found = findViolations(text)
  if (!found.length) {
    const failure = logHook(root, HOOK, rel, 'pass (no speech synthesis, handwriting font or handwriting package)', deps.now)
    return { exit: 0, stdout: '', stderr: failure ?? '' }
  }
  const stderr = [
    ...found.map((f) => {
      const r = RULES[f.kind]
      return `${HOOK}: ${rel}:${f.line}: ${f.what}. Rule (.kiro/steering/product.md, "${r.section}"): "${r.text}"`
    }),
    `${HOOK}: write refused. The writer's hand appears only as pixels from the photographed scan. Remove ${found.length === 1 ? 'this' : 'these'} and write again.`,
  ].join('\n')
  const failure = logHook(root, HOOK, rel, `blocked: ${found.map((f) => `${f.what} (line ${f.line})`).join(', ')}`, deps.now)
  return { exit: 2, stdout: '', stderr: failure ? `${stderr}\n${failure}` : stderr }
}

if (isMain(import.meta.url)) runAsMain((raw) => run(raw))
