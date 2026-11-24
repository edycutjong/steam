// S7: for generated gate inputs, a second gate run gives the same gate.json bytes (ignoring at) and rewrites nothing.
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { gateCmd } from './gate.ts'
import { syntheticFolder } from './gate.fixture.ts'

const f = syntheticFolder()
afterAll(() => rmSync(f.root, { recursive: true, force: true }))
const swaps = ['bee', 'rype,', 'tyll', 'Lookes', 'smoth,']

describe('S7 the gate is idempotent', () => {
  it('for random second readings, note choices and review-free inputs', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 4 })), { maxLength: 3 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 1 }),
        (edits, dropNote, firstWord) => {
          const second = structuredClone(f.second)
          for (const [line, word, sw] of edits) {
            const t = second.lines[line]!.text.split(' ')
            if (word < t.length) t[word] = swaps[sw]!
            second.lines[line]!.text = t.join(' ')
          }
          const scribe = structuredClone(f.scribe)
          if (dropNote) scribe.notes = scribe.notes.slice(1)
          else scribe.notes[0] = { ...scribe.notes[0]!, span: firstWord ? 'ripe,' : 'full ripe,', quote: [{ line: 2, fromWord: firstWord, toWord: 1 }] }
          writeFileSync(join(f.dir, 'agent/second.json'), canonicalJson(second))
          writeFileSync(join(f.dir, 'agent/scribe.json'), canonicalJson(scribe))
          const a = gateCmd(f.id, { root: f.root, now: () => new Date('2026-11-25T00:00:00.000Z'), noLog: true })
          const bytes = readFileSync(join(f.dir, 'gate.json'))
          const mtimes = Object.keys(a.gate.outputs).sort().map((rel) => statSync(join(f.dir, rel)).mtimeMs)
          const b = gateCmd(f.id, { root: f.root, now: () => new Date('2026-11-26T00:00:00.000Z'), noLog: true })
          expect(b.notes).toEqual([])
          expect(b.changed).toBe(false)
          expect(readFileSync(join(f.dir, 'gate.json')).equals(bytes)).toBe(true)
          expect(Object.keys(b.gate.outputs).sort().map((rel) => statSync(join(f.dir, rel)).mtimeMs)).toEqual(mtimes)
          expect(b.state).toBe(a.state)
        },
      ),
      { numRuns: 4 },
    )
  })
})
