import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { buildSplits } from './gaps.ts'
import { MIN_CORE_CSS_PX, computeLayout } from './layout.ts'

const dir = new URL('../../public/recipes/quinces-marmalade/', import.meta.url)
const meta = JSON.parse(readFileSync(new URL('note-till-it-looks-red-smooth.json', dir), 'utf8')) as Parameters<typeof computeLayout>[3]
const toi = PNG.sync.read(readFileSync(new URL('note-till-it-looks-red-smooth.toi.png', dir)))
const ink = new Uint8Array(toi.width * toi.height)
for (let p = 0; p < ink.length; p++) ink[p] = toi.data[p * 4]
const splits = buildSplits({ ink, toi: toi.data, width: toi.width, height: toi.height, groups: meta.groups })

// The glass of a Pixel 5 and of a 390 px phone (the e2e measures the same panes in the browser).
describe('phone composition uses the pane (R15.1, R15.2)', () => {
  for (const [w, h] of [[373, 494], [370, 494], [373, 440], [370, 520]] as const) {
    it(`${w} x ${h}: the ink block fills at least 55 % of the glass, sits a little above the middle, and keeps the core band`, () => {
      const l = computeLayout('groups', w, h, meta, splits)
      expect(l.fits).toBe(true)
      const top = Math.min(...l.groups.map((g) => g.inked[1]))
      const bottom = Math.max(...l.groups.map((g) => g.inked[3]))
      expect((bottom - top) / h).toBeGreaterThanOrEqual(0.55)
      const centre = (top + bottom) / 2
      expect(h / 2 - centre).toBeGreaterThanOrEqual(0.02 * h)
      expect(h / 2 - centre).toBeLessThanOrEqual(0.08 * h)
      for (const g of l.groups) {
        expect(g.coreBandCssPx).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
        expect(g.inked[0]).toBeGreaterThanOrEqual(12)
        expect(g.inked[2]).toBeLessThanOrEqual(w - 12)
      }
    })
  }
})
