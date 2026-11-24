// transcription.md: the recorded merge hash, and what the gate does with a stale file (requirements R16.2, R16.7, R16.8,
// design 3.7 "Transcription"). Written before the implementation.
import { describe, expect, it } from 'vitest'
import { classifyTranscription, formatTranscription, mergeReadings, parseTranscription } from './merge.ts'
import { sha256Hex } from './sha256.ts'

const run = { id: 'sr-0123456789ab', stripsHash: 'a'.repeat(64) }
const reading = (...texts: string[]) => ({ segmentRun: run, lines: texts.map((text, i) => ({ i, text })) })
const m = mergeReadings(reading('a b', 'the Pareings & seeds'), reading('a b', 'the Parcings & seeds'))
const H1 = { segmentRun: run.id, readers: ['b'.repeat(64), 'c'.repeat(64)] as [string, string] }
const H2 = { segmentRun: run.id, readers: ['b'.repeat(64), 'd'.repeat(64)] as [string, string] }
const body = 'L00: a b\nL01: the †[Pareings|Parcings] & seeds\n'
const enc = (s: string) => new TextEncoder().encode(s)

describe('the recorded merge hash (R16.7)', () => {
  it('format writes the header, then a merge comment with the sha256 of the L-lines as generated, then the L-lines', () => {
    const md = formatTranscription(H1, m.lines)
    expect(md).toBe(`<!-- segmentRun: sr-0123456789ab readers: ${'b'.repeat(64)}:${'c'.repeat(64)} -->\n<!-- merge: ${sha256Hex(enc(body))} -->\n${body}`)
  })
  it('parse returns the recorded hash and the hash of the L-lines it reads', () => {
    const p = parseTranscription(formatTranscription(H1, m.lines))
    expect(p).toEqual({ ok: true, header: H1, lines: [{ i: 0, text: 'a b' }, { i: 1, text: 'the †[Pareings|Parcings] & seeds' }], merge: sha256Hex(enc(body)), bodyHash: sha256Hex(enc(body)) })
  })
  it('a revised line changes bodyHash and not the recorded hash; a file without the comment has no recorded hash', () => {
    const md = formatTranscription(H1, m.lines).replace('a b\n', 'a bee\n')
    const p = parseTranscription(md)
    if (!p.ok) throw new Error('parse')
    expect(p.merge).toBe(sha256Hex(enc(body)))
    expect(p.bodyHash).not.toBe(p.merge)
    const legacy = parseTranscription(`<!-- segmentRun: sr-0123456789ab readers: ${'b'.repeat(64)}:${'c'.repeat(64)} -->\n${body}`)
    if (!legacy.ok) throw new Error('parse')
    expect(legacy.merge).toBeUndefined()
    expect(legacy.bodyHash).toBe(sha256Hex(enc(body)))
  })
})

describe('classifyTranscription', () => {
  const fresh = (h = H1) => formatTranscription(h, m.lines)
  it('missing', () => expect(classifyTranscription(undefined, H1, fresh())).toEqual({ state: 'missing' }))
  it('current: the header names this segment run and these readers', () => {
    expect(classifyTranscription(fresh(), H1, fresh())).toEqual({ state: 'current', legacy: false })
  })
  it('current and legacy: no merge comment; equal to the fresh merge it can take the comment, otherwise it stays as it is', () => {
    const legacy = fresh().replace(/<!-- merge: [0-9a-f]+ -->\n/, '')
    expect(classifyTranscription(legacy, H1, fresh())).toEqual({ state: 'current', legacy: true, equalsFresh: true })
    expect(classifyTranscription(legacy.replace('a b\n', 'a bee\n'), H1, fresh())).toEqual({ state: 'current', legacy: true, equalsFresh: false })
  })
  it('stale and unrevised: other readers, and the L-lines hash to the recorded merge hash', () => {
    expect(classifyTranscription(fresh(H1), H2, fresh(H2))).toEqual({ state: 'stale', revised: false })
    expect(classifyTranscription(fresh(H1), { ...H1, segmentRun: 'sr-ffffffffffff' }, fresh())).toEqual({ state: 'stale', revised: false })
  })
  it('stale and revised: an L-line was changed after the generator wrote it', () => {
    const revised = fresh(H1).replace('†[Pareings|Parcings]', 'Pareings')
    expect(classifyTranscription(revised, H2, fresh(H2))).toEqual({ state: 'stale', revised: true })
  })
  it('stale and legacy: nothing proves the generator wrote it, so it counts as revised and is never overwritten', () => {
    const legacy = fresh(H1).replace(/<!-- merge: [0-9a-f]+ -->\n/, '')
    expect(classifyTranscription(legacy, H2, fresh(H2))).toEqual({ state: 'stale', revised: true })
  })
  it('malformed: no header, or a stray line', () => {
    expect(classifyTranscription('hello\n', H1, fresh())).toMatchObject({ state: 'malformed' })
    expect(classifyTranscription(fresh() + 'stray\n', H1, fresh())).toMatchObject({ state: 'malformed' })
  })
})
