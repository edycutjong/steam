// The judge's path, measured once on `vite preview` (production build): open the deep link cold and time
// navigation -> interactive (cook:ready: the first pane drawn and the Wipe control focused) and interactive -> reveal start
// (cook:reveal:<hero>, the reveal effect applied with no input). Then fetches the hero's "verify at source" URL with curl.
// Writes docs/kiro-evidence/cook-mode/judge-path.json.
//
//   npm run build && node scripts/measure-judge-path.ts
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { preview } from 'vite'

const DEEP = '/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12'
const OUT = path.resolve('docs/kiro-evidence/cook-mode/judge-path.json')

async function main() {
  const server = await preview({ preview: { port: 4173, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' })
  const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!base) throw new Error('vite preview did not report a URL')
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  let timing
  let verifyHref: string | null
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    const t0 = Date.now()
    await page.goto(`${base}${DEEP}`)
    await page.locator('main.cook[data-ready="true"]').waitFor({ timeout: 60_000 })
    const tReadyWall = Date.now() - t0
    await page.waitForFunction(() => performance.getEntriesByName('cook:reveal:till-it-looks-red-smooth').length > 0, null, { timeout: 60_000 })
    const tRevealWall = Date.now() - t0
    const m = await page.evaluate(() => {
      const t = (n: string) => performance.getEntriesByName(n)[0]?.startTime ?? null
      return { ready: t('cook:ready'), reveal: t('cook:reveal:till-it-looks-red-smooth'), writeOn: t('cook:write-on:till-it-looks-red-smooth'), focused: document.activeElement?.className ?? null }
    })
    timing = {
      navigationToInteractiveMs: Math.round(m.ready!),
      interactiveToRevealStartMs: Math.round(m.reveal! - m.ready!),
      navigationToRevealStartMs: Math.round(m.reveal!),
      writeOnStartMs: m.writeOn === null ? null : Math.round(m.writeOn),
      focusedAtInteractive: m.focused,
      playwrightWallClock: { gotoToDataReadyMs: tReadyWall, gotoToRevealMarkMs: tRevealWall },
    }
    await page.goto(`${base}/#/r/quinces-marmalade/quoted`)
    await page.reload()
    verifyHref = await page.locator('.quote[data-note="till-it-looks-red-smooth"] a.verify').getAttribute('href')
  } finally {
    await browser.close()
    await server.close()
  }
  if (!verifyHref) throw new Error('no verify link on the quoted screen')
  const curlArgs = ['-sS', '-o', '/dev/null', '-w', '%{http_code} %{content_type} %{size_download}', verifyHref]
  const [status, contentType, bytes] = execFileSync('curl', curlArgs, { encoding: 'utf8' }).trim().split(' ')
  const bundle = JSON.parse(await readFile('public/recipes/quinces-marmalade/recipe.json', 'utf8'))
  const report = {
    generatedAt: new Date().toISOString(),
    command: 'npm run build && node scripts/measure-judge-path.ts',
    server: 'vite preview (production build in dist/)',
    browser: `Chromium (Playwright), 1280x800, --use-angle=swiftshader`,
    machine: { cpu: os.cpus()[0]?.model ?? 'unknown', loadAverage: os.loadavg().map((x) => Number(x.toFixed(2))) },
    url: DEEP,
    definitions: {
      navigation: 'performance.timeOrigin of the page (the deep link opened cold)',
      interactive: 'performance mark cook:ready: the first pane has drawn its first frame and the Wipe control has focus',
      revealStart: 'performance mark cook:reveal:till-it-looks-red-smooth: the reveal effect applied, with no input',
      lead: 'default 10 s hold from session start (R19.3)',
    },
    timing,
    verifyAtSource: {
      note: 'till-it-looks-red-smooth',
      url: verifyHref,
      curl: `curl ${curlArgs.slice(0, -1).join(' ')} <url>`,
      httpStatus: Number(status),
      contentType,
      bytes: Number(bytes),
      host: new URL(verifyHref).host,
      imageService: bundle.source.imageService,
    },
  }
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
}
main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
