import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { BenchRow, MAX_FRAME_MS, PROFILES, percentile, summarize } from './steam-bench.ts'

describe('steam bench profiles (R11)', () => {
  it('are the five named rows, in order', () => {
    expect(PROFILES.map((p) => p.name)).toEqual(['desktop-1280x720', 'desktop-1920x1080', 'pixel5-4x-cpu', 'swiftshader-1280x720', 'capture-1920x1080'])
  })
  it('match their names: viewport, scale, CPU throttle and software GL', () => {
    const by = Object.fromEntries(PROFILES.map((p) => [p.name, p]))
    expect(by['desktop-1280x720'].viewport).toEqual({ width: 1280, height: 720 })
    expect(by['desktop-1920x1080'].viewport).toEqual({ width: 1920, height: 1080 })
    expect(by['pixel5-4x-cpu']).toMatchObject({ cpuThrottle: 4, mobile: true, deviceScaleFactor: 2.75 })
    expect(by['swiftshader-1280x720']).toMatchObject({ software: true, viewport: { width: 1280, height: 720 } })
    expect(by['capture-1920x1080']).toMatchObject({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, query: '?gov=1' })
    for (const p of PROFILES) expect(p.query).toContain('gov=1')
    expect(PROFILES.filter((p) => p.software).map((p) => p.name)).toEqual(['swiftshader-1280x720'])
  })
})

describe('summarize', () => {
  const profile = PROFILES[0]
  const info = { tier: 0, gpuRenderer: 'ANGLE (test)', gpuVendor: 'test', deriveMs: 80.04 }
  it('computes avg fps, p5 fps, frames under 55, p50 and p95 on fixed intervals', () => {
    const intervals = [...Array(95).fill(16.67), ...Array(5).fill(25)]
    const r = summarize(profile, intervals, info)
    expect(r.frames).toBe(100)
    expect(r.framesUnder55Fps).toBe(5)
    expect(r.p50FrameMs).toBe(16.67)
    expect(r.p95FrameMs).toBe(16.67)
    expect(r.worstFrameMs).toBe(25)
    expect(r.p5Fps).toBeCloseTo(1000 / 16.67, 1)
    expect(r.avgFps).toBeCloseTo(100000 / (95 * 16.67 + 125), 1)
    expect(r.pass).toBe(false)
    expect(r.tier).toBe(0)
    expect(r.gpuRenderer).toBe('ANGLE (test)')
    expect(BenchRow.safeParse(r).success).toBe(true)
  })
  it('passes a clean 60 fps run and carries the tier the governor reached', () => {
    const r = summarize(profile, Array(900).fill(16.67), { ...info, tier: 2 })
    expect(r.pass).toBe(true)
    expect(r.tier).toBe(2)
    expect(MAX_FRAME_MS).toBeCloseTo(18.18, 2)
  })
  it('percentile is nearest rank', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([], 50)).toBeNaN()
  })
})

describe('bench/results.json, when committed', () => {
  it('has the five rows in the shape the script writes', () => {
    if (!existsSync('bench/results.json')) return
    const file = z.object({ profiles: z.array(BenchRow) }).parse(JSON.parse(readFileSync('bench/results.json', 'utf8')))
    expect(file.profiles.map((p) => p.name)).toEqual(PROFILES.map((p) => p.name))
  })
})
