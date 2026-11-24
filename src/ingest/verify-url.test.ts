import { describe, expect, it } from 'vitest'
import { verifyUrl } from './bundle.ts'

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
