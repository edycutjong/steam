// Bug condition exploration: crop-overlap (.kiro/specs/crop-overlap/bugfix.md).
// Every box of the P0c prototype's own output, as a note whose crop comes from the bundle's default crop source,
// on the segmented Quinces page (p.23, the same block-1 recipe region the real run uses). P4 must hold for each:
// no lit pixel owned by a line the note does not quote. On the unfixed code the default source for a note that
// comes with a box is the eye-read rectangle, so this test FAILS (red). Output: docs/kiro-evidence/crop-overlap/red.txt
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { noteOfBox, overlapMessage, pageOf, replayP4, type P0cBox } from './cropOverlap.fixture.ts'
import { cropSource } from './cropSource.ts'
import { toGray } from './image.ts'
import { segmentPage } from './segment.ts'

const fx = (f: string) => new URL(`../../fixtures/${f}`, import.meta.url)
const j = jpeg.decode(readFileSync(fx('p0033.jpg')), { useTArray: true })
const seg = segmentPage(toGray({ width: j.width, height: j.height, data: j.data }), { block: 1 })
const boxes: P0cBox[] = JSON.parse(readFileSync(fx('p0c-eyeread-boxes.json'), 'utf8')).boxes
const page = pageOf(seg)

describe('crop-overlap: a note cropped by the bundle holds P4 (no pixel owned by another line)', () => {
  for (const b of boxes) {
    it(`step ${b.step}${b.note ? ` ("${b.note}")` : ''}: the default crop source gives no pixel owned by another line`, () => {
      const note = noteOfBox(seg, b)
      const crop = cropSource(page, note)
      const r = replayP4(seg, note, crop.mask)
      if (!r.p4.pass) throw new Error(overlapMessage(note, r))
      expect(r.foreign.size).toBe(0)
    })
  }
})
