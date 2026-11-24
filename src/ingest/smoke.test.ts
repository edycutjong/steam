import { describe, expect, it } from 'vitest'
import * as C from './constants.ts'

describe('ingest smoke', () => {
  it('imports constants.ts', () => {
    expect(typeof C.SPLIT_SHARE_MAX).toBe('number')
  })
  it('freezes the gate thresholds (R39.5)', () => {
    expect(C.SPLIT_SHARE_MAX).toBe(0.02)
    expect(C.RUN_MIN_PX).toBe(4)
    expect(C.RUN_RATIO).toBe(1.5)
    expect(C.CONTRAST_MIN).toBe(40)
    expect(C.PATH_COVERAGE_MIN).toBe(0.95)
    expect(C.MIN_COMPONENT_PX).toBe(30)
  })
  it('every constant in the table has a reason and a source', () => {
    for (const row of C.CONSTANTS_TABLE) {
      expect(row.reason.length, row.name).toBeGreaterThan(5)
      expect(row.source.length, row.name).toBeGreaterThan(2)
      expect(row.frozenBy, row.name).toMatch(/^[0-9a-f]{7}$/)
    }
  })
  it('the table values equal the exports', () => {
    const exp = C as unknown as Record<string, unknown>
    for (const row of C.CONSTANTS_TABLE) expect(JSON.stringify(exp[row.name]), row.name).toBe(JSON.stringify(row.value))
  })
  it('the licence allow-list is exactly pdm, cc0, cc-by', () => {
    expect([...C.LICENCE_ALLOW]).toEqual(['pdm', 'cc0', 'cc-by'])
  })
})
