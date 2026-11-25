// Measures the real renderer in a production build: requestAnimationFrame intervals over the lead-in,
// write-on and hold, on five profiles (see scripts/steam-bench.ts). Writes bench/results.json. Exits 1 if a budget profile
// misses R15: mean fps >= 55 and no frame slower than 1000/55 ms. The software-GL row is recorded and never fails the run.
//
//   npm run bench
//
// Environment knobs: BENCH_MS (default 15000), BENCH_ANGLE (default: Chromium's own choice;
// set to e.g. `metal` to force an ANGLE backend for the hardware rows).
// The older runs stay where they are: bench/steam-renderer.json and bench/steam-renderer-metal.json.
import { mkdir, writeFile, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { preview } from 'vite'
import { heroUrl } from '../e2e/helpers/hero.ts'
import { MAX_FRAME_MS, MIN_FPS, PROFILES, summarize } from './steam-bench.ts'
import type { Profile } from './steam-bench.ts'

const DURATION_MS = Number(process.env.BENCH_MS ?? 15000)
const OUT = path.resolve('bench/results.json')

async function measure(browser: Browser, base: string, profile: Profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottle })
  await page.goto(`${base}${heroUrl(profile.query)}`)
  await page.locator('.steam-canvas').waitFor()
  await page.waitForFunction(() => performance.getEntriesByName('steam:first-frame').length > 0)

  // Record every rAF interval from the renderer's first frame, inside the page, into a preallocated array.
  const intervals = await page.evaluate(
    (ms: number) =>
      new Promise<number[]>((resolve) => {
        const buf = new Float64Array(Math.ceil(ms / 4) + 16)
        let n = 0
        let last = -1
        let startAt = -1
        const tick = (now: number): void => {
          if (startAt < 0) startAt = now
          if (last >= 0 && n < buf.length) buf[n++] = now - last
          last = now
          if (now - startAt < ms) requestAnimationFrame(tick)
          else resolve(Array.from(buf.subarray(0, n)))
        }
        requestAnimationFrame(tick)
      }),
    DURATION_MS,
  )

  const info = await page.evaluate(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    const ext = gl?.getExtension('WEBGL_debug_renderer_info')
    const measure = performance.getEntriesByName('steam:derive')[0]
    const stats = (window as unknown as { __steamStats?: { tier: number } }).__steamStats
    return {
      tier: stats ? stats.tier : 0,
      gpuRenderer: gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null,
      gpuVendor: gl && ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : null,
      deriveMs: measure ? measure.duration : null,
    }
  })
  await context.close()
  return summarize(profile, intervals, info)
}

async function main(): Promise<void> {
  await access(path.resolve('dist/index.html')).catch(() => {
    throw new Error('dist/ is missing: run `npm run build` first (npm run bench does)')
  })
  const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
  const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!base) throw new Error('vite preview did not report a URL')
  const angle = process.env.BENCH_ANGLE
  const hardware = await chromium.launch({
    args: ['--ignore-gpu-blocklist', ...(angle ? [`--use-angle=${angle}`] : [])],
  })
  const software = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  })
  const browser = hardware
  try {
    const profiles = []
    for (const p of PROFILES) {
      console.log(`measuring ${p.name} for ${DURATION_MS} ms ...`)
      const r = await measure(p.software ? software : hardware, base, p)
      console.log(
        `  ${r.frames} frames, ${r.avgFps} fps (p5 ${r.p5Fps}), ${r.framesUnder55Fps} under 55, p50 ${r.p50FrameMs} ms, p95 ${r.p95FrameMs} ms, tier ${r.tier}, ${r.gpuRenderer}`,
      )
      profiles.push(r)
    }
    const report = {
      generatedAt: new Date().toISOString(),
      command: 'npm run bench',
      machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, os: `${os.platform()} ${os.release()} ${os.arch()}` },
      browser: `Chromium ${browser.version()}`,
      angleOverride: angle ?? null,
      thresholds: { minAvgFps: MIN_FPS, maxFrameMs: Number(MAX_FRAME_MS.toFixed(2)) },
      profiles,
    }
    await mkdir(path.dirname(OUT), { recursive: true })
    await writeFile(OUT, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
    if (profiles.some((p) => p.budget && !p.pass)) {
      console.error('FAIL: at least one budget profile is below 55 fps average or has a frame under 55 fps')
      process.exitCode = 1
    }
  } finally {
    await software.close()
    await hardware.close()
    await server.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
