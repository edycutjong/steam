import { describe, expect, it } from 'vitest'
import { labelComponents } from './components.ts'
import type { Rgba } from './image.ts'
import { LINE_TINTS, ownership, renderFlagCrop, renderOverlay, splitsJson, type Bands } from './masks.ts'

const bands: Bands = { cores: [[10, 20], [40, 50]], valleys: [30] }
const W = 70
const H = 70
function scene() {
  const ink = new Uint8Array(W * H)
  for (let y = 12; y <= 48; y++) ink[y * W + 8] = 1 // joined stroke, split at row 30
  for (let x = 30; x < 50; x++) for (let y = 12; y < 16; y++) ink[y * W + x] = 1 // plain
  const labels = labelComponents(ink, W, H)
  const scan: Rgba = { width: W, height: H, data: new Uint8Array(W * H * 4).fill(230) }
  return { ink, labels, scan, own: ownership(labels, bands), joined: 12 * W + 8 }
}

describe('splits.json entries', () => {
  it('hold id, rows, valley rows, lines and pixel counts, sorted by id', () => {
    const s = scene()
    expect(splitsJson(s.own)).toEqual([{ componentId: s.joined, rows: [12, 48], valleyRows: [30], lines: [0, 1], pixelsPerLine: [18, 19], totalPixels: 37 }])
  })
})

describe('renderOverlay', () => {
  it('has the page size, tints owned ink per line and marks the split row', () => {
    const s = scene()
    const o = renderOverlay(s.scan, s.own, s.labels, bands)
    expect([o.width, o.height]).toEqual([W, H])
    const px = (x: number, y: number) => [...o.data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)]
    expect(px(8, 20)).toEqual(LINE_TINTS[0])
    expect(px(8, 45)).toEqual(LINE_TINTS[1])
    expect(px(40, 13)).toEqual(LINE_TINTS[0])
    expect(px(0, 0)).not.toEqual(LINE_TINTS[0])
    expect(px(8, 30)).not.toEqual(LINE_TINTS[1]) // the split row is marked
    expect(o.data[3]).toBe(255)
  })
})

describe('renderFlagCrop', () => {
  it('crops around the component with a margin and draws the valley and core edges', () => {
    const s = scene()
    const f = renderFlagCrop(s.scan, s.own, s.labels, bands, s.joined, 10)
    expect(f.rect).toEqual([0, 2, 19, 59])
    expect(f.image.width).toBe(19)
    expect(f.image.height).toBe(57)
    const at = (x: number, y: number) => [...f.image.data.subarray((y * f.image.width + x) * 4, (y * f.image.width + x) * 4 + 3)]
    expect(at(8, 45 - 2)).toEqual(LINE_TINTS[1])
    expect(at(0, 30 - 2)).not.toEqual([230, 230, 230]) // valley row drawn across the crop
  })
  it('throws for an unknown component', () => {
    const s = scene()
    expect(() => renderFlagCrop(s.scan, s.own, s.labels, bands, 5, 10)).toThrow(/unknown component/)
  })
})
