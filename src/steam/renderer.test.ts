// Allocation guard for the renderer, against a hand-written GL mock.
// This is a guard, not proof: the real per-frame allocation and fps check is the measurement in task 36.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteMeta } from './assets.ts'
import type { Derived } from './derive.ts'
import { computeLayout } from './layout.ts'
import { QualityGovernor } from './governor.ts'
import { CONTEXT_RESTORE_MS, SteamRenderer } from './renderer.ts'
import type { RendererAssets, RendererOptions } from './renderer.ts'
import { revealState, WIPE_MS } from './timeline.ts'
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

// a2a-arch-r05 B1: a hidden tab gets no frames; the first frame after it must not carry the hidden gap into the reveal, the stats or the governor.
interface FakeVisibility {
  visibilityState: 'visible' | 'hidden'
  addEventListener(type: string, cb: () => void): void
  removeEventListener(type: string, cb: () => void): void
  set(s: 'visible' | 'hidden'): void
  listeners(): number
}
function fakeVisibility(initial: 'visible' | 'hidden' = 'visible'): FakeVisibility {
  const ls = new Set<() => void>()
  const v: FakeVisibility = {
    visibilityState: initial,
    addEventListener: (_t, cb) => void ls.add(cb),
    removeEventListener: (_t, cb) => void ls.delete(cb),
    set(s) {
      v.visibilityState = s
      for (const f of [...ls]) f()
    },
    listeners: () => ls.size,
  }
  return v
}

describe('SteamRenderer reveal clock and a hidden tab (a2a-arch-r05 B1)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => vi.restoreAllMocks())

  function make(vis: FakeVisibility, lead = 0) {
    const { gl } = mockGl()
    const layout = computeLayout('page', 800, 600, meta)
    const opts: RendererOptions & { visibility?: unknown } = { dprCap: 2, frozenT: null, lead, tokens, visibility: vis }
    const r = SteamRenderer.create(fakeCanvas(gl), assets(), layout, opts)!
    r.resize(800, 600, layout)
    return r
  }
  const priv = (r: SteamRenderer) => r as unknown as { wipeAt: number | null }
  const hideFor = (vis: FakeVisibility, ms: number) => {
    vis.set('hidden')
    clock += ms
    vis.set('visible')
  }

  it('a write-on in flight when the tab was hidden is still in flight when it comes back, and the gap is not a frame', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    r.play()
    runFrames(120)
    const before = r.revealMs
    expect(before).toBeGreaterThan(1500)
    expect(before).toBeLessThan(2500)
    const frames = r.stats.frames
    hideFor(vis, 120_000)
    runFrames(1)
    expect(r.revealMs - before).toBeLessThan(100)
    expect(revealState(r.revealMs, null).phase).toBe('writing')
    expect(r.stats.worstMs).toBeLessThan(50)
    expect(r.stats.over).toBe(0)
    expect(r.stats.frames).toBe(frames) // the first frame back has no interval: lastFrame was reset
    r.dispose()
  })

  it('a wipe sweep in flight is not finished by the gap', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    r.play()
    runFrames(320) // past WRITE_ON_MS: holding
    expect(revealState(r.revealMs, null).phase).toBe('holding')
    r.wipe()
    runFrames(30)
    hideFor(vis, 60_000)
    runFrames(1)
    const into = r.revealMs - (priv(r).wipeAt as number)
    expect(into).toBeGreaterThan(0)
    expect(into).toBeLessThan(WIPE_MS)
    r.dispose()
  })

  it('does not advance the reveal clock for a frame that runs while hidden', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    r.play()
    runFrames(60)
    const at = r.revealMs
    vis.set('hidden')
    runFrames(60)
    expect(r.revealMs).toBe(at)
    clock += 5000
    vis.set('visible')
    runFrames(1)
    expect(r.revealMs - at).toBeLessThan(100)
    r.dispose()
  })

  it('repeated hidden gaps never reach the governor', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    r.play()
    for (let i = 0; i < 6; i++) {
      runFrames(5)
      hideFor(vis, 20_000)
    }
    runFrames(5)
    expect(r.tier).toBe(0)
    expect(r.stats.worstMs).toBeLessThan(50)
    r.dispose()
  })

  it('a pane with lead Infinity stays fogged through a hidden gap until startReveal', () => {
    const vis = fakeVisibility()
    const r = make(vis, Infinity)
    r.play()
    runFrames(10)
    hideFor(vis, 30_000)
    runFrames(5)
    expect(revealState(r.revealMs, null).phase).toBe('fogged')
    r.startReveal()
    runFrames(1)
    expect(['thickening', 'writing']).toContain(revealState(r.revealMs, null).phase)
    r.dispose()
  })

  it('listens for visibility changes while alive and removes the listener in dispose', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    expect(vis.listeners()).toBe(1)
    r.dispose()
    expect(vis.listeners()).toBe(0)
  })
})

// a2a-arch-r05 B3: tier 3 swaps the canvas for the static pane; never in the middle of a stroke or a wipe sweep.
describe('SteamRenderer tier 3 waits for a calm phase (a2a-arch-r05 B3)', () => {
  type Priv = { wipeAt: number | null }
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => vi.restoreAllMocks())
  const priv = (r: SteamRenderer) => r as unknown as Priv
  /** A governor one slow frame away from tier 3: tier 2 with 59 slow intervals already in the window. */
  function primeForTier3(r: SteamRenderer): void {
    const g = new QualityGovernor()
    g.tier = 2
    for (let i = 0; i < 59; i++) g.push(30)
    ;(r as unknown as { gov: QualityGovernor }).gov = g
  }
  function make(lead: number) {
    const { gl } = mockGl()
    const layout = computeLayout('page', 800, 600, meta)
    const r = SteamRenderer.create(fakeCanvas(gl), assets(), layout, { dprCap: 2, frozenT: null, lead, tokens })!
    r.resize(800, 600, layout)
    const seen: { phase: string; wipe: number }[] = []
    r.onDegrade(() => seen.push(revealState(r.revealMs, priv(r).wipeAt)))
    return { r, seen }
  }

  it('a tier-3 request while the hand is being written is held until the write-on is done', () => {
    const { r, seen } = make(0)
    r.play()
    runFrames(30)
    expect(revealState(r.revealMs, null).phase).toBe('writing')
    primeForTier3(r)
    runFrames(1, 30)
    expect(r.tier).toBe(3)
    expect(seen).toEqual([])
    runFrames(100, 16.6)
    expect(seen).toEqual([])
    runFrames(300, 16.6) // past WRITE_ON_MS
    expect(seen).toHaveLength(1)
    expect(seen[0].phase).toBe('holding')
    runFrames(50)
    expect(seen).toHaveLength(1) // once
    r.dispose()
  })

  it('a tier-3 request while the note is thickening is held too', () => {
    const { r, seen } = make(2000)
    r.play()
    runFrames(60)
    expect(revealState(r.revealMs, null).phase).toBe('thickening')
    primeForTier3(r)
    runFrames(1, 30)
    expect(seen).toEqual([])
    runFrames(450)
    expect(seen).toHaveLength(1)
    expect(seen[0].phase).toBe('holding')
    r.dispose()
  })

  it('a tier-3 request while a wipe sweep is moving is held until the sweep is finished', () => {
    const { r, seen } = make(0)
    r.play()
    runFrames(320)
    expect(revealState(r.revealMs, null).phase).toBe('holding')
    r.wipe()
    primeForTier3(r)
    runFrames(1, 30)
    expect(r.tier).toBe(3)
    expect(seen).toEqual([])
    runFrames(40) // 0.66 s of the 1.4 s sweep
    expect(seen).toEqual([])
    runFrames(60)
    expect(seen).toHaveLength(1)
    expect(seen[0].phase).toBe('wiped')
    expect(seen[0].wipe).toBe(1)
    r.dispose()
  })

  it('applies at once while holding and while still fogged', () => {
    const held = make(0)
    held.r.play()
    runFrames(320)
    primeForTier3(held.r)
    runFrames(1, 30)
    expect(held.seen).toHaveLength(1)
    held.r.dispose()
    const fogged = make(Infinity)
    fogged.r.play()
    runFrames(5)
    primeForTier3(fogged.r)
    runFrames(1, 30)
    expect(fogged.seen).toHaveLength(1)
    expect(fogged.seen[0].phase).toBe('fogged')
    fogged.r.dispose()
  })

  it('tiers 1 and 2 apply at once, mid-stroke', () => {
    const { r } = make(0)
    r.play()
    runFrames(30)
    runFrames(61, 30)
    expect(r.tier).toBe(1)
    expect((r as unknown as { fogW: number }).fogW).toBe(Math.ceil(r.canvas.width / 8))
    r.dispose()
  })

  it('a lost context still reaches the fallback after its 2 s restore window, mid-stroke', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { gl } = mockGl()
    const handlers: Record<string, (e: Event) => void> = {}
    const canvas = { width: 300, height: 150, getContext: () => gl, addEventListener: (t: string, h: (e: Event) => void) => void (handlers[t] = h), removeEventListener: () => {} } as unknown as HTMLCanvasElement
    const layout = computeLayout('page', 800, 600, meta)
    const r = SteamRenderer.create(canvas, assets(), layout, { dprCap: 2, frozenT: null, lead: 0, tokens })!
    r.resize(800, 600, layout)
    let lost = 0
    r.onContextLost(() => lost++)
    r.play()
    runFrames(30)
    expect(revealState(r.revealMs, null).phase).toBe('writing')
    handlers.webglcontextlost({ preventDefault() {} } as Event)
    vi.advanceTimersByTime(CONTEXT_RESTORE_MS - 1)
    expect(lost).toBe(0)
    vi.advanceTimersByTime(2)
    expect(lost).toBe(1)
    r.dispose()
    vi.useRealTimers()
  })
})

// a2a-arch-r06 C5: the clock must not depend on one event. A page restored as visible may skip "visibilitychange" (a2a-arch-r05 B8).
describe('SteamRenderer clock when visibility comes back without an event (a2a-arch-r06 C5)', () => {
  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => vi.restoreAllMocks())

  function make(vis: FakeVisibility, lead = 0) {
    const { gl } = mockGl()
    const layout = computeLayout('page', 800, 600, meta)
    const opts: RendererOptions & { visibility?: unknown } = { dprCap: 2, frozenT: null, lead, tokens, visibility: vis }
    const r = SteamRenderer.create(fakeCanvas(gl), assets(), layout, opts)!
    r.resize(800, 600, layout)
    return r
  }
  const priv = (r: SteamRenderer) => r as unknown as { wipeAt: number | null }
  /** Hidden with the event, then visible again with none: the state is "visible" and nobody was told. */
  const hideThenRestoreSilently = (vis: FakeVisibility, ms: number) => {
    vis.set('hidden')
    clock += ms
    vis.visibilityState = 'visible'
  }

  it('the next frame advances the write-on, and the gap is not a frame', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    r.play()
    runFrames(120)
    const before = r.revealMs
    const frames = r.stats.frames
    hideThenRestoreSilently(vis, 120_000)
    runFrames(1)
    expect(r.revealMs - before).toBeLessThan(100)
    expect(revealState(r.revealMs, null).phase).toBe('writing')
    runFrames(30)
    expect(r.revealMs - before).toBeGreaterThan(400) // it carries on
    expect(r.stats.worstMs).toBeLessThan(50)
    expect(r.stats.over).toBe(0)
    expect(r.stats.frames).toBeGreaterThan(frames)
    r.dispose()
  })

  it('a wipe asked for after a silent restore sweeps instead of standing still', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    r.play()
    runFrames(320)
    expect(revealState(r.revealMs, null).phase).toBe('holding')
    hideThenRestoreSilently(vis, 60_000)
    r.wipe()
    expect(priv(r).wipeAt).not.toBeNull()
    runFrames(30)
    const into = r.revealMs - (priv(r).wipeAt as number)
    expect(into).toBeGreaterThan(300)
    expect(into).toBeLessThan(WIPE_MS)
    r.dispose()
  })

  it('startReveal after a silent restore starts a reveal that runs, from the visible time', () => {
    const vis = fakeVisibility()
    const r = make(vis, Infinity)
    r.play()
    runFrames(10)
    hideThenRestoreSilently(vis, 30_000)
    r.startReveal()
    runFrames(60)
    expect(['thickening', 'writing']).toContain(revealState(r.revealMs, null).phase)
    expect(r.revealMs).toBeLessThan(2500)
    r.dispose()
  })

  it('a page that is still hidden stays frozen, and the real event afterwards still resumes it once', () => {
    const vis = fakeVisibility()
    const r = make(vis)
    r.play()
    runFrames(60)
    const at = r.revealMs
    vis.set('hidden')
    clock += 5000
    runFrames(30)
    expect(r.revealMs).toBe(at)
    vis.set('visible')
    runFrames(1)
    expect(r.revealMs - at).toBeLessThan(100)
    runFrames(1)
    expect(r.revealMs - at).toBeLessThan(150) // the gap was shifted once, not twice
    r.dispose()
  })
})
