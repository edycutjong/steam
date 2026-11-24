import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createRevealGate } from './revealGate.ts'

// K7 (design 13): the reveal gate.
type Op = { k: 'enqueue'; note: string } | { k: 'ready'; note: string | null } | { k: 'blocked'; b: boolean }
const note = fc.constantFrom('a', 'b', 'c')
const ops = fc.array(fc.oneof(note.map<Op>((n) => ({ k: 'enqueue', note: n })), fc.option(note, { nil: null }).map<Op>((n) => ({ k: 'ready', note: n })), fc.boolean().map<Op>((b) => ({ k: 'blocked', b }))), { maxLength: 40 })

describe('K7: the reveal gate', () => {
  it('each effect applies at most once, in enqueue order, and only when its pane is ready and nothing blocks', () => {
    fc.assert(
      fc.property(ops, (list) => {
        const applied: { noteId: string; id: number }[] = []
        let ready: string | null = null
        let blocked = false
        const gate = createRevealGate<{ noteId: string; id: number }>((e) => {
          expect(blocked).toBe(false)
          expect(e.noteId).toBe(ready)
          applied.push(e)
        })
        let id = 0
        const all: { noteId: string; id: number }[] = []
        for (const o of list) {
          if (o.k === 'enqueue') {
            const e = { noteId: o.note, id: id++ }
            all.push(e)
            gate.enqueue(e)
          } else if (o.k === 'ready') {
            ready = o.note
            gate.setReady(o.note)
          } else {
            blocked = o.b
            gate.setBlocked(o.b)
          }
        }
        const ids = applied.map((e) => e.id)
        expect(new Set(ids).size).toBe(ids.length)
        expect(ids).toEqual([...ids].sort((x, y) => x - y))
        // what has not been applied is still pending, in order
        expect([...ids, ...gate.pending.map((e) => e.id)].sort((x, y) => x - y)).toEqual(all.map((e) => e.id))
      }),
      { numRuns: 1000 },
    )
  })
  it('after the last setReady(note) and setBlocked(false), every enqueued effect of the head-of-line notes has been applied exactly once', () => {
    fc.assert(
      fc.property(fc.array(note, { maxLength: 15 }), (notes) => {
        const applied: string[] = []
        const gate = createRevealGate<{ noteId: string }>((e) => applied.push(e.noteId))
        gate.setBlocked(true)
        for (const n of notes) gate.enqueue({ noteId: n })
        // the panes become ready one after another, in the order the effects were enqueued
        gate.setBlocked(false)
        for (const n of notes) gate.setReady(n)
        gate.setReady(null)
        expect(applied).toEqual(notes)
        expect(gate.pending.length).toBe(0)
      }),
      { numRuns: 500 },
    )
  })
})
