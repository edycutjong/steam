import { describe, expect, it } from 'vitest'
import { FRAMES } from '../e2e/helpers/frames.ts'

describe('renderer evidence frames (R22)', () => {
  it('has the same four moments on desktop and phone', () => {
    const of = (p: string): number[] => FRAMES.filter((f) => f.name.startsWith(p)).map((f) => f.t)
    expect(of('desktop')).toEqual([-600, 2000, 4000, 6500])
    expect(of('mobile')).toEqual([-600, 2000, 4000, 6500])
    expect(FRAMES.map((f) => f.name)).toContain('mobile-t-600')
    expect(FRAMES.map((f) => f.name)).toContain('mobile-t4000')
  })
})
