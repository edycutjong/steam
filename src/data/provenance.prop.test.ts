import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { displayableNotes, parseRegionUrl, regionUrl, resolveNote } from './provenance.ts'
import { RecipeBundle } from './schema.ts'

// P8 (design 13): every displayed note resolves to its source. The bundles are the real quinces bundle edited at random;
// the oracle below is a separate statement of R22.2 and of the region arithmetic, not a copy of provenance.ts.
const real = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))
type Any = any // eslint-disable-line @typescript-eslint/no-explicit-any
const RUNS = 3000

const num = fc.oneof(fc.integer({ min: -50, max: 6000 }), fc.double({ min: -50, max: 6000, noNaN: true }), fc.constantFrom(0, 1, 0.5))
const box = fc.tuple(num, num, num, num)

type Edit = (b: Any) => void
const edit = (f: Edit): fc.Arbitrary<Edit> => fc.constant(f)
const provField = fc.constantFrom('institution', 'shelfmark', 'page', 'date', 'credit')
const edits: fc.Arbitrary<Edit> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('pdm', 'cc0', 'cc-by', 'cc-by-nc', 'in-copyright', '').chain((id) => fc.boolean().map<Edit>((both) => (b) => { b.source.licence.id = id; if (both) for (const n of b.notes) n.provenance.licence.id = id })) },
  { weight: 2, arbitrary: fc.constantFrom('https://a.example/m', 'http://a.example/m', 'ftp://x', '', 'iiif.wellcomecollection.org').map<Edit>((m) => (b) => { b.source.manifest = m }) },
  { weight: 2, arbitrary: fc.oneof(fc.constant(''), fc.constant('c'), fc.constant(undefined)).map<Edit>((id) => (b) => { if (id === undefined) delete b.source.canvas; else b.source.canvas.id = id }) },
  { weight: 2, arbitrary: fc.tuple(fc.integer({ min: 0, max: 9000 }), fc.integer({ min: 0, max: 9000 })).map<Edit>(([w, h]) => (b) => { if (b.source.canvas) { b.source.canvas.width = w; b.source.canvas.height = h } }) },
  { weight: 2, arbitrary: fc.tuple(fc.integer({ min: 0, max: 4000 }), fc.integer({ min: 0, max: 4000 })).map<Edit>(([w, h]) => (b) => { b.source.frame.width = w; b.source.frame.height = h }) },
  { weight: 1, arbitrary: edit((b) => { delete b.source.frame }) },
  { weight: 1, arbitrary: fc.constantFrom(0.5, 1, 2.25, NaN).map<Edit>((i) => (b) => { b.source.canvasIndex = i }) },
  { weight: 4, arbitrary: fc.tuple(fc.integer({ min: 0, max: 2 }), box).map<Edit>(([i, v]) => (b) => { b.notes[i].verifyBox = v }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 2 }).map<Edit>((i) => (b) => { delete b.notes[i].verifyBox }) },
  { weight: 3, arbitrary: fc.tuple(fc.integer({ min: 0, max: 2 }), provField, fc.constantFrom('X', '')).map<Edit>(([i, f, v]) => (b) => { b.notes[i].provenance[f] = v }) },
  { weight: 1, arbitrary: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.constantFrom('pdm', 'cc0', 'zzz')).map<Edit>(([i, v]) => (b) => { b.notes[i].provenance.licence.id = v }) },
  { weight: 1, arbitrary: fc.tuple(fc.integer({ min: 0, max: 2 }), provField).map<Edit>(([i, f]) => (b) => { delete b.notes[i].provenance[f] }) },
)
const bundles = fc.array(edits, { maxLength: 4 }).map((es) => {
  const b = JSON.parse(JSON.stringify(real)) as Any
  for (const e of es) {
    try { e(b) } catch { /* an edit may target a field an earlier edit deleted: that is itself a valid mutation */ }
  }
  return b as RecipeBundle
})

/** Oracle: R22.2 written out. Returns the canvas-px region when the note qualifies, else null. */
function oracle(b: Any, n: Any): { x: number; y: number; w: number; h: number } | null {
  const s = b.source
  if (typeof s?.manifest !== 'string' || !s.manifest.startsWith('https://') || s.manifest.length <= 8) return null
  if (typeof s.canvas?.id !== 'string' || s.canvas.id === '') return null
  if (!Number.isInteger(s.canvasIndex)) return null
  const p = n.provenance
  if (!p) return null
  for (const f of ['institution', 'shelfmark', 'page', 'date', 'credit']) if (p[f] === undefined || p[f] !== s[f]) return null
  if (p.licence?.id === undefined || p.licence.id !== s.licence.id) return null
  if (!['pdm', 'cc0', 'cc-by'].includes(s.licence.id)) return null
  const W = s.canvas.width
  const H = s.canvas.height
  const fw = s.frame?.width
  const fh = s.frame?.height
  if (!(W > 0 && H > 0 && fw > 0 && fh > 0)) return null
  const v = n.verifyBox
  if (!Array.isArray(v) || v.length !== 4 || !v.every((t: unknown) => typeof t === 'number' && Number.isFinite(t))) return null
  if (v[2] <= 0 || v[3] <= 0) return null
  const x0 = Math.max(0, Math.floor((v[0] * W) / fw))
  const y0 = Math.max(0, Math.floor((v[1] * H) / fh))
  const x1 = Math.min(W, Math.ceil(((v[0] + v[2]) * W) / fw))
  const y1 = Math.min(H, Math.ceil(((v[1] + v[3]) * H) / fh))
  if (x1 - x0 < 1 || y1 - y0 < 1) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

describe('P8: every displayed note resolves to its source', () => {
  it('P8.1 displayable iff resolveNote is ok iff R22.2 holds (independent predicate)', () => {
    fc.assert(
      fc.property(bundles, (b) => {
        const d = displayableNotes(b)
        const ids = d.notes.map((n) => n.id)
        for (const n of b.notes) {
          const o = oracle(b, n)
          const r = resolveNote(b, n)
          expect(r.ok).toBe(o !== null)
          expect(ids.includes(n.id)).toBe(o !== null)
          if (r.ok && o) expect(r.region).toEqual(o)
          expect(d.withheld.some((w) => w.noteId === n.id)).toBe(o === null)
        }
        expect(d.notes.length + d.withheld.length).toBe(b.notes.length)
      }),
      { numRuns: RUNS },
    )
  })

  it('P8.2 a displayable note\'s URL parses to exactly its region: four integers, w and h at least 1, inside the canvas', () => {
    fc.assert(
      fc.property(bundles, (b) => {
        for (const n of displayableNotes(b).notes) {
          const r = resolveNote(b, n)
          if (!r.ok) throw new Error('displayable but not ok')
          const p = parseRegionUrl(r.regionUrl)!
          expect(p.service).toBe(b.source.imageService)
          expect(p.region).toEqual(r.region)
          expect(regionUrl(b, n)).toBe(r.regionUrl)
          const { x, y, w, h } = p.region
          for (const t of [x, y, w, h]) expect(Number.isInteger(t)).toBe(true)
          expect(w).toBeGreaterThanOrEqual(1)
          expect(h).toBeGreaterThanOrEqual(1)
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x + w).toBeLessThanOrEqual(b.source.canvas!.width)
          expect(y + h).toBeLessThanOrEqual(b.source.canvas!.height)
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('P8.3 the region contains the scaled box and exceeds it by less than 2 canvas px per edge, except where clipped', () => {
    fc.assert(
      fc.property(bundles, (b) => {
        const W = b.source.canvas?.width ?? 0
        const H = b.source.canvas?.height ?? 0
        for (const n of displayableNotes(b).notes) {
          const r = resolveNote(b, n)
          if (!r.ok) throw new Error('displayable but not ok')
          const [vx, vy, vw, vh] = n.verifyBox
          const sx = W / b.source.frame!.width
          const sy = H / b.source.frame!.height
          const { x, y, w, h } = r.region
          const sides: [number, number, boolean][] = [
            [x, vx * sx, x === 0], // [region edge, scaled edge, clipped]
            [y, vy * sy, y === 0],
            [x + w, (vx + vw) * sx, x + w === W],
            [y + h, (vy + vh) * sy, y + h === H],
          ]
          sides.forEach(([edge, scaled, clip], i) => {
            const near = i < 2
            const outward = near ? scaled - edge : edge - scaled // how far the region reaches past the box
            if (!clip) {
              expect(outward).toBeGreaterThanOrEqual(-1e-9)
              expect(outward).toBeLessThan(2)
            } else {
              expect(edge).toBe(near ? 0 : i === 2 ? W : H)
            }
          })
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('P8.4 each region edge is within 1 canvas px (plus the percentage rounding) of the percentage verifyUrl times the canvas size (box and frame unedited)', () => {
    const f0 = real.source.frame!
    fc.assert(
      fc.property(bundles, (b) => {
        if (b.source.frame?.width !== f0.width || b.source.frame?.height !== f0.height) return
        const W = b.source.canvas?.width ?? 0
        const H = b.source.canvas?.height ?? 0
        for (const n of displayableNotes(b).notes) {
          const orig = real.notes.find((o) => o.id === n.id)!
          if (n.verifyBox.some((v, i) => v !== orig.verifyBox[i])) continue
          const [px, py, pw, ph] = n.verifyUrl.match(/pct:([\d.]+),([\d.]+),([\d.]+),([\d.]+)/)!.slice(1).map(Number) as [number, number, number, number]
          const r = (resolveNote(b, n) as { region: { x: number; y: number; w: number; h: number } }).region
          const want = [(px / 100) * W, (py / 100) * H, ((px + pw) / 100) * W, ((py + ph) / 100) * H]
          const got = [r.x, r.y, r.x + r.w, r.y + r.h]
          // floor/ceil move an edge by less than 1 px; the 4-decimal percentages add up to 2 x 0.00005% of the canvas side (design 2.3)
          got.forEach((g, i) => expect(Math.abs(g - want[i]!)).toBeLessThanOrEqual(1 + 1e-6 * (i % 2 === 0 ? W : H) + 1e-9))
        }
      }),
      { numRuns: RUNS },
    )
  })

  it('P8.5 no displayable note has a licence outside pdm, cc0, cc-by', () => {
    fc.assert(
      fc.property(bundles, (b) => {
        for (const n of displayableNotes(b).notes) {
          expect(['pdm', 'cc0', 'cc-by']).toContain(b.source.licence.id)
          expect(['pdm', 'cc0', 'cc-by']).toContain(n.provenance.licence.id)
        }
      }),
      { numRuns: RUNS },
    )
  })

  // P8.6 (the shelf, edition, plan and quoted lists name the same ids) is asserted in src/app/Quoted.test.tsx, task 47, where the lists exist.
  it.todo('P8.6 the sets of note ids of the shelf count, the edition, the plan and the quoted list equal the displayable ids (task 47)')
})
