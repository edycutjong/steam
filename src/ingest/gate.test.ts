import { describe, expect, it } from 'vitest'
import { Gate } from '../data/schema.ts'
import { canonicalJson } from './canon.ts'
import { runGate, type GateCtx } from './gate.ts'
import { SYN_WORDS, syntheticRecipe } from './gate.fixture.ts'

const rec = syntheticRecipe()
const ctx = (files: Record<string, string | undefined>, extra: Partial<GateCtx> = {}): GateCtx => ({
  recipeId: 'syn',
  pageBytes: new Uint8Array([1, 2, 3]),
  scan: rec.scan,
  files: files as GateCtx['files'],
  ...extra,
})
const withScribe = (patch: (s: typeof rec.scribe) => unknown) => ({ ...rec.files, 'agent/scribe.json': canonicalJson(patch(structuredClone(rec.scribe))) })
const at = (g: ReturnType<typeof runGate>) => Gate.parse({ ...g.gate, at: '2026-11-25T00:00:00.000Z' })

describe('runGate states', () => {
  it('passes a clean synthetic recipe, keeps the disagreement, and the gate.json validates', () => {
    const g = runGate(ctx(rec.files))
    expect(g.state).toBe('pass')
    expect(g.gate.pass).toBe(true)
    expect(g.gate.readers).toEqual(['scribe', 'second-reader'])
    expect(g.gate.disagreements).toBe(1)
    const merged = g.artifacts.json.get('merged.json') as { disagreements: unknown[] }
    expect(merged.disagreements).toEqual([{ line: 1, word: 3, a: 'be', b: 'bee' }])
    expect(at(g).state).toBe('pass')
    expect(Object.keys(g.gate.outputs).sort()).toEqual([
      'notes/note-full-ripe.json', 'notes/note-full-ripe.png', 'notes/note-full-ripe.toi.png',
      'notes/note-till-smooth.json', 'notes/note-till-smooth.png', 'notes/note-till-smooth.toi.png',
    ])
    expect(g.gate.ownership).toEqual({ autoPass: 2, reviewedPass: 0 })
    expect(g.logDetail).toMatch(/^P1-P6 ok/)
  })
  it('waits for a missing reader file', () => {
    const g = runGate(ctx({ ...rec.files, 'agent/second.json': undefined }))
    expect(g.state).toBe('waiting')
    expect(g.gate.waiting).toEqual(['missing: agent/second.json'])
    expect(at(g).pass).toBe(false)
  })
  it('waits for a stale reader file', () => {
    const g = runGate(ctx(withScribe((s) => ({ ...s, segmentRun: { ...s.segmentRun, id: 'sr-000000000000' } }))))
    expect(g.state).toBe('waiting')
    expect(g.gate.waiting).toEqual(['stale reading: agent/scribe.json'])
  })
  it('fails an invalid reader file with the zod issues, and a reader with a pixel box', () => {
    const g = runGate(ctx({ ...rec.files, 'agent/second.json': '{"segmentRun": 1' }))
    expect(g.state).toBe('fail')
    expect(g.gate.errors![0]).toMatch(/agent\/second.json: not JSON/)
    const b = runGate(ctx(withScribe((s) => ({ ...s, notes: [{ ...s.notes[0], box: [1, 2, 3, 4] }] }))))
    expect(b.state).toBe('fail')
    expect(b.gate.errors![0]).toMatch(/Unrecognized key/)
  })
  it('fails a reader line count that differs from lines.json', () => {
    const g = runGate(ctx(withScribe((s) => ({ ...s, lines: s.lines.slice(0, 4) }))))
    expect(g.state).toBe('fail')
    expect(g.gate.errors![0]).toMatch(/4 lines, lines.json has 5/)
  })
  it('fails a wrong titleLine', () => {
    const g = runGate(ctx(withScribe((s) => ({ ...s, titleLine: 1 }))))
    expect(g.gate.errors![0]).toMatch(/title does not equal line 1 verbatim/)
  })
  it('fails a span that is not a quotation', () => {
    const g = runGate(ctx(withScribe((s) => ({ ...s, notes: [{ ...s.notes[0]!, span: 'full ripes' }] }))))
    expect(g.state).toBe('fail')
    expect(g.gate.errors!.join()).toMatch(/full-ripe: span is not a quotation/)
  })
  it('fails a note over the split threshold without a review, naming the components', () => {
    const j = syntheticRecipe({ joined: true })
    const g = runGate({ recipeId: 'syn', pageBytes: new Uint8Array([1]), scan: j.scan, files: j.files as GateCtx['files'] })
    expect(g.state).toBe('fail')
    expect(g.gate.results!.P3.pass).toBe(false)
    expect(g.gate.results!.P3.detail).toMatch(/^joined strokes: needs review \(till-smooth: split share 0\.\d{4} over 0\.02, components \d+/)
    const note = g.gate.splits!.notes.find((n) => n.noteId === 'till-smooth')!
    expect(note.status).toBe('failed')
    expect(note.flagged.length).toBe(1)
    expect(g.artifacts.png.has(`ownership/flag-${note.flagged[0]}.png`)).toBe(true)
    expect(g.firstFailure).toMatch(/^P3: joined strokes/)
  })
  it('fails a lines.json that the page does not reproduce', () => {
    const lj = JSON.parse(rec.files['lines.json']!)
    lj.lines[0].peakRow += 1
    const g = runGate(ctx({ ...rec.files, 'lines.json': canonicalJson(lj) }))
    expect(g.state).toBe('fail')
    expect(g.gate.errors![0]).toMatch(/lines.json does not match/)
  })
})

describe('runGate details', () => {
  it('goldCheck is informational only: a different gold reading changes no verdict', () => {
    const gold = JSON.stringify({ title: 'To make', lines: SYN_WORDS.slice(1).map((w, i) => ({ text: i === 0 ? 'Let your quinces bee' : w.join(' ') })) })
    const g = runGate(ctx(rec.files, { gold }))
    expect(g.gate.goldCheck).toEqual({ informational: true, equal: 3, of: 4, differing: [1] })
    expect(g.state).toBe('pass')
  })
  it('hashes every input and is deterministic', () => {
    const a = runGate(ctx(rec.files))
    const b = runGate(ctx(rec.files))
    expect(canonicalJson(a.gate)).toBe(canonicalJson(b.gate))
    expect(Object.keys(a.gate.inputs).sort()).toEqual(['lines', 'page', 'scribe', 'second'])
  })
  it('the fallback reader is used when both agent files are absent', () => {
    const fb = { ...rec.scribe, readers: ['fallback'], by: 'test', source: 'fixtures/gold-readings.json', sourceSha256: 'a'.repeat(64) }
    const g = runGate(ctx({ 'source.json': rec.files['source.json'], 'lines.json': rec.files['lines.json'], 'fallback/reading.json': canonicalJson(fb) }))
    expect(g.state).toBe('pass')
    expect(g.gate.readers).toEqual(['fallback'])
    expect(Object.keys(g.gate.inputs).sort()).toEqual(['fallback', 'lines', 'page'])
    expect(g.gate.disagreements).toBe(0)
  })
})
