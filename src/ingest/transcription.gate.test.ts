// The gate and a stale transcription.md (requirements R16.2, R16.8, R31.2, R32.8). Written before the implementation.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Gate } from '../data/schema.ts'
import { runGate, type GateCtx } from './gate.ts'
import { syntheticRecipe } from './gate.fixture.ts'
import { classifyTranscription, formatTranscription, mergeReadings, parseTranscription } from './merge.ts'
import { sha256Hex } from './sha256.ts'
import { Reading, Scribe } from '../data/schema.ts'

const rec = syntheticRecipe()
const ctx = (files: Record<string, string | undefined>): GateCtx => ({ recipeId: 'syn', pageBytes: new Uint8Array([1, 2, 3]), scan: rec.scan, files: files as GateCtx['files'] })
const enc = (s: string) => new TextEncoder().encode(s)
const sha = (s: string) => sha256Hex(enc(s))
const readers = [sha(rec.files['agent/scribe.json']!), sha(rec.files['agent/second.json']!)] as [string, string]
const fresh = formatTranscription({ segmentRun: rec.sf.lines.segmentRun.id, readers }, mergeReadings(Scribe.parse(rec.scribe), Reading.parse(rec.second)).lines)
const stale = (md: string) => md.replace(readers[1], 'e'.repeat(64))
const text = (g: ReturnType<typeof runGate>) => g.artifacts.text?.get('transcription.md')

describe('transcription.md: missing', () => {
  it('the gate writes it (as an artifact) from the current readers and passes', () => {
    const g = runGate(ctx(rec.files))
    expect(g.state).toBe('pass')
    expect(text(g)).toBe(fresh)
    expect(g.gate.inputs.transcription).toBe(sha(fresh))
  })
})

describe('transcription.md: current', () => {
  it('is used as it is and not rewritten', () => {
    const g = runGate(ctx({ ...rec.files, 'transcription.md': fresh }))
    expect(g.state).toBe('pass')
    expect(text(g)).toBeUndefined()
    expect(g.gate.inputs.transcription).toBe(sha(fresh))
  })
  it('a revision of a line is a correction, as before (R16.3)', () => {
    const g = runGate(ctx({ ...rec.files, 'transcription.md': fresh.replace('†[be|bee]', 'be') }))
    expect(g.state).toBe('pass')
    expect(g.gate.corrections).toEqual([{ line: 1, before: 'Let your quinces †[be|bee]', after: 'Let your quinces be' }])
    expect(text(g)).toBeUndefined()
  })
  it('a legacy file (no merge comment) equal to the fresh merge gets the comment added; a legacy revision is left alone', () => {
    const legacy = fresh.replace(/<!-- merge: [0-9a-f]+ -->\n/, '')
    const g = runGate(ctx({ ...rec.files, 'transcription.md': legacy }))
    expect(g.state).toBe('pass')
    expect(text(g)).toBe(fresh)
    const rev = runGate(ctx({ ...rec.files, 'transcription.md': legacy.replace('†[be|bee]', 'be') }))
    expect(rev.state).toBe('pass')
    expect(text(rev)).toBeUndefined()
  })
})

describe('transcription.md: stale (readers changed underneath it)', () => {
  it('unrevised: regenerated from the current readers, the gate goes on and passes, never waiting', () => {
    const g = runGate(ctx({ ...rec.files, 'transcription.md': stale(fresh) }))
    expect(g.state).toBe('pass')
    expect(g.gate.waiting).toBeUndefined()
    expect(text(g)).toBe(fresh)
    expect(g.gate.inputs.transcription).toBe(sha(fresh))
  })
  it('stale because of another segment run: the same', () => {
    const g = runGate(ctx({ ...rec.files, 'transcription.md': fresh.replace(rec.sf.lines.segmentRun.id, 'sr-ffffffffffff') }))
    expect(g.state).toBe('pass')
    expect(text(g)).toBe(fresh)
  })
  it('revised: a terminal fail "transcription.md was revised against an older reading: re-review", file untouched', () => {
    const g = runGate(ctx({ ...rec.files, 'transcription.md': stale(fresh).replace('†[be|bee]', 'bee') }))
    expect(g.state).toBe('fail')
    expect(g.gate.errors).toEqual(['transcription.md was revised against an older reading: re-review'])
    expect(text(g)).toBeUndefined()
    expect(Gate.safeParse({ ...g.gate, at: 'x' }).success).toBe(true)
  })
  it('legacy and stale: counts as revised, a terminal fail', () => {
    const g = runGate(ctx({ ...rec.files, 'transcription.md': stale(fresh).replace(/<!-- merge: [0-9a-f]+ -->\n/, '') }))
    expect(g.state).toBe('fail')
    expect(g.gate.errors![0]).toMatch(/revised against an older reading: re-review/)
  })
  it('malformed: a fail with the parse error, as before', () => {
    const g = runGate(ctx({ ...rec.files, 'transcription.md': 'hello\n' }))
    expect(g.state).toBe('fail')
    expect(g.gate.errors![0]).toMatch(/header missing or malformed/)
  })
})

describe('timeout safety (R32.8): both readers current means never waiting, whatever transcription.md holds', () => {
  const variants: [string, (md: string) => string | undefined][] = [
    ['missing', () => undefined],
    ['current', (md) => md],
    ['current legacy', (md) => md.replace(/<!-- merge: [0-9a-f]+ -->\n/, '')],
    ['current revised', (md) => md.replace('†[be|bee]', 'be')],
    ['stale unrevised', stale],
    ['stale revised', (md) => stale(md).replace('†[be|bee]', 'be')],
    ['stale legacy', (md) => stale(md).replace(/<!-- merge: [0-9a-f]+ -->\n/, '')],
    ['other segment run', (md) => md.replace(rec.sf.lines.segmentRun.id, 'sr-000000000000')],
    ['malformed', () => 'nonsense'],
    ['empty', () => ''],
    ['line structure changed', (md) => md + 'L99: extra\n'],
  ]
  for (const [name, f] of variants)
    it(`${name}`, () => {
      const g = runGate(ctx({ ...rec.files, 'transcription.md': f(fresh) }))
      expect(g.state).not.toBe('waiting')
      expect(g.gate.waiting).toBeUndefined()
    })
  it('for random edits of the file', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: fresh.length }), fc.string({ maxLength: 12 }), fc.boolean(), (at, ins, doStale) => {
        const md = (doStale ? stale(fresh) : fresh).slice(0, at) + ins + (doStale ? stale(fresh) : fresh).slice(at)
        expect(runGate(ctx({ ...rec.files, 'transcription.md': md })).state).not.toBe('waiting')
      }),
      { numRuns: 20 },
    )
  }, 30_000)
  it('a reader file that is missing or stale still waits (that is what waiting is for)', () => {
    expect(runGate(ctx({ ...rec.files, 'agent/second.json': undefined })).state).toBe('waiting')
  })
})

describe('consistency of the helpers', () => {
  it('classify of the generated text against itself is current', () => {
    expect(classifyTranscription(fresh, { segmentRun: rec.sf.lines.segmentRun.id, readers }, fresh).state).toBe('current')
    expect(parseTranscription(fresh).ok).toBe(true)
  })
})
