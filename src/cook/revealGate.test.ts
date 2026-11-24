import { describe, expect, it } from 'vitest'
import { createRevealGate } from './revealGate.ts'

const mk = () => {
  const applied: string[] = []
  const gate = createRevealGate<{ noteId: string; n?: number }>((e) => applied.push(e.noteId + (e.n ?? '')))
  return { applied, gate }
}

describe('createRevealGate (R15.7, R12.8)', () => {
  it('an effect enqueued before its pane is ready waits and applies once on setReady', () => {
    const { applied, gate } = mk()
    gate.enqueue({ noteId: 'a' })
    expect(applied).toEqual([])
    gate.setReady('a')
    expect(applied).toEqual(['a'])
  })
  it('an effect enqueued while blocked waits for setBlocked(false)', () => {
    const { applied, gate } = mk()
    gate.setReady('a')
    gate.setBlocked(true)
    gate.enqueue({ noteId: 'a' })
    expect(applied).toEqual([])
    gate.setBlocked(false)
    expect(applied).toEqual(['a'])
  })
  it('an effect is applied at once when the pane is ready and nothing blocks', () => {
    const { applied, gate } = mk()
    gate.setReady('a')
    gate.enqueue({ noteId: 'a' })
    expect(applied).toEqual(['a'])
  })
  it('two effects apply in order', () => {
    const { applied, gate } = mk()
    gate.enqueue({ noteId: 'a', n: 1 })
    gate.enqueue({ noteId: 'b', n: 2 })
    gate.setReady('b')
    expect(applied).toEqual([]) // a is first in line and its pane is not the ready one
    gate.setReady('a')
    gate.setReady('b')
    expect(applied).toEqual(['a1', 'b2'])
  })
  it('setReady(null) holds new effects', () => {
    const { applied, gate } = mk()
    gate.setReady('a')
    gate.setReady(null)
    gate.enqueue({ noteId: 'a' })
    expect(applied).toEqual([])
    expect(gate.pending.length).toBe(1)
  })
  it('a second setReady for the same note does not re-apply', () => {
    const { applied, gate } = mk()
    gate.enqueue({ noteId: 'a' })
    gate.setReady('a')
    gate.setReady('a')
    gate.setBlocked(true)
    gate.setBlocked(false)
    expect(applied).toEqual(['a'])
  })
  it('drop removes the effects of a pane that cannot load and lets the ones behind it through', () => {
    const { applied, gate } = mk()
    gate.enqueue({ noteId: 'a' })
    gate.enqueue({ noteId: 'b' })
    gate.setReady('b')
    expect(gate.drop('a').length).toBe(1)
    expect(applied).toEqual(['b'])
  })
})
