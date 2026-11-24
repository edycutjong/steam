import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { hooksLogFile } from './lib.ts'
import { pipeToScript, postTask } from './recorded.ts'
import { COMMAND, defaultExec, parseCounts, run } from './tests-after-task.ts'

const roots: string[] = []
const fresh = () => {
  const r = mkdtempSync(join(tmpdir(), 'steam-task-'))
  roots.push(r)
  return r
}
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))
const lines = (root: string) => (existsSync(hooksLogFile(root)) ? readFileSync(hooksLogFile(root), 'utf8').split('\n').filter(Boolean) : [])
const hookJson = JSON.parse(readFileSync(join(import.meta.dirname, '../../.kiro/hooks/tests-after-task.json'), 'utf8'))

// closing lines recorded from `npm test -- --reporter=dot` (vitest 5.1.1) on this repository
const GREEN = '\n Test Files  74 passed (74)\n      Tests  494 passed | 5 expected fail (499)\n   Start at  03:04:10\n   Duration  15.93s\n'
const RED = '\n Test Files  1 failed | 73 passed (74)\n      Tests  2 failed | 492 passed | 5 expected fail (499)\n'

describe('tests-after-task: the hook file', () => {
  it('is a v1 PostTaskExec hook that runs the script; the script runs `npm test -- --reporter=dot`', () => {
    expect(hookJson.version).toBe('v1')
    expect(hookJson.hooks).toHaveLength(1)
    expect(hookJson.hooks[0]).toMatchObject({ trigger: 'PostTaskExec', enabled: true, action: { type: 'command', command: 'npx tsx tools/hooks/tests-after-task.ts' } })
    expect(COMMAND).toBe('npm test -- --reporter=dot')
  })
})

describe('tests-after-task: parseCounts', () => {
  it('reads a green and a red vitest summary, with colours', () => {
    expect(parseCounts(GREEN)).toEqual({ tests: { passed: 494, failed: 0, other: ['5 expected fail'] }, files: { passed: 74, failed: 0 } })
    expect(parseCounts(RED)).toEqual({ tests: { passed: 492, failed: 2, other: ['5 expected fail'] }, files: { passed: 73, failed: 1 } })
    expect(parseCounts(GREEN.replace(/(\d+ passed)/g, '\u001b[32m$1\u001b[39m'))?.tests.passed).toBe(494)
  })
  it('returns undefined without a summary', () => {
    expect(parseCounts('npm ERR! missing script: test')).toBeUndefined()
    expect(parseCounts('')).toBeUndefined()
  })
})

describe('tests-after-task: a recorded PostTaskExec document', () => {
  it('green: exit 0, one "pass" line with the counts', () => {
    const root = fresh()
    const r = run(postTask(root), { exec: () => ({ status: 0, output: GREEN }), now: () => new Date('2026-11-25T14:00:00.000Z') })
    expect(r.exit).toBe(0)
    expect(r.stdout).toBe('tests-after-task: pass 494 passed, 0 failed, 5 expected fail · files 74 passed, 0 failed · exit 0')
    expect(lines(root)).toEqual(['2026-11-25T14:00:00.000Z · tests-after-task · npm test -- --reporter=dot · pass 494 passed, 0 failed, 5 expected fail · files 74 passed, 0 failed · exit 0'])
  })
  it('red: exit 1 (a warning, the task is not undone), one "fail" line with the counts, the tail of the output on stderr', () => {
    const root = fresh()
    const r = run(postTask(root), { exec: () => ({ status: 1, output: `FAIL src/a.test.ts\n${RED}` }), now: () => new Date('2026-11-25T14:01:00.000Z') })
    expect(r.exit).toBe(1)
    expect(r.stderr).toContain('FAIL src/a.test.ts')
    expect(lines(root)).toEqual(['2026-11-25T14:01:00.000Z · tests-after-task · npm test -- --reporter=dot · fail 492 passed, 2 failed, 5 expected fail · files 73 passed, 1 failed · exit 1'])
  })
  it('no summary at all (the command did not run): logs "error" and exits 1; a clean exit with failures in the counts is still "fail"', () => {
    const root = fresh()
    expect(run(postTask(root), { exec: () => ({ status: 254, output: 'npm ERR! missing script: test' }) }).exit).toBe(1)
    expect(lines(root)[0]).toMatch(/ · error exit 254, no vitest summary in the output$/)
    expect(run(postTask(root), { exec: () => ({ status: 0, output: RED }) }).exit).toBe(1)
  })
  it('the default command is `npm test -- --reporter=dot` unless STEAM_HOOK_TEST_CMD says otherwise', () => {
    const r = defaultExec(fresh(), { STEAM_HOOK_TEST_CMD: "printf 'Test Files  1 passed (1)\\n Tests  3 passed (3)\\n'" })
    expect(r.status).toBe(0)
    expect(parseCounts(r.output)?.tests.passed).toBe(3)
  })
  it('stdin that is not JSON does nothing', () => {
    expect(run('nope', { exec: () => { throw new Error('must not run') } })).toEqual({ exit: 0, stdout: '', stderr: '' })
  })
})

describe('tests-after-task: the script as Kiro would start it', () => {
  it('npx tsx tools/hooks/tests-after-task.ts with a recorded PostTaskExec on stdin runs the command in cwd and logs the counts', () => {
    const root = fresh()
    const r = pipeToScript('tools/hooks/tests-after-task.ts', postTask(root), { STEAM_HOOK_TEST_CMD: "printf ' Test Files  2 passed (2)\\n      Tests  7 passed (7)\\n'" })
    expect(r.exit).toBe(0)
    expect(lines(root)).toHaveLength(1)
    expect(lines(root)[0]).toMatch(/ · tests-after-task · npm test -- --reporter=dot · pass 7 passed, 0 failed · files 2 passed, 0 failed · exit 0$/)
  }, 60_000)
})
