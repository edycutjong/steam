// Evidence for the component partition on the hero note (tasks 51): the note before (whole lines 9 and 10) and after
// (component boundaries of alignment.json), the per-word score against fixtures/hero-word-bounds.json, and where the
// pixels the note does not keep come from. Reproduce: npx tsx scripts/hero-after-partition.ts
// Writes docs/kiro-evidence/ingest/hero-after-component-partition.png and .json. The fixture boxes only score; they cut nothing.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalJson } from '../src/ingest/canon.ts'
import { runGate } from '../src/ingest/gate.ts'
import { rotatedPoint, toGray, type Rgba } from '../src/ingest/image.ts'
import { segmentRecipe } from '../src/ingest/segment.ts'
import { rawInk } from '../src/ingest/threshold.ts'
import { encodePng } from '../tools/steam-ingest/io.ts'
import { loadScan } from '../tools/steam-ingest/segment.ts'

const dir = 'content/recipes/quinces-marmalade'
const t = (f: string) => readFileSync(join(dir, f), 'utf8')
const scan = loadScan(dir).scan
const fixture = JSON.parse(readFileSync('fixtures/hero-word-bounds.json', 'utf8')) as { recallThreshold: number; words: { word: string; box: [number, number, number, number] }[] }
const run = (alignment: string) =>
  runGate({
    recipeId: 'quinces-marmalade', pageBytes: readFileSync(join(dir, 'page.jpg')), scan,
    files: { 'source.json': t('source.json'), 'lines.json': t('lines.json'), 'agent/scribe.json': t('agent/scribe.json'), 'agent/second.json': t('agent/second.json'), 'transcription.md': t('transcription.md'), 'ownership-review.json': t('ownership-review.json'), 'alignment.json': alignment },
    heroFixture: JSON.stringify(fixture), gold: readFileSync('fixtures/gold-readings.json', 'utf8'),
  })
const al = JSON.parse(t('alignment.json'))
const before = run(JSON.stringify({ ...al, lines: al.lines.filter((l: { line: number }) => l.line < 9) }))
const after = run(JSON.stringify(al))
const id = 'notes/note-till-it-looks-red-smooth'
const png = (g: ReturnType<typeof run>) => g.artifacts.png.get(`${id}.png`)!
const box = (g: ReturnType<typeof run>) => (g.artifacts.json.get(`${id}.json`) as { pageBox: number[] }).pageBox

// side by side, one above the other, composited over paper
const paper = [232, 220, 194]
const over = (p: Rgba, y0: number, out: Rgba): void => {
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4
      const a = p.data[i + 3]! / 255
      const o = ((y0 + y) * out.width + x) * 4
      for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(p.data[i + c]! * a + paper[c]! * (1 - a))
      out.data[o + 3] = 255
    }
}
const a = png(before)
const b = png(after)
const gap = 16
const W = Math.max(a.width, b.width)
const out: Rgba = { width: W, height: a.height + b.height + gap, data: new Uint8Array(W * (a.height + b.height + gap) * 4) }
for (let i = 0; i < out.data.length; i += 4) out.data.set([60, 50, 50, 255], i)
over(a, 0, out)
over(b, a.height + gap, out)
writeFileSync('docs/kiro-evidence/ingest/hero-after-component-partition.png', encodePng(out))

// per-word accounting in the fixture frame
const sf = segmentRecipe(scan, { block: 1 })
const seg = sf.seg
const tilt = seg.deskewApplied ? seg.deskewDeg : 0
const Wf = seg.frame.width
const Hf = seg.frame.height
const raw0 = rawInk(toGray(scan))
const bx = box(after)
const litAfter = (ax: number, ay: number): boolean => {
  const px = ax - bx[0]!, py = ay - bx[1]!
  const p = png(after)
  return px >= 0 && py >= 0 && px < p.width && py < p.height && p.data[(py * p.width + px) * 4 + 3]! > 0
}
const words = fixture.words.map((w) => {
  let rawPx = 0, kept = 0
  const lost: Record<string, number> = {}
  for (let y = w.box[1]; y < w.box[3]; y++)
    for (let x = w.box[0]; x < w.box[2]; x++) {
      if (!raw0[y * scan.width + x]) continue
      rawPx++
      const [ax, ay] = rotatedPoint(x, y, -tilt, Wf, Hf)
      const i = Math.round(ay) * Wf + Math.round(ax)
      if (litAfter(Math.round(ax), Math.round(ay))) kept++
      else {
        const o = seg.own.owner[i]!
        const k = o < 0 ? 'ink owned by no line' : `ink owned by line ${o}`
        lost[k] = (lost[k] ?? 0) + 1
      }
    }
  return { word: w.word, rawPx, kept, recall: kept / rawPx, notKeptBy: lost }
})
const rec = (g: ReturnType<typeof run>) => g.gate.recall![0]!.shipped
// note pixels outside every fixture box, by line
let maskPx = 0
const outsideBy: Record<string, number> = {}
const p = png(after)
for (let y = 0; y < p.height; y++)
  for (let x = 0; x < p.width; x++) {
    if (!p.data[(y * p.width + x) * 4 + 3]) continue
    maskPx++
    const gx = x + bx[0]!, gy = y + bx[1]!
    const [fx, fy] = rotatedPoint(gx, gy, tilt, Wf, Hf)
    if (fixture.words.some((w) => fx >= w.box[0] && fx < w.box[2] && fy >= w.box[1] && fy < w.box[3])) continue
    const o = seg.own.owner[gy * Wf + gx]!
    const k = o < 0 ? 'faint shell pixel (no ink)' : `ink of line ${o}`
    outsideBy[k] = (outsideBy[k] ?? 0) + 1
  }
writeFileSync(
  'docs/kiro-evidence/ingest/hero-after-component-partition.json',
  canonicalJson({
    note: 'till-it-looks-red-smooth', threshold: fixture.recallThreshold,
    before: { alignment: rec(before).alignment, recall: rec(before).recall, litPx: before.gate.results!.P4.detail.match(/till-it-looks-red-smooth: (\d+) lit/)?.[1] },
    after: { alignment: rec(after).alignment, recall: rec(after).recall, notePrecisionInBoxes: rec(after).precision, litPx: maskPx, results: Object.fromEntries(Object.entries(after.gate.results!).map(([k, v]) => [k, v.pass])) },
    perWord: words,
    afterLitPixelsOutsideEveryBox: outsideBy,
  }),
)
console.log(JSON.stringify({ before: rec(before).recall, after: rec(after).recall, precision: rec(after).precision, words, outsideBy }, null, 1))
