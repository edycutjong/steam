// Allocation guard for the renderer, against a hand-written GL mock.
// This is a guard, not proof: the real per-frame allocation and fps check is the measurement in task 36.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteMeta } from './assets.ts'
import type { Derived } from './derive.ts'
import { computeLayout } from './layout.ts'
import { SteamRenderer } from './renderer.ts'
import type { RendererAssets } from './renderer.ts'
import type { Tokens } from './tokens.ts'

type Calls = Record<string, number>

/** A GL context that records every call by name and answers the status queries a healthy driver would. */
function mockGl(): { gl: WebGL2RenderingContext; calls: Calls } {
  const calls: Calls = {}
  let id = 0
  const constants = new Map<string, number>([['FRAMEBUFFER_COMPLETE', 36053]])
  const gl = new Proxy(
    {},
    {
      get(_t, name: string) {
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) {
          if (!constants.has(name)) constants.set(name, constants.size + 1)
          return constants.get(name)
        }
        return (...args: unknown[]) => {
          calls[name] = (calls[name] ?? 0) + 1
          if (name === 'getShaderParameter' || name === 'getProgramParameter') return true
          if (name === 'checkFramebufferStatus') return 36053
          if (/^(create|getUniformLocation)/.test(name)) return { id: ++id, args }
          return undefined
        }
      },
    },
  ) as unknown as WebGL2RenderingContext
  return { gl, calls }
}

const tokens: Tokens = {
  bg: [0, 0, 0],
  ink: [1, 1, 1],
  before: [0.5, 0.5, 0.5],
  after: [1, 0.6, 0.3],
  rule: [0.2, 0.2, 0.2],
  ghost: [0.7, 0.8, 0.9],
  moon: [0.9, 0.9, 0.9],
  night: [0.1, 0.1, 0.1],
}

const meta = {
  noteId: 'n',
  text: 'till it Looks red & smooth',
  source: 's',
  size: [200, 60],
  pageBox: [0, 0, 1, 1],
  groups: [
    { line: 1, rect: [40, 10, 160, 30], coreBand: [14, 26], t: [0, 0.5], inkPx: 10 },
    { line: 2, rect: [40, 32, 160, 52], coreBand: [36, 48], t: [0.5, 1], inkPx: 10 },
  ],
} as unknown as NoteMeta

function assets(): RendererAssets {
  const derived: Derived = {
    chan: new Uint8Array(200 * 60 * 4),
    ink: new Uint8Array(200 * 60),
    inkRG: new Uint8Array(200 * 60 * 2),
    head: new Float32Array(256 * 2),
    headBins: 256,
  }
  return { meta, note: {} as TexImageSource, derived }
}

function fakeCanvas(gl: WebGL2RenderingContext | null): HTMLCanvasElement {
  return {
    width: 300,
    height: 150,
    getContext: () => gl,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLCanvasElement
}

let rafQueue: FrameRequestCallback[] = []
let clock = 0

beforeEach(() => {
  rafQueue = []
  clock = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafQueue.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('devicePixelRatio', 3)
})
afterEach(() => vi.unstubAllGlobals())

function makeRenderer() {
  const { gl, calls } = mockGl()
  const layout = computeLayout('page', 800, 600, meta)
  const r = SteamRenderer.create(fakeCanvas(gl), assets(), layout, {
    dprCap: 2,
    frozenT: null,
    lead: 100,
    tokens,
  })
  if (!r) throw new Error('create returned null')
  r.resize(800, 600, layout)
  return { r, calls }
}

function runFrames(n: number, dt = 16.6): void {
  for (let i = 0; i < n; i++) {
    const cb = rafQueue.shift()
    if (!cb) throw new Error('frame loop stopped')
    clock += dt
    cb(clock)
  }
}

describe('SteamRenderer allocation guard', () => {
  it('returns null without a WebGL2 context', () => {
    const layout = computeLayout('page', 800, 600, meta)
    const r = SteamRenderer.create(fakeCanvas(null), assets(), layout, {
      dprCap: 2,
      frozenT: null,
      lead: 0,
      tokens,
    })
    expect(r).toBeNull()
  })

  it('draws twice per frame and creates nothing after create', () => {
    const { r, calls } = makeRenderer()
    const created = ['createTexture', 'createBuffer', 'createFramebuffer', 'createProgram', 'createShader', 'createVertexArray']
    const before = created.map((n) => calls[n] ?? 0)
    const draws = calls.drawArrays ?? 0
    r.play()
    runFrames(120)
    expect(calls.drawArrays - draws).toBe(240)
    expect(created.map((n) => calls[n] ?? 0)).toEqual(before)
    r.dispose()
  })

  it('caps the canvas at devicePixelRatio 2', () => {
    const { r } = makeRenderer()
    expect(r.canvas.width).toBe(1600)
    expect(r.canvas.height).toBe(1200)
    r.dispose()
  })

  it('deletes each resource once when disposed twice', () => {
    const { r, calls } = makeRenderer()
    r.dispose()
    r.dispose()
    expect(calls.deleteTexture).toBe(3)
    expect(calls.deleteProgram).toBe(2)
    expect(calls.deleteFramebuffer).toBe(1)
    expect(calls.deleteVertexArray).toBe(1)
  })

  it('stops drawing after dispose', () => {
    const { r, calls } = makeRenderer()
    r.play()
    runFrames(2)
    r.dispose()
    const draws = calls.drawArrays
    const cb = rafQueue.shift()
    cb?.(clock + 16)
    r.setClock(100)
    expect(calls.drawArrays).toBe(draws)
  })

  it('keeps `new`, array literals and arrow functions out of the frame functions', () => {
    const proto = SteamRenderer.prototype as unknown as Record<string, () => void>
    for (const name of ['frame', 'draw']) {
      const src = proto[name].toString()
      expect(src, `${name} allocates with new`).not.toMatch(/\bnew\s/)
      expect(src, `${name} has an arrow function`).not.toContain('=>')
      expect(src, `${name} has an array literal`).not.toMatch(/(?:[=(,:?]|\breturn)\s*\[/)
    }
  })
})

describe('SteamRenderer quality governor (R9)', () => {
  it('stays at tier 0 at 60 fps and publishes window.__steamStats', () => {
    const { r } = makeRenderer()
    r.play()
    runFrames(200)
    expect(r.tier).toBe(0)
    const stats = (globalThis as { __steamStats?: { tier: number; frames: number } }).__steamStats
    expect(stats?.tier).toBe(0)
    expect(stats?.frames).toBeGreaterThan(100)
    r.dispose()
  })
  it('halves the fog pass at tier 1, drops detail at tier 2 and asks for the static pane at tier 3', () => {
    const { r, calls } = makeRenderer()
    let degraded = 0
    r.onDegrade(() => degraded++)
    r.play()
    const fogW0 = (r as unknown as { fogW: number }).fogW
    runFrames(61, 30)
    expect(r.tier).toBe(1)
    expect((r as unknown as { fogW: number }).fogW).toBe(Math.ceil(r.canvas.width / 8))
    expect((r as unknown as { fogW: number }).fogW).toBeLessThan(fogW0)
    expect((r as unknown as { detail: number }).detail).toBe(1)
    runFrames(60, 30)
    expect(r.tier).toBe(2)
    expect((r as unknown as { detail: number }).detail).toBe(0)
    expect(degraded).toBe(0)
    runFrames(60, 30)
    expect(r.tier).toBe(3)
    expect(degraded).toBe(1)
    expect((globalThis as { __steamStats?: { tier: number } }).__steamStats?.tier).toBe(3)
    expect(calls.texImage2D).toBeGreaterThan(0)
    r.dispose()
  })
  it('never degrades a frozen clock', () => {
    const { gl } = mockGl()
    const layout = computeLayout('page', 800, 600, meta)
    const r = SteamRenderer.create(fakeCanvas(gl), assets(), layout, { dprCap: 2, frozenT: 3000, lead: 0, tokens })!
    r.resize(800, 600, layout)
    r.play()
    runFrames(200, 40)
    expect(r.tier).toBe(0)
    r.dispose()
  })
  it('one long frame does not change the tier', () => {
    const { r } = makeRenderer()
    r.play()
    runFrames(100)
    runFrames(1, 400)
    runFrames(100)
    expect(r.tier).toBe(0)
    r.dispose()
  })
})
