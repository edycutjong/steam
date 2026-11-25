// The session ledger: which tool wrote what, per Kiro session of this workspace. SKELETON: the state before hook-coverage H1.

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
  shellWritesSeenByAHook: number
  writeToolCallsUnderSrc: number
  writeToolPathsUnderSrc: string[]
  callsWithHookEvent: Record<string, number>
  hookInvocations: Record<string, number>
  commits: Commit[]
}

export interface Ledger {
  workspace: string
  rule: string[]
  sessions: SessionRow[]
}

export interface RawSession {
  session: Record<string, unknown>
  messages: Record<string, unknown>[]
}

export function buildLedger(_sessions: RawSession[], _commits: Commit[], workspace: string): Ledger {
  return { workspace, rule: [], sessions: [] }
}

export function readSessions(_dir: string): RawSession[] {
  return []
}

export function renderMarkdown(_ledger: Ledger): string {
  return ''
}

export function writeLedger(_outDir: string, _ledger: Ledger): void {}
