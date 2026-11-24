// Renders the live steam pane into the static fallback images, for every displayable note of every catalogued recipe:
//   public/recipes/<id>/panes/<noteId>-{page,groups}-{fogged,held,wiped}.webp
// Fogged and held use the frozen clock (t=-1, t=5100), so they are reproducible.
// Wiped uses the live clock (the wipe cannot be frozen), captured once the sweep has finished.
// The pane is opened through the renderer harness route, #/pane/<id>/<noteId>, with its parameters in the hash query.
//
//   npm run static-panes                 writes to public/recipes/<id>/panes/
//   OUT_DIR=/tmp/panes npm run static-panes   writes <OUT_DIR>/<id>/ instead (for a look before committing)
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createServer } from 'vite'
import { displayableNotes } from '../src/data/provenance.ts'
import { Catalog, RecipeBundle } from '../src/data/schema.ts'
import { WIPE_MS, WRITE_ON_MS } from '../src/steam/timeline.ts'

const OUT_ROOT = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : null
const SCALE = 2
const HELD_T = WRITE_ON_MS + 100
const FOGGED_T = -1

const VIEWPORTS = [
  { kind: 'page', width: 1280, height: 800 },
  { kind: 'groups', width: 390, height: 844 },
] as const

async function canvasPng(page: Page): Promise<Buffer> {
  return page.locator('.steam-canvas').screenshot({ type: 'png' })
}

/** PNG bytes to WebP bytes, through a canvas in the browser (Playwright only writes PNG and JPEG). */
async function toWebp(page: Page, png: Buffer): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (b64: string) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    c.getContext('2d')!.drawImage(img, 0, 0)
    return c.toDataURL('image/webp', 0.92)
  }, png.toString('base64'))
  return Buffer.from(dataUrl.split(',')[1], 'base64')
}

async function waitForFrame(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.steam-canvas') !== null)
  // The renderer draws on rAF; a short settle covers asset load and the first frames.
  await page.waitForTimeout(1500)
}

async function targets(): Promise<{ id: string; noteId: string; dir: string }[]> {
  const catalog = Catalog.parse(JSON.parse(await readFile('content/catalog.json', 'utf8')))
  const out: { id: string; noteId: string; dir: string }[] = []
  for (const e of catalog) {
    const bundle = RecipeBundle.parse(JSON.parse(await readFile(`public/recipes/${e.id}/recipe.json`, 'utf8')))
    const dir = OUT_ROOT ? path.join(OUT_ROOT, e.id) : path.resolve(`public/recipes/${e.id}/panes`)
    for (const n of displayableNotes(bundle).notes) out.push({ id: e.id, noteId: n.id, dir })
  }
  return out
}

async function main(): Promise<void> {
  const all = await targets()
  const server = await createServer({ server: { port: 0 }, logLevel: 'error' })
  await server.listen()
  const base = server.resolvedUrls?.local[0]
  if (!base) throw new Error('vite did not report a local URL')
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  try {
    for (const target of all) {
      await mkdir(target.dir, { recursive: true })
      const route = `${base}#/pane/${target.id}/${target.noteId}`
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: SCALE,
          reducedMotion: 'no-preference',
        })
        const page = await ctx.newPage()
        const out: Array<[string, Buffer]> = []

        for (const [name, t] of [['fogged', FOGGED_T], ['held', HELD_T]] as const) {
          await page.goto(`${route}?t=${t}`)
          await page.reload()
          await waitForFrame(page)
          out.push([name, await toWebp(page, await canvasPng(page))])
        }

        await page.goto(`${route}?lead=0`)
        await page.reload()
        await waitForFrame(page)
        await page.getByRole('button', { name: 'Wipe the glass' }).waitFor({ timeout: WRITE_ON_MS + 15000 })
        await page.locator('.wipe-btn').click()
        await page.waitForTimeout(WIPE_MS + 400)
        out.push(['wiped', await toWebp(page, await canvasPng(page))])

        for (const [name, bytes] of out) {
          const file = path.join(target.dir, `${target.noteId}-${vp.kind}-${name}.webp`)
          await writeFile(file, bytes)
          console.log(`${path.relative(process.cwd(), file)}  ${bytes.length} bytes`)
        }
        await ctx.close()
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
