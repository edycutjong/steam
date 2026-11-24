import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RecipeBundle, type BundleNote } from './schema.ts'
import { displayableNotes, parseRegionUrl, regionOf, regionUrl, resolveNote } from './provenance.ts'

const real = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))
const clone = (): RecipeBundle => JSON.parse(JSON.stringify(real))
const hero = real.notes.find((n) => n.id === 'till-it-looks-red-smooth')!
const SERVICE = 'https://iiif.wellcomecollection.org/image/b18419665_MS_1810_0033.JP2'

/** Test's own copy of the arithmetic (R21.4), so the module is not checking itself. */
function expected(b: RecipeBundle, n: BundleNote) {
  const c = b.source.canvas!
  const f = b.source.frame!
  const [vx, vy, vw, vh] = n.verifyBox
  const sx = c.width / f.width
  const sy = c.height / f.height
  const x = Math.floor(vx * sx)
  const y = Math.floor(vy * sy)
  return { x, y, w: Math.ceil((vx + vw) * sx) - x, h: Math.ceil((vy + vh) * sy) - y }
}

describe('regionOf and regionUrl (R21.4 to R21.6)', () => {
  it('gives the hero note 641,3660,2897,511 and the URL on the image service', () => {
    expect(regionOf(real, hero)).toEqual(expected(real, hero))
    expect(regionOf(real, hero)).toEqual({ x: 641, y: 3660, w: 2897, h: 511 })
    expect(regionUrl(real, hero)).toBe(`${SERVICE}/641,3660,2897,511/full/0/default.jpg`)
  })
  it('floors the origin and ceils the far edge on hand-made boxes', () => {
    const b = clone()
    const n = { ...hero, verifyBox: [10.9, 20.1, 100.2, 50.5] as [number, number, number, number] }
    const sx = b.source.canvas!.width / b.source.frame!.width
    const r = regionOf(b, n)!
    expect(r.x).toBe(Math.floor(10.9 * sx))
    expect(r.x + r.w).toBe(Math.ceil(111.1 * sx))
  })
  it('clips at the canvas edge', () => {
    const f = real.source.frame!
    const r = regionOf(real, { ...hero, verifyBox: [f.width - 10, f.height - 10, 500, 500] })!
    expect(r.x + r.w).toBe(real.source.canvas!.width)
    expect(r.y + r.h).toBe(real.source.canvas!.height)
  })
  it('gives null for a zero-area box', () => {
    expect(regionOf(real, { ...hero, verifyBox: [10, 10, 0, 5] })).toBeNull()
    expect(regionUrl(real, { ...hero, verifyBox: [10, 10, 5, 0] })).toBeNull()
  })
  it('parseRegionUrl inverts regionUrl', () => {
    for (const n of real.notes) {
      const p = parseRegionUrl(regionUrl(real, n)!)
      expect(p).toEqual({ service: real.source.imageService, region: regionOf(real, n) })
    }
  })
  it.each([
    [`${SERVICE}/641.5,3660,2897,511/full/0/default.jpg`],
    [`${SERVICE}/-1,3660,2897,511/full/0/default.jpg`],
    [`${SERVICE}/641,3660,2897/full/0/default.jpg`],
    [`${SERVICE}/641,3660,2897,511/full/90/default.jpg`],
    [`${SERVICE}/641,3660,2897,511/200,/0/default.jpg`],
    [`${SERVICE}/pct:1,2,3,4/full/0/default.jpg`],
    [`${SERVICE}/641,3660,2897,511/full/0/default.png`],
    ['not a url'],
  ])('parseRegionUrl rejects %s', (u) => expect(parseRegionUrl(u)).toBeNull())
  it('each edge is within 1 canvas px of the percentage verifyUrl times the canvas size, for all three notes', () => {
    const c = real.source.canvas!
    for (const n of real.notes) {
      const [px, py, pw, ph] = n.verifyUrl.match(/pct:([\d.]+),([\d.]+),([\d.]+),([\d.]+)/)!.slice(1).map(Number) as [number, number, number, number]
      const r = regionOf(real, n)!
      const e = [(px / 100) * c.width, (py / 100) * c.height, ((px + pw) / 100) * c.width, ((py + ph) / 100) * c.height]
      const got = [r.x, r.y, r.x + r.w, r.y + r.h]
      got.forEach((g, i) => expect(Math.abs(g - e[i]!), `${n.id} edge ${i}`).toBeLessThanOrEqual(1))
    }
  })
})

describe('resolveNote and displayableNotes (R22.1, R22.2, R22.4)', () => {
  it('is ok on the three real notes, carrying manifest, canvas, region, licence and URL', () => {
    for (const n of real.notes) {
      const r = resolveNote(real, n)
      expect(r.ok).toBe(true)
      if (r.ok) {
        expect(r.manifest).toBe(real.source.manifest)
        expect(r.canvas).toBe(real.source.canvas!.id)
        expect(r.licence).toBe('pdm')
        expect(r.regionUrl).toBe(regionUrl(real, n))
      }
    }
  })
  const failing: [string, RegExp, (b: RecipeBundle) => void][] = [
    ['manifest not https', /manifest/i, (b) => { b.source.manifest = 'http://iiif.wellcomecollection.org/presentation/v2/b18419665' }],
    ['empty canvas id', /canvas id/i, (b) => { b.source.canvas!.id = '' }],
    ['non-integer canvasIndex', /canvasIndex/, (b) => { b.source.canvasIndex = 1.5 }],
    ['institution disagrees', /institution/, (b) => { b.notes[0]!.provenance.institution = 'Elsewhere' }],
    ['shelfmark disagrees', /shelfmark/, (b) => { b.notes[0]!.provenance.shelfmark = 'MS.1' }],
    ['page disagrees', /page/, (b) => { b.notes[0]!.provenance.page = 'p.1' }],
    ['date disagrees', /date/, (b) => { b.notes[0]!.provenance.date = '1999' }],
    ['licence id disagrees', /licence id/, (b) => { b.notes[0]!.provenance.licence.id = 'cc0' }],
    ['credit disagrees', /credit/, (b) => { b.notes[0]!.provenance.credit = 'Someone' }],
    ['licence cc-by-nc', /licence/, (b) => { b.source.licence.id = 'cc-by-nc'; for (const n of b.notes) n.provenance.licence.id = 'cc-by-nc' }],
    ['zero-area region', /no area/, (b) => { b.notes[0]!.verifyBox = [10, 10, 0, 0] }],
    ['region outside the canvas', /outside the canvas/, (b) => { b.notes[0]!.verifyBox = [5000, 5000, 10, 10] }],
  ]
  it.each(failing)('%s fails with the reason of that rule only', (_name, reason, edit) => {
    const b = clone()
    edit(b)
    const r = resolveNote(b, b.notes[0]!)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(reason)
    // the others are unaffected by a note-only edit
    if (_name.endsWith('disagrees') || _name.includes('region')) expect(resolveNote(b, b.notes[1]!).ok).toBe(true)
  })
  it('displayableNotes returns the ok notes in step order and lists the rest as withheld', () => {
    const b = clone()
    b.notes.find((n) => n.id === 'when-tender')!.verifyBox = [1, 1, 0, 0]
    const d = displayableNotes(b)
    expect(d.notes.map((n) => n.id)).toEqual(['full-ripe', 'till-it-looks-red-smooth'])
    expect(d.withheld).toEqual([{ noteId: 'when-tender', reason: expect.stringMatching(/no area/) }])
    expect(displayableNotes(real).notes.map((n) => n.step)).toEqual([1, 4, 5])
  })
})
