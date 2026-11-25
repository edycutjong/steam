import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildLedger, readSessions, renderMarkdown, writeLedger, type Commit, type RawSession } from './session-ledger.ts'

const WS = '/work/steam'
const PROMPT = 'PRIVATE-PROMPT write my secret plan'
const ASSISTANT = 'PRIVATE-ASSISTANT reply'
const OUTPUT = 'PRIVATE-TOOL-OUTPUT'
const SECRET_CMD = 'SECRET_COMMAND_WORD'

let n = 0
const stamp = (s: number) => new Date(Date.UTC(2026, 10, 25, 10, 0, s)).toISOString()
const call = (toolName: string, args: Record<string, unknown>, at: number, executionId = 'x1') => {
  const id = `c${++n}`
  return [
    { id: `${id}-call`, timestamp: stamp(at), payload: { type: 'tool_call', toolCallId: id, toolName, args, status: 'pending', executionId } },
    { id: `${id}-res`, timestamp: stamp(at + 2), payload: { type: 'tool_result', toolCallId: id, content: OUTPUT, success: true, executionId } },
  ]
}
const hook = (name: string, at: number, executionId = 'x1') => ({ id: `h${++n}-hook`, timestamp: stamp(at), payload: { type: 'ContextualHookInvoked', hookId: `${WS}/.kiro/hooks/${name}.json#hook-0`, name, status: 'completed', executionId } })

function session(messages: Record<string, unknown>[], over: Record<string, unknown> = {}): RawSession {
  return {
    session: { id: 'sess_a', title: 'A title', createdAt: stamp(0), lastModifiedAt: stamp(60), modelId: 'm-1', agentMode: 'vibe', workspacePaths: [WS], ...over },
    messages: [{ id: 'u', timestamp: stamp(1), payload: { type: 'user', content: PROMPT } }, { id: 'a', timestamp: stamp(2), payload: { type: 'assistant', content: ASSISTANT } }, ...messages],
  }
}

const heredoc = `cd ${WS} && cat > src/x.ts <<'E'\nexport const ${SECRET_CMD} = 1\nE`

describe('buildLedger: the shell write that no hook saw (hook-coverage H1)', () => {
  const s = session([
    ...call('execute_bash', { command: heredoc }, 10),
    ...call('execute_bash', { command: 'npm test' }, 20),
    ...call('execute_bash', { command: "cat > src/y.test.ts <<'E'\nx\nE" }, 24),
    ...call('execute_bash', { command: "echo '[]' > content/" + 'catalog' + '.json' }, 28),
    ...call('fs_write', { path: 'src/a.ts', text: 'x' }, 30),
    hook('no-imitation', 31),
    ...call('str_replace', { path: `${WS}/src/b.ts`, oldStr: 'a', newStr: 'b' }, 40),
    ...call('fs_write', { path: 'docs/a.md', text: 'x' }, 50),
    ...call('read_file', { path: 'src/a.ts' }, 52),
  ])
  const row = buildLedger([s], [], WS).sessions[0]!

  it('counts a heredoc write to src/x.ts as one shell write that no hook saw', () => {
    expect(row.shellWritesUnderSrc).toBe(2)
    expect(row.shellWritesUnderSrcNonTest).toBe(1)
    expect(row.shellWritesSeenByAHook).toBe(0)
  })
  it('counts a shell write to the catalog', () => {
    expect(row.shellWritesToCatalog).toBe(1)
  })
  it('counts tool calls by name', () => {
    expect(row.toolCalls).toEqual({ execute_bash: 4, fs_write: 2, str_replace: 1, read_file: 1 })
  })
  it('lists the paths the write tools wrote under src/ (relative, sorted, once) and counts the calls', () => {
    expect(row.writeToolPathsUnderSrc).toEqual(['src/a.ts', 'src/b.ts'])
    expect(row.writeToolCallsUnderSrc).toBe(2)
  })
  it('counts hook events by hook name and the calls that had one, by tool', () => {
    expect(row.hookInvocations).toEqual({ 'no-imitation': 1 })
    expect(row.callsWithHookEvent).toEqual({ fs_write: 1 })
  })
  it('carries id, title, times, model and mode', () => {
    expect(row).toMatchObject({ id: 'sess_a', title: 'A title', createdAt: stamp(0), lastModifiedAt: stamp(60), modelId: 'm-1', agentMode: 'vibe' })
  })
  it('a shell write with a hook event during the call counts as seen', () => {
    const seen = session([...call('execute_bash', { command: heredoc }, 10), hook('shell-gate', 11)])
    expect(buildLedger([seen], [], WS).sessions[0]).toMatchObject({ shellWritesUnderSrc: 1, shellWritesSeenByAHook: 1, callsWithHookEvent: { execute_bash: 1 } })
  })
  it('a hook event of another turn does not make a shell write seen', () => {
    const other = session([...call('execute_bash', { command: heredoc }, 10, 'x1'), hook('shell-gate', 11, 'x2')])
    expect(buildLedger([other], [], WS).sessions[0]!.shellWritesSeenByAHook).toBe(0)
  })
})

describe('buildLedger: privacy and commits', () => {
  const s = session([...call('execute_bash', { command: heredoc }, 10), ...call('fs_write', { path: 'src/a.ts', text: SECRET_CMD }, 30)], { title: 'Plain title' })
  const commits: Commit[] = [
    { hash: 'aaa1111', subject: '[kiro] spec: inside', at: stamp(30) },
    { hash: 'bbb2222', subject: '[kiro] spec: before', at: stamp(-5) },
    { hash: 'ccc3333', subject: 'not ours: inside', at: stamp(31) },
    { hash: 'ddd4444', subject: '[kiro] spec: after', at: stamp(200) },
    { hash: 'eee5555', subject: '[kiro] spec: at the end', at: stamp(60) },
  ]
  const ledger = buildLedger([s], commits, WS)

  it('copies no prompt, assistant text, tool output or command text, in the json or the markdown', () => {
    for (const out of [JSON.stringify(ledger), renderMarkdown(ledger)]) {
      for (const secret of [PROMPT, ASSISTANT, OUTPUT, SECRET_CMD, 'PRIVATE']) expect(out).not.toContain(secret)
    }
  })
  it('lists the [kiro] commits whose author time lies in the session window, ends included', () => {
    expect(ledger.sessions[0]!.commits.map((c) => c.hash)).toEqual(['aaa1111', 'eee5555'])
  })
  it('the window ends at the last message when that is later than lastModifiedAt', () => {
    const late = session([...call('fs_write', { path: 'docs/a.md', text: 'x' }, 100)], { lastModifiedAt: stamp(60) })
    expect(buildLedger([late], [{ hash: 'f', subject: '[kiro] x', at: stamp(101) }], WS).sessions[0]!.commits.map((c) => c.hash)).toEqual(['f'])
  })
  it('sorts sessions by createdAt', () => {
    const a = session([], { id: 'sess_late', createdAt: stamp(500), lastModifiedAt: stamp(510) })
    const b = session([], { id: 'sess_early', createdAt: stamp(0) })
    expect(buildLedger([a, b], [], WS).sessions.map((r) => r.id)).toEqual(['sess_early', 'sess_late'])
  })
  it('states the detection rule in the ledger and in the markdown', () => {
    expect(ledger.rule.join(' ')).toMatch(/heredoc/)
    expect(ledger.rule.join(' ')).toMatch(/ContextualHookInvoked/)
    expect(renderMarkdown(ledger)).toMatch(/## Rule/)
  })
})

describe('readSessions and writeLedger: the folder on disk', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'steam-ledger-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  const sessions = join(tmp, 'sessions')
  const s = session([...call('execute_bash', { command: heredoc }, 10)])
  mkdirSync(join(sessions, 'sess_a'), { recursive: true })
  writeFileSync(join(sessions, 'sess_a', 'session.json'), JSON.stringify(s.session))
  writeFileSync(join(sessions, 'sess_a', 'messages.jsonl'), `${s.messages.map((m) => JSON.stringify(m)).join('\n')}\nnot json at all\n`)
  mkdirSync(join(sessions, 'workflows'), { recursive: true })
  mkdirSync(join(sessions, 'sess_broken'), { recursive: true })

  it('reads sess_* folders, skips a line that is not json and a folder with no session.json', () => {
    const read = readSessions(sessions)
    expect(read.map((r) => r.session.id)).toEqual(['sess_a'])
    expect(read[0]!.messages).toHaveLength(s.messages.length)
  })
  it('writes ledger.json and ledger.md', () => {
    const out = join(tmp, 'out')
    writeLedger(out, buildLedger(readSessions(sessions), [], WS))
    expect(existsSync(join(out, 'ledger.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'ledger.json'), 'utf8')).sessions[0].shellWritesUnderSrc).toBe(1)
    expect(readFileSync(join(out, 'ledger.md'), 'utf8')).toContain('sess_a')
  })
})
