// Frame capture helper: opens `/?t=<ms>` at a viewport, saves a PNG, and reads pixel statistics in Node.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import { heroUrl } from './hero.ts'

export interface Viewport {
  width: number
  height: number
  /** Pixel 5 style: touch device with a device scale factor. */
  mobile?: boolean
  deviceScaleFactor?: number
}

export const DESKTOP: Viewport = { width: 1280, height: 720 }
export const PIXEL5: Viewport = { width: 393, height: 851, mobile: true, deviceScaleFactor: 2.75 }

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface RegionStats {
  mean: number
  variance: number
  max: number
}

/** Rec. 709 luminance of one RGBA pixel, 0..255. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function decodePng(buf: Buffer): PNG {
  return PNG.sync.read(buf)
}

export function regionStats(png: PNG, region?: Region): RegionStats {
  const { x, y, w, h } = region ?? { x: 0, y: 0, w: png.width, h: png.height }
  let sum = 0
  let sum2 = 0
  let max = 0
  let n = 0
  for (let yy = y; yy < Math.min(png.height, y + h); yy++) {
    for (let xx = x; xx < Math.min(png.width, x + w); xx++) {
      const o = (yy * png.width + xx) * 4
      const l = luminance(png.data[o], png.data[o + 1], png.data[o + 2])
      sum += l
      sum2 += l * l
      if (l > max) max = l
      n++
    }
  }
  const mean = n ? sum / n : 0
  return { mean, variance: n ? sum2 / n - mean * mean : 0, max }
}

/** Opens the app at `baseUrl/?t=<ms>` (or no `t` when null), waits for the renderer, returns PNG bytes. */
export async function captureFrame(
  baseUrl: string,
  tMs: number | null,
  viewport: Viewport,
  outFile?: string,
): Promise<Buffer> {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  try {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
      isMobile: viewport.mobile ?? false,
      hasTouch: viewport.mobile ?? false,
    })
    const page = await context.newPage()
    await page.goto(`${baseUrl}${heroUrl(tMs === null ? '' : `?t=${tMs}`)}`)
    await page.locator('.steam-canvas').waitFor()
    await page.waitForTimeout(2400)
    const png = await page.screenshot({ type: 'png' })
    if (outFile) {
      await mkdir(path.dirname(outFile), { recursive: true })
      await writeFile(outFile, png)
    }
    return png
  } finally {
    await browser.close()
  }
}
