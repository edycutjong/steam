import { describe, expect, it } from 'vitest'
import { crop, pixelSha256, resampleArea, rotate, scaleOf, toGray, type Gray, type Rgba } from './image.ts'

const rgba = (w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Rgba => {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4)
  return { width: w, height: h, data }
}
const gray = (w: number, h: number, f: (x: number, y: number) => number): Gray => {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = f(x, y)
  return { width: w, height: h, data }
}

describe('toGray', () => {
  it('uses (299R + 587G + 114B + 500) / 1000 rounded down', () => {
    const img = rgba(4, 1, (x) => [[0, 0, 0, 255], [255, 255, 255, 255], [255, 0, 0, 255], [10, 200, 30, 255]][x] as [number, number, number, number])
    expect([...toGray(img).data]).toEqual([0, 255, Math.floor((299 * 255 + 500) / 1000), Math.floor((2990 + 117400 + 3420 + 500) / 1000)])
  })
})

describe('crop', () => {
  it('copies the window, gray and rgba', () => {
    const g = gray(5, 4, (x, y) => x + 10 * y)
    const c = crop(g, 1, 1, 4, 3)
    expect([c.width, c.height]).toEqual([3, 2])
    expect([...c.data]).toEqual([11, 12, 13, 21, 22, 23])
    const r = rgba(3, 2, (x, y) => [x, y, 0, 255])
    expect([...crop(r, 2, 0, 3, 2).data]).toEqual([2, 0, 0, 255, 2, 1, 0, 255])
  })
})

describe('resampleArea', () => {
  it('keeps a constant constant under 2x downscale', () => {
    const r = resampleArea(gray(8, 8, () => 77), 4, 4)
    expect(new Set(r.data)).toEqual(new Set([77]))
  })
  it('turns a checker into mid gray', () => {
    const r = resampleArea(gray(8, 8, (x, y) => ((x + y) & 1 ? 255 : 0)), 4, 4)
    for (const v of r.data) expect(Math.abs(v - 127.5)).toBeLessThanOrEqual(1)
  })
  it('is the identity at the same size and handles rgba', () => {
    const g = gray(3, 3, (x, y) => x * 40 + y)
    expect(resampleArea(g, 3, 3).data).toEqual(g.data)
    const r = rgba(2, 2, () => [10, 20, 30, 255])
    expect([...resampleArea(r, 1, 1).data]).toEqual([10, 20, 30, 255])
  })
  it('handles non-integer ratios without leaving the value range', () => {
    const r = resampleArea(gray(7, 5, (x) => (x % 2 ? 255 : 0)), 3, 2)
    for (const v of r.data) expect(v >= 0 && v <= 255).toBe(true)
  })
})

describe('scaleOf', () => {
  it('is frame width over 1600', () => {
    expect(scaleOf({ width: 1600 })).toBe(1)
    expect(scaleOf({ width: 1601 })).toBeCloseTo(1.000625, 6)
    expect(scaleOf({ width: 3200 })).toBe(2)
  })
})

describe('pixelSha256', () => {
  const a = rgba(2, 2, (x, y) => [x * 50, y * 50, 9, 255])
  it('depends on the pixels and the size, nothing else', () => {
    const h = pixelSha256(a)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(pixelSha256({ ...a, data: a.data.slice() })).toBe(h)
    const b = { ...a, data: a.data.slice() }
    b.data[5] ^= 1
    expect(pixelSha256(b)).not.toBe(h)
    expect(pixelSha256({ width: 4, height: 1, data: a.data })).not.toBe(h)
  })
})

describe('rotate', () => {
  it('by 0 degrees is the identity', () => {
    const g = gray(9, 7, (x, y) => (x * 31 + y * 17) & 255)
    expect(rotate(g, 0).data).toEqual(g.data)
  })
  it('turns a horizontal bar into a line that descends to the right for positive degrees', () => {
    const g = gray(201, 201, (_x, y) => (y === 100 ? 0 : 255))
    const r = rotate(g, 10)
    const rowOf = (x: number) => {
      let best = 0
      for (let y = 0; y < r.height; y++) if (r.data[y * r.width + x]! < r.data[best * r.width + x]!) best = y
      return best
    }
    expect(rowOf(150)).toBeGreaterThan(rowOf(50))
    expect((rowOf(150) - rowOf(50)) / 100).toBeCloseTo(Math.tan((10 * Math.PI) / 180), 1)
  })
})
