// The shelf's smaller scan copies are only a downscale of the hash-pinned page.jpg: re-derive each one and compare.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { areaDownscale, decodeJpeg, RECIPES_DIR, recipesWithScan, THUMB_WIDTHS, thumbName } from './shelf-thumbs.ts'

describe('shelf thumbnails (scripts/shelf-thumbs.ts)', () => {
  const ids = recipesWithScan()

  it('every recipe with a scan has every copy', () => {
    expect(ids.length).toBeGreaterThan(0)
  })

  for (const id of ids) {
    const dir = join(RECIPES_DIR, id)
    const scan = decodeJpeg(readFileSync(join(dir, 'page.jpg')))
    for (const w of THUMB_WIDTHS) {
      it(`${id}/${thumbName(w)} is the area-average downscale of page.jpg (JPEG noise only)`, () => {
        const got = decodeJpeg(readFileSync(join(dir, thumbName(w))))
        const want = areaDownscale(scan, w)
        expect([got.width, got.height]).toEqual([want.width, want.height])
        expect(Math.abs(got.width / got.height - scan.width / scan.height)).toBeLessThan(0.005)
        let sum = 0
        for (let i = 0; i < want.data.length; i += 4) for (let c = 0; c < 3; c++) sum += Math.abs(got.data[i + c] - want.data[i + c])
        const mad = sum / ((want.data.length / 4) * 3)
        // A q80 re-encode of the same pixels sits near 1-2 levels; a different image, or a resample of another page, is far above 6.
        expect(mad).toBeLessThan(6)
      })
    }
  }

  it('a copy of a different picture fails the comparison (control)', () => {
    const scan = decodeJpeg(readFileSync(join(RECIPES_DIR, ids[0], 'page.jpg')))
    const want = areaDownscale(scan, 480)
    const flipped = new Uint8Array(want.data.length)
    const rowBytes = want.width * 4
    for (let y = 0; y < want.height; y++) flipped.set(want.data.subarray(y * rowBytes, (y + 1) * rowBytes), (want.height - 1 - y) * rowBytes)
    let sum = 0
    for (let i = 0; i < want.data.length; i += 4) for (let c = 0; c < 3; c++) sum += Math.abs(flipped[i + c] - want.data[i + c])
    expect(sum / ((want.data.length / 4) * 3)).toBeGreaterThan(6)
  })
})
