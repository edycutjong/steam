// Gzip budget for the code a visitor downloads (Quality workflow; `npm run budget` after `npm run build`).
//   app   : the JavaScript and CSS dist/index.html loads (the shelf, Cook Mode and the renderer are one bundle)
//   pages : the renderer bundle the landing page and the deck load beside the app (site/glass.js + site/glass.css),
//           and the two pages themselves (their CSS and scripts are inline); the judge page (inline CSS, no script, no renderer)
// Each budget is the size at the time it was set (2026-11-27, app bundle index-Bss4SLit.js) plus about 10 %: a new
// dependency or an accidental duplicate shows up as a red run, not as a slower first visit nobody measured.
//
//   node scripts/bundle-budget.ts [dist]     prints a table (and appends it to $GITHUB_STEP_SUMMARY), exit 1 over budget
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = path.resolve(process.argv[2] ?? 'dist')
const KB = 1024

interface Row { name: string; files: string[]; budget: number }

const index = readFileSync(path.join(DIST, 'index.html'), 'utf8')
const refs = (re: RegExp) => [...index.matchAll(re)].map((m) => m[1]!.replace(/^\//, ''))
const appJs = refs(/<script[^>]+src="(\/assets\/[^"]+\.js)"/g)
const appCss = refs(/<link[^>]+href="(\/assets\/[^"]+\.css)"/g)
if (appJs.length === 0 || appCss.length === 0) throw new Error('dist/index.html loads no /assets/*.js or /assets/*.css: is this a vite build?')

// The landing page and the deck add the renderer bundle at run time; fail loudly if they stop naming it, so the row is not stale.
for (const page of ['landing/index.html', 'deck/index.html']) {
  const html = readFileSync(path.join(DIST, page), 'utf8')
  for (const f of ['/site/glass.js', '/site/glass.css']) if (!html.includes(f)) throw new Error(`${page} no longer loads ${f}: update the pages row`)
}

const rows: Row[] = [
  { name: 'app JavaScript', files: appJs, budget: 156 * KB }, // 141.6 KiB when set
  { name: 'app CSS', files: appCss, budget: 8 * KB }, // 7.1 KiB
  { name: 'pages: renderer JavaScript', files: ['site/glass.js'], budget: 128 * KB }, // 116.3 KiB
  { name: 'pages: renderer CSS', files: ['site/glass.css'], budget: 3 * KB }, // 2.6 KiB
  { name: 'landing page (inline CSS + script)', files: ['landing/index.html'], budget: 21 * KB }, // 18.9 KiB
  { name: 'deck (inline CSS + script)', files: ['deck/index.html'], budget: 17 * KB }, // 15.3 KiB
  { name: 'judge page (inline CSS, no script)', files: ['judge/index.html'], budget: 17 * KB }, // 14.9 KiB
]

const fmt = (n: number) => `${(n / KB).toFixed(1)} KiB`
let over = 0
const lines = ['### Bundle budget (gzip -9)', '', '| what | files | raw | gzip | budget | result |', '|---|---|---:|---:|---:|---|']
for (const r of rows) {
  let raw = 0
  let gz = 0
  for (const f of r.files) {
    const p = path.join(DIST, f)
    if (!existsSync(p)) throw new Error(`missing ${p}`)
    const buf = readFileSync(p)
    raw += buf.length
    gz += gzipSync(buf, { level: 9 }).length
  }
  const ok = gz <= r.budget
  if (!ok) over++
  lines.push(`| ${r.name} | ${r.files.map((f) => '`' + f + '`').join(', ')} | ${fmt(raw)} | ${fmt(gz)} | ${fmt(r.budget)} | ${ok ? 'within' : '**OVER**'} |`)
}
const out = lines.join('\n') + '\n'
console.log(out)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out + '\n')
if (over) {
  console.error(`${over} budget(s) exceeded`)
  process.exit(1)
}
