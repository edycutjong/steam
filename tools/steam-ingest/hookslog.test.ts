import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { appendHookLine, formatHookLine, whoOf } from './hookslog.ts'

const dir = mkdtempSync(join(tmpdir(), 'steam-log-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('hooks.log (R33)', () => {
  it('formats one line with U+00B7 separators and no newline inside the detail', () => {
    const l = formatHookLine(new Date('2026-11-25T01:02:03.004Z'), 'cli', 'quinces-marmalade', 'fail', 'P3: joined strokes\nneeds review')
    expect(l).toBe('2026-11-25T01:02:03.004Z · cli · quinces-marmalade · fail P3: joined strokes needs review\n')
    expect(l.split('\u00b7').length).toBe(4)
  })
  it('who: $STEAM_WHO, then --who, then cli; watch in --once mode only when nothing else is set', () => {
    expect(whoOf({ env: 'kiro-hook', flag: 'me', once: true })).toBe('kiro-hook')
    expect(whoOf({ flag: 'me', once: true })).toBe('me')
    expect(whoOf({})).toBe('cli')
    expect(whoOf({ once: true })).toBe('watch')
    expect(whoOf({ env: '' })).toBe('cli')
  })
  it('creates the folder, appends exactly one line per call, never truncates', () => {
    const p = join(dir, 'docs', 'kiro-evidence', 'hooks.log')
    appendHookLine(p, 'a · b · c · pass x\n')
    appendHookLine(p, 'd · e · f · waiting y\n')
    expect(readFileSync(p, 'utf8')).toBe('a · b · c · pass x\nd · e · f · waiting y\n')
    writeFileSync(p, 'kept\n', { flag: 'a' })
    appendHookLine(p, 'g · h · i · fail z\n')
    expect(readFileSync(p, 'utf8').split('\n').filter(Boolean).length).toBe(4)
  })
  it('throws when the append fails', () => {
    const ro = join(dir, 'ro')
    writeFileSync(ro, '')
    chmodSync(ro, 0o444)
    expect(() => appendHookLine(ro, 'x\n')).toThrow()
    expect(() => appendHookLine(join(ro, 'below', 'x.log'), 'x\n')).toThrow()
  })
  it('refuses a line that is not exactly one line', () => {
    expect(() => appendHookLine(join(dir, 'y.log'), 'a\nb\n')).toThrow(/one line/)
  })
})
