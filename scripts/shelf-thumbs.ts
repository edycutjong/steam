// Smaller copies of each catalogued page scan, for the shelf card only:
//   public/recipes/<id>/page-<w>.jpg   (w = 480, 800; page.jpg itself stays the 1601 px scan)
//
// Why: on a phone the shelf shows the scan about 160 css px wide, yet it loaded the whole 572 KB page.jpg,
// and that image was the page's largest contentful paint (Lighthouse mobile, 2026-11-27: LCP 5.27 s).
// The shelf now picks one of these by srcset; the edition's facsimile and every note crop are untouched.
//
// What these are, plainly: an area-average downscale of page.jpg (each output pixel is the mean of the scan pixels
// it covers), re-encoded as JPEG. No sharpening, no colour change, nothing drawn. `shelf-thumbs.test.ts` re-derives
// each copy from page.jpg and fails if a committed copy drifts from it. page.jpg is hash-pinned in gate.json; it is
// only read here.
//
//   node scripts/shelf-thumbs.ts          writes every recipe's copies
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import jpeg from 'jpeg-js'
import { SHELF_THUMB_WIDTHS } from '../src/data/shelfThumb.ts'

export const THUMB_WIDTHS = SHELF_THUMB_WIDTHS
export const THUMB_QUALITY = 80
export const RECIPES_DIR = 'public/recipes'

export interface Rgba {
  width: number
  height: number
  data: Uint8Array
}

/** Area-average downscale to `w` px wide (height keeps the aspect ratio, rounded). Exact box coverage, so no pixel is skipped. */
export function areaDownscale(src: Rgba, w: number): Rgba {
  const h = Math.max(1, Math.round((src.height * w) / src.width))
  const out = new Uint8Array(w * h * 4)
  const sx = src.width / w
  const sy = src.height / h
  for (let y = 0; y < h; y++) {
    const y0 = y * sy
    const y1 = y0 + sy
    for (let x = 0; x < w; x++) {
      const x0 = x * sx
      const x1 = x0 + sx
      let r = 0
      let g = 0
      let b = 0
      let area = 0
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy)
        if (wy <= 0) continue
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx)
          if (wx <= 0) continue
          const k = wx * wy
          const i = (yy * src.width + xx) * 4
          r += src.data[i] * k
          g += src.data[i + 1] * k
          b += src.data[i + 2] * k
          area += k
        }
      }
      const o = (y * w + x) * 4
      out[o] = Math.round(r / area)
      out[o + 1] = Math.round(g / area)
      out[o + 2] = Math.round(b / area)
      out[o + 3] = 255
    }
  }
  return { width: w, height: h, data: out }
}

export const thumbName = (w: number): string => `page-${w}.jpg`

export function decodeJpeg(bytes: Buffer): Rgba {
  const d = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
  return { width: d.width, height: d.height, data: d.data }
}

export function recipesWithScan(root = RECIPES_DIR): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'page.jpg')))
    .map((e) => e.name)
    .sort()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const id of recipesWithScan()) {
    const dir = join(RECIPES_DIR, id)
    const scan = decodeJpeg(readFileSync(join(dir, 'page.jpg')))
    for (const w of THUMB_WIDTHS) {
      const t = areaDownscale(scan, w)
      const enc = jpeg.encode({ width: t.width, height: t.height, data: Buffer.from(t.data) }, THUMB_QUALITY)
      writeFileSync(join(dir, thumbName(w)), enc.data)
      console.log(`${id}/${thumbName(w)} ${t.width}x${t.height} ${enc.data.length} B`)
    }
  }
}
