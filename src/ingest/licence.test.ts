import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveLicence } from './licence.ts'

const work = (): any => JSON.parse(readFileSync(new URL('../../fixtures/wellcome-work-zgtk6n7e.json', import.meta.url), 'utf8'))
const loc = (w: any) => w.items[1].locations[0]

describe('resolveLicence (R3)', () => {
  it('reads pdm from the iiif-presentation location of the recorded work', () => {
    const r = resolveLicence(work())
    expect(r).toEqual({
      ok: true,
      id: 'pdm',
      label: 'Public Domain Mark',
      url: 'https://creativecommons.org/share-your-work/public-domain/pdm/',
      manifest: 'https://iiif.wellcomecollection.org/presentation/v2/b18419665',
    })
  })
  it('refuses an in-copyright licence', () => {
    const w = work()
    loc(w).license = { id: 'in-copyright', label: 'In copyright', url: 'x' }
    const r = resolveLicence(w)
    expect(r.ok).toBe(false)
    expect((r as any).reason).toMatch(/in-copyright/)
  })
  it('refuses when the iiif-presentation location is removed (the thumbnail licence does not count)', () => {
    const w = work()
    w.items[1].locations = []
    expect(resolveLicence(w).ok).toBe(false)
  })
  it('refuses when the location has no licence', () => {
    const w = work()
    delete loc(w).license
    expect(resolveLicence(w).ok).toBe(false)
    loc(w).license = {}
    expect(resolveLicence(w).ok).toBe(false)
  })
  it('refuses two iiif-presentation locations with different licences, accepts two with the same', () => {
    const w = work()
    const second = JSON.parse(JSON.stringify(loc(w)))
    second.license.id = 'cc-by'
    w.items[1].locations.push(second)
    expect(resolveLicence(w).ok).toBe(false)
    second.license.id = 'pdm'
    expect(resolveLicence(w).ok).toBe(true)
  })
  it('refuses the wrong location type', () => {
    const w = work()
    loc(w).locationType.id = 'thumbnail-image'
    expect(resolveLicence(w).ok).toBe(false)
  })
  it('refuses a top-level licence with no location', () => {
    const w = work()
    w.items = []
    w.license = { id: 'pdm', label: 'Public Domain Mark', url: 'x' }
    expect(resolveLicence(w).ok).toBe(false)
    const w2 = work()
    w2.license = { id: 'pdm' }
    w2.items[1].locations = []
    expect(resolveLicence(w2).ok).toBe(false)
  })
  it('refuses non-objects and a record without items', () => {
    for (const bad of [null, 5, 'x', [], {}, { items: 'no' }]) expect(resolveLicence(bad).ok, JSON.stringify(bad)).toBe(false)
  })
  it('accepts cc0 and cc-by, refuses cc-by-nc', () => {
    for (const [id, ok] of [['cc0', true], ['cc-by', true], ['cc-by-nc', false]] as const) {
      const w = work()
      loc(w).license.id = id
      expect(resolveLicence(w).ok, id).toBe(ok)
    }
  })
})
