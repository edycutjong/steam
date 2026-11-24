import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NoteMeta } from './assets.ts'

const real = JSON.parse(
  readFileSync(new URL('../../public/hero/note-looks-red-smooth.json', import.meta.url), 'utf8'),
)

const good = () => structuredClone(real) as Record<string, any>

function failPath(input: unknown): string {
  const r = NoteMeta.safeParse(input)
  expect(r.success).toBe(false)
  return r.success ? '' : r.error.issues.map((i) => i.path.join('.')).join('|')
}

describe('NoteMeta', () => {
  it('accepts the real hero file and strips spike keys', () => {
    const r = NoteMeta.safeParse(real)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.groups).toHaveLength(2)
      expect('p3' in r.data).toBe(false)
      expect('splitDetail' in r.data).toBe(false)
    }
  })
  it('rejects missing groups', () => {
    const m = good()
    delete m.groups
    expect(failPath(m)).toContain('groups')
  })
  it('rejects empty groups', () => {
    const m = good()
    m.groups = []
    expect(failPath(m)).toContain('groups')
  })
  it('rejects a wrong size type', () => {
    const m = good()
    m.size = ['1251', 177]
    expect(failPath(m)).toContain('size')
  })
  it('rejects a rect outside size', () => {
    const m = good()
    m.groups[0].rect = [781, 32, 1300, 93]
    expect(failPath(m)).toBe('groups.0.rect')
  })
  it('rejects a coreBand outside the rect', () => {
    const m = good()
    m.groups[1].coreBand = [109, 160]
    expect(failPath(m)).toBe('groups.1.coreBand')
  })
  it('rejects a reversed t', () => {
    const m = good()
    m.groups[0].t = [0.6, 0.4]
    expect(failPath(m)).toContain('groups.0.t')
  })
  it('rejects t above 1', () => {
    const m = good()
    m.groups[1].t = [0.485, 1.2]
    expect(failPath(m)).toContain('groups.1.t')
  })
  it('rejects overlapping group ranges', () => {
    const m = good()
    m.groups[1].t = [0.3, 1]
    expect(failPath(m)).toBe('groups.1.t')
  })
})
