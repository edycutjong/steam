// What a shell command writes, as far as its text shows it. One rule, used by the session ledger (tools/evidence) and by the
// shell hooks (shell-gate, src-scan). SKELETON: the state before hook-coverage H1; it sees no write.

export interface ShellTarget {
  /** Relative to the root with forward slashes, or `src/…` for a script whose path is built from parts. */
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
  /** The text the command introduces into the judged targets. */
  text: string
  /** True when some judged target's content does not appear in the command text (cp, a redirect from another command). */
  blind: boolean
}

export interface ShellOptions {
  root: string
  /** The `cwd` of the tool call, when it names one. */
  cwd?: string
}

export function analyzeShell(_command: string, _opt: ShellOptions): ShellAnalysis {
  return { parsed: true, targets: [], text: '', blind: false }
}
