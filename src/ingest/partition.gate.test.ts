// Component partition: mask, P4 and the gate end to end (requirements R19.8 to R19.15, R27). Written before the implementation.
import { describe, expect, it } from 'vitest'
import { Gate } from '../data/schema.ts'
import { canonicalJson } from './canon.ts'
import { labelComponents } from './components.ts'
import { runGate, type GateCtx } from './gate.ts'
import { syntheticRecipe } from './gate.fixture.ts'
import type { Bands, Ownership } from './masks.ts'
import { lineComponents, partitionCandidates } from './partition.ts'
import { checkP4 } from './props.ts'
import type { Rgba } from './image.ts'
import { noteMask, type BuiltPart } from './timeofink.ts'

const W = 100
const H = 40

/** One line, three components: A (10-14), B (30-34), C (60-64), all owned by line 0, plus a component D of line 1 below. */
function page() {
  const ink = new Uint8Array(W * H)
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ink[y * W + x] = 1
  }
  box(10, 5, 14, 15)
  box(30, 5, 34, 15)
  box(60, 5, 64, 15)
  box(30, 25, 34, 35)
  const labels = labelComponents(ink, W, H)
  const owner = new Int16Array(W * H).fill(-1)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x]) owner[y * W + x] = y < 20 ? 0 : 1
  const own: Ownership = { width: W, height: H, owner, components: new Map(), splits: [], reviewers: new Map() }
  const bands: Bands = { cores: [[5, 15], [25, 35]], valleys: [20] }
  const id = (x: number, y: number) => labels.label[y * W + x]!
  return { ink, labels, own, bands, id }
}
const partOf = (allowed: number[]): BuiltPart => ({
  line: 0, fromWord: 6, toWord: 8, method: 'curator', boundaries: [], boundary: 'component', partition: { after: [], allowed, quotedGroup: 1 }, autoDetail: 'x', whole: false,
})

describe('noteMask for a component partition (R19.14)', () => {
  it('keeps the owned pixels of the quoted components and no others', () => {
    const p = page()
    const m = noteMask(p.own, p.bands, 0, [partOf([p.id(30, 5), p.id(60, 5)])], undefined, p.labels.label)
    expect(m[5 * W + 30]).toBe(1)
    expect(m[15 * W + 64]).toBe(1)
    expect(m[5 * W + 10]).toBe(0) // component A is outside the quoted group
    expect(m[25 * W + 30]).toBe(0) // another line's ink is never in the mask
    expect(m.reduce((a, b) => a + b, 0)).toBe(2 * 5 * 11)
  })
  it('needs the labels', () => {
    const p = page()
    expect(() => noteMask(p.own, p.bands, 0, [partOf([p.id(30, 5)])])).toThrow(/labels/)
  })
})

describe('P4 for a component partition (R19.14)', () => {
  const png = (lit: number[][]): Rgba => {
    const o: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4) }
    for (const [x, y] of lit) o.data[(y * W + x) * 4 + 3] = 255
    return o
  }
  const input = (p: ReturnType<typeof page>, lit: number[][]) => ({
    noteId: 'n', width: W, height: H, owner: p.own.owner, pageInk: p.ink, s: 0,
    parts: [{ line: 0, boundaries: [] as number[], allowedComponents: [p.id(30, 5), p.id(60, 5)], fromWord: 6, toWord: 8, yMid: 10 }],
    label: p.labels.label, png: png(lit), pageBox: [0, 0, W, H] as [number, number, number, number],
  })
  it('passes a note lit on the quoted components only', () => {
    const p = page()
    expect(checkP4(input(p, [[30, 5], [31, 6], [60, 5]])).pass).toBe(true)
  })
  it('fails ink of a component outside the quoted groups, though the line owns it', () => {
    const p = page()
    const r = checkP4(input(p, [[30, 5], [10, 5]]))
    expect(r.pass).toBe(false)
    expect(r.detail).toMatch(/1 lit pixels are ink not owned by the quoted words/)
  })
  it('fails ink owned by another line', () => {
    const p = page()
    const r = checkP4(input(p, [[30, 5], [30, 25]]))
    expect(r.pass).toBe(false)
    expect(r.detail).toMatch(/owned by line 1/)
  })
})

describe('the gate, end to end, on a synthetic line whose words leave no column run', () => {
  const rec = syntheticRecipe({ noRuns: true })
  const seg = rec.sf.seg
  const runs3 = rec.sf.runs.lines[3]!
  const yMid = (seg.bands.cores[3]![0] + seg.bands.cores[3]![1]) / 2
  const order = lineComponents(seg.labels, seg.own.owner, 3, yMid, seg.slant.s, [runs3.lo, runs3.hi])
  const cands = partitionCandidates(order)
  const ctx = (files: Record<string, string | undefined>): GateCtx => ({ recipeId: 'syn', pageBytes: new Uint8Array([1, 2, 3]), scan: rec.scan, files: files as GateCtx['files'] })
  const alignment = (entries: unknown[], by?: string) =>
    canonicalJson({
      segmentRun: rec.sf.lines.segmentRun, method: 'curator', by: 'Kiro (agent), file', rationale: 'chosen from the ranked candidates',
      lines: [{ line: 3, ...(by ? { by } : {}), boundaryRuns: entries }],
    })

  it('has no run on line 3 and four components', () => {
    expect(runs3.runs).toEqual([])
    expect(order).toHaveLength(4)
    expect(cands).toHaveLength(3)
  })

  it('without alignment.json the note stays on whole lines', () => {
    const g = runGate(ctx(rec.files))
    expect(g.state).toBe('pass')
    expect(g.gate.alignment![1]!.alignment).toBe('lines')
  })

  it('with a component boundary between "it" and "till" the note is a curator alignment and shows only the two right-hand words of line 3', () => {
    const between = cands.find((c) => c.position === 1)!
    const files = { ...rec.files, 'alignment.json': alignment([null, { kind: 'component', after: between.after }, null], 'Kiro (agent), turn-test') }
    const g = runGate(ctx(files))
    expect(g.state).toBe('pass')
    const n = g.gate.alignment!.find((a) => a.noteId === 'till-smooth')!
    expect(n.alignment).toBe('curator')
    expect(n.granularity).toBe('words')
    const part = n.parts.find((p) => p.line === 3)!
    expect(part).toMatchObject({ method: 'curator', boundary: 'component', components: [between.after], boundaries: [] })
    const nj = g.artifacts.json.get('notes/note-till-smooth.json') as { shownText: string; alignmentBy: string; groups: { line: number; words: unknown }[] }
    expect(nj.shownText).toBe('till it Looks red & smooth,')
    expect(nj.alignmentBy).toBe('Kiro (agent), turn-test')
    expect(nj.groups.find((x) => x.line === 3)!.words).toEqual({ from: 2, to: 3 })
    // no lit pixel on a component of the left words (boil, it) of line 3
    const png = g.artifacts.png.get('notes/note-till-smooth.png')!
    const [bx, by] = (g.artifacts.json.get('notes/note-till-smooth.json') as { pageBox: number[] }).pageBox
    const left = new Set(order.slice(0, 2).map((c) => c.id))
    const right = new Set(order.slice(2).map((c) => c.id))
    let litLeft = 0
    let litRight = 0
    for (let y = 0; y < png.height; y++)
      for (let x = 0; x < png.width; x++) {
        if (!png.data[(y * png.width + x) * 4 + 3]) continue
        const id = seg.labels.label[(y + by!) * seg.frame.width + x + bx!]!
        if (left.has(id)) litLeft++
        if (right.has(id)) litRight++
      }
    expect(litLeft).toBe(0)
    expect(litRight).toBeGreaterThan(0)
    expect(g.gate.results!.P4.pass).toBe(true)
    expect(Gate.safeParse({ ...g.gate, at: 'x' }).success).toBe(true)
  })

  it('a component that is not a candidate, or an entry in the middle of the quote, leaves the note on whole lines with the reason', () => {
    const bad = runGate(ctx({ ...rec.files, 'alignment.json': alignment([null, { kind: 'component', after: 999 }, null]) }))
    expect(bad.state).toBe('pass')
    const part = bad.gate.alignment!.find((a) => a.noteId === 'till-smooth')!
    expect(part.alignment).toBe('lines')
    expect(part.parts.find((p) => p.line === 3)!.reason).toMatch(/component 999 is not a candidate/)
    const inside = runGate(ctx({ ...rec.files, 'alignment.json': alignment([null, null, { kind: 'component', after: cands.find((c) => c.position === 2)!.after }]) }))
    expect(inside.gate.alignment!.find((a) => a.noteId === 'till-smooth')!.parts.find((p) => p.line === 3)!.reason).toMatch(/inside the quote|merges words/)
  })

  it('P4 version: a component partition is a new kind of word region, so propsVersion is 2', () => {
    expect(runGate(ctx(rec.files)).gate.propsVersion).toBe('2')
  })
})
