// P4 (d) on the real page: the P0c kill-test's eye-read boxes, replayed as note masks over the page's ink, must fail.
// And the fixture scorer on a synthetic mask. One whole-page segmentation for the file.
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { matchFixtureWords, scoreAgainstFixture, type FixtureWord } from './align.ts'
import { rotatedPoint, toGray, type Rgba } from './image.ts'
import { checkP4 } from './props.ts'
import { segmentPage } from './segment.ts'

const fx = (f: string) => new URL(`../../fixtures/${f}`, import.meta.url)
const j = jpeg.decode(readFileSync(fx('p0033.jpg')), { useTArray: true })
const page = toGray({ width: j.width, height: j.height, data: j.data })
const boxes: { step: number; note: string | null; box: [number, number, number, number] }[] = JSON.parse(readFileSync(fx('p0c-eyeread-boxes.json'), 'utf8')).boxes
const hero = JSON.parse(readFileSync(fx('hero-word-bounds.json'), 'utf8')) as { recallThreshold: number; words: FixtureWord[]; span: string }

describe('P4 replay of fixtures/p0c-eyeread-boxes.json on p0033.jpg', () => {
  // block 1 is the recipe "No. 26": the same curator ordinal the real run uses
  const seg = segmentPage(page, { block: 1 })
  const { width: W, height: H } = seg.frame
  const tilt = seg.deskewApplied ? seg.deskewDeg : 0
  const preimage = (x: number, y: number) => rotatedPoint(x, y, tilt, W, H) // analysis pixel -> fixture frame
  const overlapCount = new Map<number, boolean>()

  for (const b of boxes) {
    it(`step ${b.step} box [${b.box.join(',')}]: P4 fails if and only if the box lights ink owned by a line outside its own`, () => {
      const [x0, y0, x1, y1] = b.box
      // the box rectangle over the page's ink, in the analysis frame
      const png: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4) }
      const linesLit = new Set<number>()
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const i = y * W + x
          if (!seg.ink[i]) continue
          const [ox, oy] = preimage(x, y)
          if (ox < x0 || ox >= x1 || oy < y0 || oy >= y1) continue
          png.data[i * 4 + 3] = 255
          linesLit.add(seg.own.owner[i]!)
        }
      // the box's own lines: those whose peak row (mapped to the fixture frame) lies inside the box
      const own = seg.lines.filter((l) => {
        const [, fy] = preimage((x0 + x1) / 2, l.peakRow)
        return fy >= y0 && fy < y1
      })
      const Q = own.map((l) => l.i)
      const neighbours = [...linesLit].filter((l) => !Q.includes(l))
      overlapCount.set(b.step, neighbours.length > 0)
      const r = checkP4({
        noteId: `p0c-step-${b.step}`, width: W, height: H, owner: seg.own.owner, pageInk: seg.pageInkMap, s: seg.slant.s,
        parts: Q.map((line) => ({ line, boundaries: null, fromWord: 0, toWord: 0, yMid: (seg.bands.cores[line]![0] + seg.bands.cores[line]![1]) / 2 })),
        png, pageBox: [0, 0, W, H],
      })
      if (neighbours.length) {
        expect(r.pass).toBe(false)
        expect(r.detail).toMatch(/ink owned by line/)
      } else expect(r.detail).not.toMatch(/owned by line/)
    })
  }
  it('five of the six boxes overlap a neighbouring line (measured: the step 6 box holds line 11 only)', () => {
    expect([...overlapCount.entries()].filter(([, v]) => v).map(([k]) => k)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('scoreAgainstFixture', () => {
  it('reads the threshold from the fixture, matches the words by text, and scores a synthetic mask', () => {
    expect(hero.recallThreshold).toBe(0.85)
    expect(matchFixtureWords('till it Looks red & smooth,', hero.words)).toBe(0)
    expect(matchFixtureWords('to the Quinces, & boil it till it Looks red & smooth,', hero.words)).toBe(6)
    expect(matchFixtureWords('till it Looks red smooth', hero.words)).toBeNull()
    const W = 40
    const raw = new Uint8Array(W * 20)
    for (let x = 2; x < 10; x++) raw[5 * W + x] = 1 // 8 raw px in box 0
    for (let x = 22; x < 26; x++) raw[5 * W + x] = 1 // 4 raw px in box 1
    const words: FixtureWord[] = [{ word: 'a', box: [0, 0, 12, 10] }, { word: 'b', box: [20, 0, 30, 10] }]
    const lit = (x: number, y: number) => y === 5 && (x < 6 || x === 22)
    const maskWords = [{ x: 2, y: 5, word: 0 }, { x: 3, y: 5, word: 0 }, { x: 15, y: 5, word: 0 }, { x: 22, y: 5, word: 1 }]
    const s = scoreAgainstFixture(raw, W, words, 0, lit, maskWords)
    expect(s.words[0]).toEqual({ word: 'a', recall: 4 / 8, precision: 2 / 3, rawPx: 8, maskPx: 3 })
    expect(scoreAgainstFixture(raw, W, words, 0, lit, []).words[0]!.precision).toBeNull()
    expect(s.words[1]).toEqual({ word: 'b', recall: 1 / 4, precision: 1, rawPx: 4, maskPx: 1 })
    expect(s.recall).toBeCloseTo(5 / 12, 12)
  })
})
