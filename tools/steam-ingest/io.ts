// File and image io for the CLI: canonical JSON, JPEG (jpeg-js) and PNG (pngjs), file hashes. No native dependency (R2.2).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { canonicalJson } from '../../src/ingest/canon.ts'
import { resampleArea, type Rgba } from '../../src/ingest/image.ts'

export { canonicalJson }

export function ensureDir(p: string): void {
  mkdirSync(dirname(p), { recursive: true })
}

export function writeJson(p: string, v: unknown): void {
  ensureDir(p)
  writeFileSync(p, canonicalJson(v))
}

export function readText(p: string): string | undefined {
  return existsSync(p) ? readFileSync(p, 'utf8') : undefined
}

export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex')
export const fileSha256 = (p: string): string => sha256(readFileSync(p))

export function decodeJpeg(bytes: Uint8Array): Rgba {
  const j = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 })
  return { width: j.width, height: j.height, data: new Uint8Array(j.data.buffer, j.data.byteOffset, j.data.byteLength) }
}

export function decodePng(bytes: Uint8Array): Rgba {
  const p = PNG.sync.read(Buffer.from(bytes))
  return { width: p.width, height: p.height, data: new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength) }
}

export function encodePng(img: Rgba): Uint8Array {
  const p = new PNG({ width: img.width, height: img.height })
  p.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  return PNG.sync.write(p, { colorType: 6 })
}

export function writePng(path: string, img: Rgba): void {
  ensureDir(path)
  writeFileSync(path, encodePng(img))
}

/** R2.3, R2.4: the page in the fixture frame (area resampled when its size differs), with the frame recorded then. */
export function readPage(scan: Rgba, fixtureFrame?: { width: number; height: number }): { scan: Rgba; frame?: { width: number; height: number; scaleX: number; scaleY: number } } {
  if (!fixtureFrame || (scan.width === fixtureFrame.width && scan.height === fixtureFrame.height)) return { scan }
  return {
    scan: resampleArea(scan, fixtureFrame.width, fixtureFrame.height),
    frame: { width: fixtureFrame.width, height: fixtureFrame.height, scaleX: scan.width / fixtureFrame.width, scaleY: scan.height / fixtureFrame.height },
  }
}
