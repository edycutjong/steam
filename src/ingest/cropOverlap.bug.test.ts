// crop-overlap (.kiro/specs/crop-overlap/bugfix.md): exploration test, now asserting the FIXED behaviour.
// Every box of the P0c prototype's own output, as a note on the segmented Quinces page (p.23, block 1).
//   1. The crop the bundle takes by default (ownership masks) holds P4 for every note: no lit pixel owned by another line.
//   2. The eye-read source still fails P4, so the bug stays demonstrable. Its original assertion is kept under
//      `it.fails` for steps 1 to 5, only now that the red run is recorded in docs/kiro-evidence/crop-overlap/red.txt;
//      step 6's box holds only its own line 11 and passes.
// The unfixed code failed (1) for steps 1 to 5 (red.txt); the fixed code passes (green.txt).
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { noteOfBox, overlapMessage, pageOf, replayP4, type P0cBox } from './cropOverlap.fixture.ts'
import { cropSource, defaultCropMode } from './cropSource.ts'
import { toGray } from './image.ts'
import { segmentPage } from './segment.ts'

const fx = (f: string) => new URL(`../../fixtures/${f}`, import.meta.url)
const j = jpeg.decode(readFileSync(fx('p0033.jpg')), { useTArray: true })
const seg = segmentPage(toGray({ width: j.width, height: j.height, data: j.data }), { block: 1 })
const boxes: P0cBox[] = JSON.parse(readFileSync(fx('p0c-eyeread-boxes.json'), 'utf8')).boxes
const page = pageOf(seg)
/** Steps whose box lights ink of another line (red.txt, and the task 28 measurement: step 6 holds line 11 only). */
const OVERLAPPING = [1, 2, 3, 4, 5]

describe('crop-overlap fixed: a note cropped by the bundle holds P4 (no pixel owned by another line)', () => {
  for (const b of boxes) {
    it(`step ${b.step}${b.note ? ` ("${b.note}")` : ''}: the default crop source gives no pixel owned by another line`, () => {
      const note = noteOfBox(seg, b)
      expect(note.box, 'the note still comes with its eye-read box').toBeDefined()
      expect(defaultCropMode(note)).toBe('ownership')
      const crop = cropSource(page, note)
      expect(crop.mode).toBe('ownership')
      const r = replayP4(seg, note, crop.mask)
      if (!r.p4.pass) throw new Error(overlapMessage(note, r))
      expect(r.foreign.size).toBe(0)
      expect(r.unowned).toBe(0)
      expect(r.lit, 'the crop shows some ink').toBeGreaterThan(0)
    })
  }
})

describe('crop-overlap bug reproduction: the eye-read source still fails P4', () => {
  for (const b of boxes) {
    // The original assertion of the red test, with the source named explicitly. It fails for steps 1 to 5 (it.fails).
    const run = OVERLAPPING.includes(b.step) ? it.fails : it
    run(`step ${b.step}: the eye-read box crop gives no pixel owned by another line`, () => {
      const note = noteOfBox(seg, b)
      const r = replayP4(seg, note, cropSource(page, note, { mode: 'eyeread-box' }).mask)
      if (!r.p4.pass) throw new Error(overlapMessage(note, r))
      expect(r.foreign.size).toBe(0)
    })
  }
  it('fails for exactly steps 1 to 5 and each failure names the step, the foreign line and the pixel count', () => {
    const failing: number[] = []
    for (const b of boxes) {
      const note = noteOfBox(seg, b)
      const r = replayP4(seg, note, cropSource(page, note, { mode: 'eyeread-box' }).mask)
      if (r.p4.pass) continue
      failing.push(b.step)
      const msg = overlapMessage(note, r)
      expect(msg).toMatch(new RegExp(`^step ${b.step}'s crop contains (\\d+ px owned by line \\d+|\\d+ px of ink no line owns)`))
      for (const [line, px] of r.foreign) {
        expect(px).toBeGreaterThan(0)
        expect(note.lines).not.toContain(line)
        expect(msg).toContain(`${px} px owned by line ${line}`)
      }
      expect(r.foreign.size + r.unowned).toBeGreaterThan(0)
    }
    expect(failing).toEqual(OVERLAPPING)
  })
  it('the same source asked for a note with no box is an error, not a silent fallback', () => {
    expect(() => cropSource(page, { id: 'x', step: 1, lines: [1] }, { mode: 'eyeread-box' })).toThrow(/needs a box/)
  })
})
