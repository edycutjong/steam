// Measures the real renderer in a production build: requestAnimationFrame intervals over the lead-in,
// write-on and hold, on three profiles. Writes bench/steam-renderer.json. Exits 1 if a profile misses
// R15: mean fps >= 55 and no frame slower than 1000/55 ms.
//
//   npm run bench
//
// Environment knobs: BENCH_MS (default 15000), BENCH_ANGLE (default: Chromium's own choice;
// set to e.g. `metal` or `swiftshader` to force an ANGLE backend).
import { mkdir, writeFile, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Browser } from '@playwright/test'
import { preview } from 'vite'

const DURATION_MS = Number(process.env.BENCH_MS ?? 15000)
const MIN_FPS = 55
const MAX_FRAME_MS = 1000 / MIN_FPS
const OUT = path.resolve('bench/steam-renderer.json')

interface Profile {
  name: string
  viewport: { width: number; height: number }
  deviceScaleFactor: number
  mobile: boolean
  cpuThrottle: number
}

const PROFILES: Profile[] = [
  { name: 'desktop-1280x720', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1 },
  { name: 'desktop-1920x1080', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, mobile: false, cpuThrottle: 1 },
  { name: 'pixel5-4x-cpu', viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, mobile: true, cpuThrottle: 4 },
]

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

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
  await page.goto(`${base}/?fps=1`)
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
    return {
      gpuRenderer: gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null,
      gpuVendor: gl && ext ? String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) : null,
      deriveMs: measure ? measure.duration : null,
    }
  })
  await context.close()

  const sorted = [...intervals].sort((a, b) => a - b)
  const totalMs = intervals.reduce((s, v) => s + v, 0)
  const framesUnder55 = intervals.filter((v) => v > MAX_FRAME_MS).length
  const avgFps = totalMs > 0 ? (intervals.length * 1000) / totalMs : 0
  return {
    name: profile.name,
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    cpuThrottle: profile.cpuThrottle,
    durationMs: Math.round(totalMs),
    frames: intervals.length,
    avgFps: Number(avgFps.toFixed(2)),
    framesUnder55Fps: framesUnder55,
    p50FrameMs: Number(percentile(sorted, 50).toFixed(2)),
    p95FrameMs: Number(percentile(sorted, 95).toFixed(2)),
    worstFrameMs: Number((sorted[sorted.length - 1] ?? Number.NaN).toFixed(2)),
    gpuRenderer: info.gpuRenderer,
    gpuVendor: info.gpuVendor,
    deriveMs: info.deriveMs === null ? null : Number(info.deriveMs.toFixed(1)),
    pass: avgFps >= MIN_FPS && framesUnder55 === 0,
  }
}

async function main(): Promise<void> {
  await access(path.resolve('dist/index.html')).catch(() => {
    throw new Error('dist/ is missing: run `npm run build` first (npm run bench does)')
  })
  const server = await preview({ preview: { port: 0, host: '127.0.0.1' }, logLevel: 'error' })
  const base = server.resolvedUrls?.local[0]?.replace(/\/$/, '')
  if (!base) throw new Error('vite preview did not report a URL')
  const angle = process.env.BENCH_ANGLE
  const browser = await chromium.launch({
    args: ['--ignore-gpu-blocklist', ...(angle ? [`--use-angle=${angle}`] : [])],
  })
  try {
    const profiles = []
    for (const p of PROFILES) {
      console.log(`measuring ${p.name} for ${DURATION_MS} ms ...`)
      const r = await measure(browser, base, p)
      console.log(
        `  ${r.frames} frames, ${r.avgFps} fps, ${r.framesUnder55Fps} under 55, p50 ${r.p50FrameMs} ms, p95 ${r.p95FrameMs} ms, ${r.gpuRenderer}`,
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
    if (profiles.some((p) => !p.pass)) {
      console.error('FAIL: at least one profile is below 55 fps average or has a frame under 55 fps')
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
