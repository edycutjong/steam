// Measures Cook Mode on the deep-link path in a production build (R26.2): every requestAnimationFrame interval over the lead-in,
// the write-on and the hold (15 s from cook:ready), and the times from navigation to cook:ready and to the reveal.
// Writes bench/cook.json first, then exits 1 when a profile misses 55 fps mean or has a frame over 18.2 ms.
//
//   npm run bench:cook
import { mkdir, writeFile, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { preview } from 'vite'
import { CookBench, frameStats, MIN_FPS, pass, SLOW_MS } from './cook-stats.ts'

const URL_PATH = '/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=3&fps=1'
const RECORD_MS = Number(process.env.BENCH_MS ?? 15000)
const OUT = path.resolve('bench/cook.json')
const PROFILES = [
  { name: 'desktop-1280x720', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1 },
  { name: 'pixel5-4x-cpu', viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, mobile: true, cpuThrottle: 4 },
]

async function measure(browser: Browser, base: string, p: (typeof PROFILES)[number]) {
  const context = await browser.newContext({ viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor, isMobile: p.mobile, hasTouch: p.mobile })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpuThrottle })
  await page.goto(`${base}${URL_PATH}`)
  await page.waitForFunction(() => performance.getEntriesByName('cook:ready').length > 0, null, { timeout: 60_000 })
  const intervals = await page.evaluate(
    (ms: number) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = []
        let last = -1
        let start = -1
        const tick = (now: number) => {
          if (start < 0) start = now
          if (last >= 0) out.push(now - last)
          last = now
          if (now - start < ms) requestAnimationFrame(tick)
          else resolve(out)
        }
        requestAnimationFrame(tick)
      }),
    RECORD_MS,
  )
  const info = await page.evaluate(() => {
    const t = (n: string) => performance.getEntriesByName(n)[0]?.startTime ?? null
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    return { ready: t('cook:ready'), reveal: t('cook:reveal:till-it-looks-red-smooth'), gpu: gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null }
  })
  await context.close()
  const s = frameStats(intervals)
  return {
    name: p.name, viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor, cpuThrottle: p.cpuThrottle, url: URL_PATH, ...s,
    navToReadyMs: info.ready === null ? null : Math.round(info.ready), navToRevealMs: info.reveal === null ? null : Math.round(info.reveal),
    gpuRenderer: info.gpu, pass: pass(s),
  }
}

async function main() {
  await access(path.resolve('dist/index.html')).catch(() => { throw new Error('dist/ is missing: run npm run build first') })
  const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
  const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!base) throw new Error('vite preview did not report a URL')
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist'] })
  try {
    const profiles = []
    for (const p of PROFILES) {
      console.log(`measuring ${p.name} ...`)
      const r = await measure(browser, base, p)
      console.log(`  ${r.frames} frames, mean ${r.meanFps} fps, min ${r.minFps} fps, worst ${r.worstFrameMs} ms, ${r.over18_2ms} over ${SLOW_MS} ms; ready ${r.navToReadyMs} ms, reveal ${r.navToRevealMs} ms`)
      profiles.push(r)
    }
    const report = CookBench.parse({
      generatedAt: new Date().toISOString(),
      command: 'npm run bench:cook',
      machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, os: `${os.platform()} ${os.release()} ${os.arch()}` },
      browser: `Chromium ${browser.version()}`,
      thresholds: { minMeanFps: MIN_FPS, slowFrameMs: SLOW_MS },
      profiles,
    })
    await mkdir(path.dirname(OUT), { recursive: true })
    await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
    if (profiles.some((p) => !p.pass)) {
      console.error('FAIL: a profile is below 55 fps mean or has a frame over 18.2 ms')
      process.exitCode = 1
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
