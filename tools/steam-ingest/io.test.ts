import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { pixelSha256 } from '../../src/ingest/image.ts'
import { canonicalJson, decodeJpeg, decodePng, encodePng, fileSha256, readPage, writeJson, writePng } from './io.ts'

const dir = mkdtempSync(join(tmpdir(), 'steam-io-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const fixture = new URL('../../fixtures/p0033.jpg', import.meta.url)

describe('canonical JSON (R9.5)', () => {
  it('sorts keys at every depth, two-space indent, trailing newline, stable bytes', () => {
    const a = canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })
    expect(a).toBe('{\n  "a": {\n    "c": null,\n    "d": [\n      3,\n      {\n        "y": 2,\n        "z": 1\n      }\n    ]\n  },\n  "b": 1\n}\n')
    expect(canonicalJson({ a: { c: null, d: [3, { y: 2, z: 1 }] }, b: 1 })).toBe(a)
    expect(canonicalJson({ x: undefined, y: 1 })).toBe('{\n  "y": 1\n}\n')
  })
  it('writeJson writes the canonical bytes and creates folders', () => {
    const p = join(dir, 'deep', 'x.json')
    writeJson(p, { b: 2, a: 1 })
    expect(readFileSync(p, 'utf8')).toBe('{\n  "a": 1,\n  "b": 2\n}\n')
  })
})

describe('images', () => {
  it('decodes fixtures/p0033.jpg to 1601x2052 with a stable pixel hash', () => {
    const img = decodeJpeg(readFileSync(fixture))
    expect([img.width, img.height]).toEqual([1601, 2052])
    // recorded on the first run of this test (jpeg-js, RGBA); a change means the decoder or the fixture changed
    expect(pixelSha256(img)).toBe('a9376de8f315bf3b461f31e4ad231550e83a2ee173b29240f32e45a82ee32862')
  })
  it('a PNG round trip keeps the pixel hash', () => {
    const img = { width: 3, height: 2, data: Uint8Array.from({ length: 24 }, (_, i) => (i * 37) & 255) }
    const p = join(dir, 'a.png')
    writePng(p, img)
    expect(pixelSha256(decodePng(readFileSync(p)))).toBe(pixelSha256(img))
    expect(pixelSha256(decodePng(encodePng(img)))).toBe(pixelSha256(img))
    expect(fileSha256(p)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('readPage resamples a page of another size to the fixture frame and records the frame (R2.4)', () => {
    const big = { width: 8, height: 4, data: new Uint8Array(8 * 4 * 4).fill(200) }
    const r = readPage(big, { width: 4, height: 2 })
    expect([r.scan.width, r.scan.height]).toEqual([4, 2])
    expect(r.frame).toEqual({ width: 4, height: 2, scaleX: 2, scaleY: 2 })
    const same = readPage(big, { width: 8, height: 4 })
    expect(same.frame).toBeUndefined()
    expect(same.scan).toBe(big)
  })
})
