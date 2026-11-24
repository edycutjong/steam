import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { verifyRegion, verifyUrl } from './bundle.ts'

const service = 'https://iiif.wellcomecollection.org/image/b18419665_0033.jp2'
const frame = { width: 1601, height: 2052 }

describe('verifyUrl (R23.3, R23.4)', () => {
  it('gives pct:x,y,w,h with four decimals from the pageBox over the page frame', () => {
    const r = verifyUrl({ imageService: service, pageBox: [288, 1613, 1532, 1778], frame })
    expect(r.approximate).toBe(false)
    expect(r.url).toBe(`${service}/pct:${(288 / 1601 * 100).toFixed(4)},${(1613 / 2052 * 100).toFixed(4)},${((1532 - 288) / 1601 * 100).toFixed(4)},${((1778 - 1613) / 2052 * 100).toFixed(4)}/full/0/default.jpg`)
    expect(r.url).toMatch(/\/pct:\d+\.\d{4},\d+\.\d{4},\d+\.\d{4},\d+\.\d{4}\/full\/0\/default\.jpg$/)
  })
  it('is the same link for a 1600 px and a 3200 px download of the same page', () => {
    const a = verifyUrl({ imageService: service, pageBox: [320, 1600, 1536, 1792], frame: { width: 1600, height: 2048 } })
    const b = verifyUrl({ imageService: service, pageBox: [640, 3200, 3072, 3584], frame: { width: 3200, height: 4096 } })
    expect(a.url).toBe(b.url)
  })
  it('clips to the page and keeps width and height positive', () => {
    const r = verifyUrl({ imageService: service, pageBox: [-5, -5, 2000, 3000], frame })
    expect(r.url).toContain('/pct:0.0000,0.0000,100.0000,100.0000/')
  })
  it('is approximate when a deskew was applied, and covers the mapped-back rectangle', () => {
    const plain = verifyUrl({ imageService: service, pageBox: [400, 1000, 900, 1100], frame })
    const r = verifyUrl({ imageService: service, pageBox: [400, 1000, 900, 1100], frame, deskewDeg: 1.5, deskewApplied: true })
    expect(r.approximate).toBe(true)
    const num = (u: string) => u.match(/pct:([\d.]+),([\d.]+),([\d.]+),([\d.]+)/)!.slice(1).map(Number)
    const [px, , pw, ph] = num(plain.url)
    const [x, , w, h] = num(r.url)
    expect(w).toBeGreaterThan(pw! - 1e-9)
    expect(h).toBeGreaterThan(ph!)
    expect(x).toBeLessThanOrEqual(px! + 1)
  })
  it('is not approximate when the deskew was recorded but not applied', () => {
    expect(verifyUrl({ imageService: service, pageBox: [1, 2, 30, 40], frame, deskewDeg: 0.2, deskewApplied: false }).approximate).toBe(false)
  })
})

describe('verifyRegion (R21.2, R21.3)', () => {
  const bundle = JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8'))
  const lines = JSON.parse(readFileSync('content/recipes/quinces-marmalade/lines.json', 'utf8'))
  it('reproduces the three committed verifyUrl strings from the committed pageBox, frame and deskew', () => {
    expect(lines.frame).toEqual({ width: 1601, height: 2052 })
    expect(lines.deskewDeg).toBe(1.6)
    for (const n of bundle.notes) {
      const r = verifyUrl({ imageService: bundle.source.imageService, pageBox: n.pageBox, frame: lines.frame, deskewDeg: lines.deskewDeg, deskewApplied: lines.deskewApplied })
      expect(r.url).toBe(n.verifyUrl)
      expect(r.approximate).toBe(n.verifyApproximate)
    }
  })
  it('the percentage URL is the percentage form of the box, 4 decimals', () => {
    const i = { imageService: service, pageBox: [288, 1613, 1532, 1778] as [number, number, number, number], frame, deskewDeg: 1.6, deskewApplied: true }
    const { box } = verifyRegion(i)
    const [x, y, w, h] = [box[0] / 1601, box[1] / 2052, box[2] / 1601, box[3] / 2052].map((v) => (v * 100).toFixed(4))
    expect(verifyUrl(i).url).toBe(`${service}/pct:${x},${y},${w},${h}/full/0/default.jpg`)
  })
  it('clips the box to the frame', () => {
    const { box } = verifyRegion({ pageBox: [-5, -5, 2000, 3000], frame })
    expect(box).toEqual([0, 0, 1601, 2052])
  })
  it('with no deskew the box equals pageBox as [x, y, w, h]', () => {
    expect(verifyRegion({ pageBox: [288, 1613, 1532, 1778], frame })).toEqual({ box: [288, 1613, 1244, 165], approximate: false })
  })
})
