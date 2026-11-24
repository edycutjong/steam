import { describe, expect, it } from 'vitest'
import { dedupe, DRAG_MIN_PX, dragThreshold, dragWipe, type Sample } from './drag.ts'

const line = (px: number, ms: number, n = 10, y = 0): Sample[] => Array.from({ length: n + 1 }, (_, i) => ({ x: (px * i) / n, y, t: (ms * i) / n }))

describe('dragWipe (R14.4, R14.6)', () => {
  it('a 95 px path does not fire, 96 px of a pane at least 384 px wide fires once', () => {
    expect(DRAG_MIN_PX).toBe(96)
    expect(dragWipe(line(95, 500), 384)).toBeNull()
    expect(dragWipe(line(96, 500), 384)).toBe(10)
    expect(dragWipe(line(96, 500), 500)).toBeNull() // 25% of 500 is 125
  })
  it('a 300 px pane needs 96 px (25% is 75 px, the larger bound wins); a 1 000 px pane needs 250 px', () => {
    expect(dragThreshold(300)).toBe(96)
    expect(dragWipe(line(80, 500), 300)).toBeNull()
    expect(dragWipe(line(96, 500), 300)).not.toBeNull()
    expect(dragThreshold(1000)).toBe(250)
    expect(dragWipe(line(249, 500), 1000)).toBeNull()
    expect(dragWipe(line(250, 500), 1000)).not.toBeNull()
  })
  it('fires at the first sample that meets the bound, not at the end', () => {
    expect(dragWipe(line(400, 500, 40), 400)).toBe(10)
  })
  it('a path that takes over 2 s does not fire; exactly 2 s does', () => {
    expect(dragWipe(line(100, 2001), 400)).toBeNull() // the 100 px are reached only at the last sample, 2 001 ms in
    expect(dragWipe(line(100, 2000), 400)).not.toBeNull()
  })
  it('a tap (one sample) does not fire', () => expect(dragWipe([{ x: 5, y: 5, t: 0 }], 400)).toBeNull())
  it('a vertical drag of 400 px with no horizontal travel does not fire', () => {
    const v: Sample[] = Array.from({ length: 11 }, (_, i) => ({ x: 50, y: 40 * i, t: i * 50 }))
    expect(dragWipe(v, 400)).toBeNull()
  })
  it('back-and-forth movement counts its summed horizontal steps', () => {
    const z: Sample[] = [0, 50, 0, 50, 0, 50].map((x, i) => ({ x, y: 0, t: i * 100 }))
    expect(dragWipe(z, 400)).toBe(2) // 50 + 50 = 100 >= 96 at the third sample
  })
})

describe('dedupe (R14.6)', () => {
  it('collapses fires closer than 400 ms to the first', () => {
    expect(dedupe([0, 100, 399, 400, 801, 1300])).toEqual([0, 400, 801, 1300])
    expect(dedupe([])).toEqual([])
  })
})
