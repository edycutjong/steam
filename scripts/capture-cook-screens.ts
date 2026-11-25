// Screenshots of the flow for docs/kiro-evidence/cook-mode/screens/, on the production build:
// shelf, edition, Cook Mode before the reveal, Cook Mode at the held reveal, "The hand, quoted"; desktop 1280x800 and Pixel 5.
//
//   npm run build && node scripts/capture-cook-screens.ts
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium, devices, type BrowserContextOptions } from '@playwright/test'
import { preview } from 'vite'

const OUT = path.resolve('docs/kiro-evidence/cook-mode/screens')
const DEEP = '/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12'
const PROFILES: [string, BrowserContextOptions][] = [
  ['desktop', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }],
  ['pixel5', { ...devices['Pixel 5'] }],
]

async function main() {
  await mkdir(OUT, { recursive: true })
  const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
  const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!base) throw new Error('vite preview did not report a URL')
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  try {
    for (const [name, opts] of PROFILES) {
      const ctx = await browser.newContext(opts)
      const page = await ctx.newPage()
      const shot = async (what: string) => {
        await page.mouse.move(0, 0)
        await page.screenshot({ path: path.join(OUT, `${name}-${what}.png`) })
        console.log(`${name}-${what}.png`)
      }
      const open = async (hash: string) => {
        await page.goto(`${base}${hash}`)
        await page.reload()
      }
      await open('/#/')
      await page.locator('.shelf__item img').evaluate((i) => (i as HTMLImageElement).decode())
      await page.waitForTimeout(400)
      await shot('1-shelf')
      await open('/#/r/quinces-marmalade')
      await page.locator('.facsimile img').evaluate((i) => (i as HTMLImageElement).decode())
      await page.waitForTimeout(400)
      await shot('2-edition')
      await open(DEEP)
      await page.locator('main.cook[data-ready="true"]').waitFor({ timeout: 60_000 })
      await page.waitForTimeout(1500)
      await shot('3-cook-before-reveal')
      await page.locator('main.cook[data-note-state="held"]').waitFor({ timeout: 60_000 })
      await page.waitForTimeout(1200)
      await shot('4-cook-held-reveal')
      await open('/#/r/quinces-marmalade/quoted')
      for (const i of await page.locator('.quote img').all()) await i.evaluate((e) => (e as HTMLImageElement).decode())
      await page.waitForTimeout(400)
      await shot('5-quoted')
      await ctx.close()
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
