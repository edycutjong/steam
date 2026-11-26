// Post-deploy smoke test of the live site (Deploy workflow; `npm run smoke:live [base]` by hand).
//  1. HTTP: /, /landing/, /deck/, the README's hero deep link, and every file that link loads answer 200 with the right type.
//  2. The served index.html names the app bundle this build produced (EXPECT_BUNDLE), so the alias points at the new deploy.
//  3. Browser: the hero deep link, opened fresh in Chromium (software GL, as in e2e/), reaches cook:ready, reveals the note
//     by itself after the 6 s lead-in, and ends on "The hand, quoted". The fragment never reaches the server, so only a
//     browser can check the deep link itself.
// Writes a Markdown table to stdout and $GITHUB_STEP_SUMMARY; exit 1 on any failure.
import { appendFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const BASE = (process.argv[2] ?? process.env.SMOKE_BASE ?? 'https://steam.edycu.dev').replace(/\/$/, '')
const HERO = 'till-it-looks-red-smooth'
const DEEP_LINK = `/#/r/quinces-marmalade/cook?note=${HERO}&pace=12&lead=6`
const RECIPE = '/recipes/quinces-marmalade'

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = []
const record = (name: string, pass: boolean, detail: string) => {
  checks.push({ name, pass, detail })
  console.log(`${pass ? 'pass' : 'FAIL'}  ${name}  ${detail}`)
}

async function get(path: string, attempts = 4): Promise<Response> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(BASE + path, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } })
    } catch (e) {
      last = e
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)))
    }
  }
  throw last
}

async function http(path: string, type: RegExp): Promise<string> {
  try {
    const r = await get(path)
    const ct = r.headers.get('content-type') ?? ''
    const body = await r.text()
    record(`GET ${path}`, r.status === 200 && type.test(ct), `${r.status} ${ct.split(';')[0]}`)
    return body
  } catch (e) {
    record(`GET ${path}`, false, String(e))
    return ''
  }
}

const index = await http('/', /text\/html/)
await http('/landing/', /text\/html/)
await http('/deck/', /text\/html/)
await http(DEEP_LINK, /text\/html/) // the server sees '/', the fragment is the client's
const bundle = index.match(/\/assets\/(index-[\w-]+\.js)/)?.[1]
const expected = process.env.EXPECT_BUNDLE
record('index.html names the app bundle', !!bundle && (!expected || bundle === expected), `${bundle ?? 'none'}${expected ? ` (built: ${expected})` : ''}`)
if (bundle) await http(`/assets/${bundle}`, /javascript/)
await http('/sw.js', /javascript/)
await http(`${RECIPE}/recipe.json`, /json/)
for (const ext of ['json', 'png', 'toi.png']) await http(`${RECIPE}/note-${HERO}.${ext}`, ext === 'json' ? /json/ : /image\/png/)
await http(`${RECIPE}/page.jpg`, /image\/jpeg/)

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const t0 = Date.now()
  await page.goto(BASE + DEEP_LINK, { waitUntil: 'load' })
  const mark = async (name: string, timeout = 30_000) => {
    try {
      await page.waitForFunction((n) => performance.getEntriesByName(n).length > 0, name, { timeout })
      const at = await page.evaluate((n) => performance.getEntriesByName(n)[0]!.startTime, name)
      record(`deep link: ${name}`, true, `${(at / 1000).toFixed(1)} s after navigation`)
      return at
    } catch {
      record(`deep link: ${name}`, false, `not reached within ${timeout / 1000} s`)
      return null
    }
  }
  await mark('cook:ready')
  await mark(`cook:reveal:${HERO}`)
  const step = await page.locator('main.cook').getAttribute('data-step')
  record('deep link: Cook Mode on the hero step', step === '5', `data-step=${step}`)
  try {
    await page.locator('button.wipe', { hasText: 'The hand, quoted' }).waitFor({ timeout: 30_000 })
    record('deep link: ends on "The hand, quoted"', true, `${((Date.now() - t0) / 1000).toFixed(1)} s wall time`)
  } catch {
    record('deep link: ends on "The hand, quoted"', false, `control text: ${await page.locator('button.wipe').innerText().catch(() => '?')}`)
  }
  record('deep link: no uncaught page errors', errors.length === 0, errors.length ? errors.join(' | ').slice(0, 300) : 'none')
} finally {
  await browser.close()
}

const failed = checks.filter((c) => !c.pass).length
const md = [`### Live smoke test: ${checks.length - failed}/${checks.length} on ${BASE}`, '', '| result | check | detail |', '|---|---|---|',
  ...checks.map((c) => `| ${c.pass ? 'pass' : '**FAIL**'} | ${c.name.replace(/\|/g, '/')} | ${c.detail.replace(/\|/g, '/')} |`)].join('\n') + '\n'
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n')
if (failed) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
