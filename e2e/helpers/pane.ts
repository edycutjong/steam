// Shared helpers for the steam-renderer specs: open the pane, screenshot it, read the layout it used.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { decodePng, luminance } from './capture.ts'
import type { Region } from './capture.ts'
import { HERO_DIR_FS, HERO_NOTE, heroUrl } from './hero.ts'

export const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  phone390: { width: 390, height: 844 },
  phone360: { width: 360, height: 800 },
} as const

/** Reference colours from the design tokens (src/index.css). The tests compare pixels against them. */
export const TOKENS = {
  ink: [0xef, 0xe7, 0xda],
  rule: [0x3a, 0x2d, 0x24],
  ghost: [0xbc, 0xd3, 0xe4],
} as const

export const INK_LUMINANCE = luminance(...TOKENS.ink)

export interface PaneLayout {
  kind: 'page' | 'groups'
  fits: boolean
  groups: Array<{
    index: number
    part?: number
    rect?: [number, number, number, number]
    dst: [number, number, number, number]
    inked: [number, number, number, number]
    scale: number
    coreBandCssPx: number
  }>
}

/** Opens the hero note's harness route with the query (`?t=2000&lead=0`, in the hash), waits for the renderer's first frame, and lets the frame settle. */
export async function openPane(page: Page, query = ''): Promise<void> {
  await page.goto(heroUrl(query))
  await page.locator('.steam-canvas').waitFor()
  await page.waitForFunction(() => performance.getEntriesByName('steam:first-frame').length > 0)
  await page.waitForTimeout(400)
}

export async function shot(page: Page): Promise<PNG> {
  return decodePng(await page.screenshot({ type: 'png' }))
}

export async function readLayout(page: Page): Promise<PaneLayout> {
  const raw = await page.locator('.steam-canvas').getAttribute('data-layout')
  if (!raw) throw new Error('canvas has no data-layout')
  return JSON.parse(raw) as PaneLayout
}

export async function canvasOrigin(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await page.locator('.steam-canvas').boundingBox()
  if (!box) throw new Error('canvas has no box')
  return { x: box.x, y: box.y, w: box.width, h: box.height }
}

/** Group destination rects in page (screenshot) pixels, integer, clipped to the image. */
export async function groupRegions(page: Page, png: PNG): Promise<Region[]> {
  const [layout, o] = await Promise.all([readLayout(page), canvasOrigin(page)])
  return layout.groups.map((g) => {
    const x = Math.max(0, Math.round(o.x + g.dst[0]))
    const y = Math.max(0, Math.round(o.y + g.dst[1]))
    const w = Math.min(png.width - x, Math.round(g.dst[2] - g.dst[0]))
    const h = Math.min(png.height - y, Math.round(g.dst[3] - g.dst[1]))
    return { x, y, w, h }
  })
}

export function pixel(png: PNG, x: number, y: number): [number, number, number] {
  const o = (Math.round(y) * png.width + Math.round(x)) * 4
  return [png.data[o], png.data[o + 1], png.data[o + 2]]
}

/** Mean luminance of a region. */
export function meanLum(png: PNG, r: Region): number {
  let s = 0
  let n = 0
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const [R, G, B] = pixel(png, x, y)
      s += luminance(R, G, B)
      n++
    }
  }
  return n ? s / n : 0
}

export interface Stats {
  mean: number
  variance: number
  /** max over pixels of (r - b); fog is blue-grey so this is negative, ember light is positive. */
  warmth: number
}

/** Box half-size of the local mean removed by `detailVariance`: strokes are a few px, fog drifts over hundreds. */
export const DETAIL_R = 4

/**
 * Variance of luminance minus its local (2 * DETAIL_R + 1)^2 mean, pooled over regions.
 * It measures stroke-scale detail and ignores the fog's slow shading across the pane,
 * so a wide group rect and narrow strips beside it are comparable (needed by the stacked desktop layout).
 */
export function detailVariance(png: PNG, regions: Region[]): number {
  let s2 = 0
  let n = 0
  for (const r of regions) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        let m = 0
        let k = 0
        for (let dy = -DETAIL_R; dy <= DETAIL_R; dy++) {
          for (let dx = -DETAIL_R; dx <= DETAIL_R; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < r.x || yy < r.y || xx >= r.x + r.w || yy >= r.y + r.h) continue
            m += lumAt(png, xx, yy)
            k++
          }
        }
        const d = lumAt(png, x, y) - m / k
        s2 += d * d
        n++
      }
    }
  }
  return n ? s2 / n : 0
}

/** Luminance mean and variance and the warmest pixel over a set of regions taken together. */
export function poolStats(png: PNG, regions: Region[]): Stats {
  let s = 0
  let s2 = 0
  let n = 0
  let warmth = -255
  for (const r of regions) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const [R, G, B] = pixel(png, x, y)
        const l = luminance(R, G, B)
        s += l
        s2 += l * l
        n++
        if (R - B > warmth) warmth = R - B
      }
    }
  }
  const mean = n ? s / n : 0
  return { mean, variance: n ? s2 / n - mean * mean : 0, warmth }
}

/** The canvas box in screenshot pixels, integer. */
export async function canvasRegion(page: Page): Promise<Region> {
  const o = await canvasOrigin(page)
  return { x: Math.ceil(o.x), y: Math.ceil(o.y), w: Math.floor(o.w) - 1, h: Math.floor(o.h) - 1 }
}

/** Fog beside a group on the same rows: strips of `depth` px left and right of the rect, inside `bounds`, clear of other groups. */
export function sideStrips(r: Region, others: Region[], bounds: Region, depth = 48): Region[] {
  const hits = (a: Region): boolean =>
    others.some((o) => o !== r && a.x < o.x + o.w && o.x < a.x + a.w && a.y < o.y + o.h && o.y < a.y + a.h)
  const x0 = Math.max(bounds.x, r.x - depth)
  const x1 = Math.min(bounds.x + bounds.w, r.x + r.w + depth)
  const left: Region = { x: x0, y: r.y, w: r.x - x0, h: r.h }
  const right: Region = { x: r.x + r.w, y: r.y, w: x1 - (r.x + r.w), h: r.h }
  return [left, right].filter((a) => a.w > 0 && !hits(a))
}

export interface Rect4 {
  x0: number
  y0: number
  x1: number
  y1: number
}

function lumAt(png: PNG, x: number, y: number): number {
  const [R, G, B] = pixel(png, x, y)
  return luminance(R, G, B)
}

/** Mean luminance of the columns/rows in a box, used for strip-to-strip steps. */
function boxMean(png: PNG, x0: number, y0: number, x1: number, y1: number): number {
  let s = 0
  let n = 0
  for (let y = Math.round(y0); y < Math.round(y1); y++) {
    for (let x = Math.round(x0); x < Math.round(x1); x++) {
      s += lumAt(png, x, y)
      n++
    }
  }
  return n ? s / n : 0
}

/** Step across a vertical edge at `x` over rows y0..y1: inside strip minus outside strip, `depth` px each. */
export function stepAcrossX(png: PNG, x: number, y0: number, y1: number, depth = 4): number {
  return Math.abs(boxMean(png, x, y0, x + depth, y1) - boxMean(png, x - depth, y0, x, y1))
}

export function stepAcrossY(png: PNG, y: number, x0: number, x1: number, depth = 4): number {
  return Math.abs(boxMean(png, x0, y, x1, y + depth) - boxMean(png, x0, y - depth, x1, y))
}

/** Largest step across the four edges of a rect (corners trimmed by `trim` px). */
export function rectEdgeStep(png: PNG, r: Rect4, trim = 8): number {
  return Math.max(
    stepAcrossX(png, r.x0, r.y0 + trim, r.y1 - trim),
    stepAcrossX(png, r.x1, r.y0 + trim, r.y1 - trim),
    stepAcrossY(png, r.y0, r.x0 + trim, r.x1 - trim),
    stepAcrossY(png, r.y1, r.x0 + trim, r.x1 - trim),
  )
}

/**
 * The largest step across a virtual edge placed in plain fog: boxes of `box` px clear of every group
 * (and of the canvas edge tint), each tested with a vertical and a horizontal edge through its centre.
 */
export function baselineEdgeStep(png: PNG, bounds: Region, groups: Region[], box = 48): number {
  const inset = Math.round(0.1 * Math.min(bounds.w, bounds.h))
  let worst = 0
  let boxes = 0
  for (let y = bounds.y + inset; y + box <= bounds.y + bounds.h - inset; y += box / 2) {
    for (let x = bounds.x + inset; x + box <= bounds.x + bounds.w - inset; x += box / 2) {
      const clear = groups.every((g) => x + box < g.x - 8 || g.x + g.w + 8 < x || y + box < g.y - 8 || g.y + g.h + 8 < y)
      if (!clear) continue
      boxes++
      const cx = x + box / 2
      const cy = y + box / 2
      worst = Math.max(worst, stepAcrossX(png, cx, y + 4, y + box - 4), stepAcrossY(png, cy, x + 4, x + box - 4))
    }
  }
  if (boxes < 3) throw new Error(`only ${boxes} clear fog boxes for the baseline`)
  return worst
}

interface HeroMeta {
  groups: Array<{ rect: [number, number, number, number] }>
}

/**
 * Screen pixels that lie on the writer's ink: every note pixel with alpha above 200 inside a group rect,
 * mapped through the layout the page reports. Read from the scan's own alpha, not from a screenshot.
 */
export async function channelPixels(page: Page): Promise<Array<[number, number]>> {
  const note = PNG.sync.read(await readFile(path.join(HERO_DIR_FS, `note-${HERO_NOTE}.png`)))
  const meta = JSON.parse(await readFile(path.join(HERO_DIR_FS, `note-${HERO_NOTE}.json`), 'utf8')) as HeroMeta
  const [layout, o] = await Promise.all([readLayout(page), canvasOrigin(page)])
  const seen = new Set<number>()
  const out: Array<[number, number]> = []
  for (const g of layout.groups) {
    const [rx0, ry0, rx1, ry1] = g.rect ?? meta.groups[g.index].rect
    for (let ny = ry0; ny < ry1; ny++) {
      for (let nx = rx0; nx < rx1; nx++) {
        if (note.data[(ny * note.width + nx) * 4 + 3] <= 200) continue
        const x = Math.round(o.x + g.inked[0] + (nx - rx0 + 0.5) * g.scale)
        const y = Math.round(o.y + g.inked[1] + (ny - ry0 + 0.5) * g.scale)
        const key = y * 100000 + x
        if (seen.has(key)) continue
        seen.add(key)
        out.push([x, y])
      }
    }
  }
  return out
}

/** Mean luminance over a set of screen pixels. */
export function meanLumAt(png: PNG, pts: Array<[number, number]>): number {
  let s = 0
  for (const [x, y] of pts) s += lumAt(png, x, y)
  return pts.length ? s / pts.length : 0
}
