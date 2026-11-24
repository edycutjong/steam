import { describe, expect, it } from 'vitest'
import { RevealClock } from './StaticPane.tsx'
import { WIPE_MS, WRITE_ON_MS } from './timeline.ts'

describe('RevealClock with the leads Cook Mode uses (R15.4)', () => {
  it('lead Infinity never starts by itself, and startReveal starts the write-on at once', () => {
    const c = new RevealClock(null, Infinity, 0)
    for (const now of [0, 3_000, 1e9]) expect(c.state(now).phase).toBe('fogged')
    c.startReveal(5_000)
    expect(c.state(5_000).phase).toBe('writing')
    expect(c.state(5_000 + WRITE_ON_MS - 1).phase).toBe('writing')
    expect(c.state(5_000 + WRITE_ON_MS).phase).toBe('holding')
  })
  it('a negative lead of -WRITE_ON_MS is holding from the first frame, and can be wiped', () => {
    const c = new RevealClock(null, -WRITE_ON_MS, 10_000)
    expect(c.state(10_000).phase).toBe('holding')
    expect(c.state(10_000).u).toBe(1)
    c.wipe(10_100)
    expect(c.state(10_100).phase).toBe('wiped')
    expect(c.state(10_100 + WIPE_MS).wipe).toBe(1)
  })
  it('a held pane ignores startReveal until it is wiped', () => {
    const c = new RevealClock(null, -WRITE_ON_MS, 0)
    c.startReveal(1_000)
    expect(c.state(1_000).phase).toBe('holding')
  })
})
