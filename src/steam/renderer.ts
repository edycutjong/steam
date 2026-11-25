// Raw WebGL2, two full-screen passes: a quarter-resolution fog field, then the composite.
// All GPU resources are created in `build()`; nothing is allocated per frame.

import type { NoteMeta } from './assets.ts'
import type { Derived } from './derive.ts'
import type { Layout } from './layout.ts'
import { bloomAt, candleLevel } from './haunt.ts'
import { QualityGovernor } from './governor.ts'
import type { Tier } from './governor.ts'
import { placeDrips, planDrips, writeRunUniforms } from './drips.ts'
import type { PlacedRun, PlannedRun } from './drips.ts'
import { COMPOSITE_FRAG, FOG_FRAG, RUN_MAX, TRAIL_N, TRAIL_STEP, VERT } from './shaders.ts'
import type { Tokens } from './tokens.ts'
import { readTokens } from './tokens.ts'
import type { RevealState } from './timeline.ts'
import { revealState, THICKEN_MS } from './timeline.ts'

export interface RendererAssets {
  meta: NoteMeta
  note: TexImageSource
  derived: Derived
}

export interface RendererOptions {
  /** Canvas resolution cap, in device pixels per CSS pixel. */
  dprCap: 2
  /** Frozen reveal clock in ms, or null for the live clock. */
  frozenT: number | null
  /** Lead-in before the reveal, ms. */
  lead: number
  /** The cue's cold bloom. Default true; false for the static pane images. */
  bloom?: boolean
  /** Design tokens. Read from the canvas's CSS custom properties when absent. */
  tokens?: Tokens
}

/** Group placements the shader holds. */
export const MAX_GROUPS = 4

/** Fog texture is this many canvas pixels per texel per axis: at tier 0, and from tier 1 (the governor halves its resolution). */
export const FOG_DIV = 4
export const FOG_DIV_REDUCED = 8

/** What `window.__steamStats` carries (design §8). Updated in place at 4 Hz. */
export interface SteamStats {
  tier: Tier
  frames: number
  avgFps: number
  p95Ms: number
  framesOver: number
  renderer: string | null
}
const STATS_PERIOD_MS = 250

const FOG_UNIFORMS = ['uSize', 'uTime', 'uThicken'] as const
const COMP_UNIFORMS = [
  'uRes', 'uDpr', 'uTime', 'uU', 'uThicken', 'uHead', 'uWipe', 'uRefog',
  'uGroupSrc', 'uGroupDst', 'uGroupCount', 'uNoteSize', 'uHeadPos', 'uHeadGroup',
  'uTrail', 'uRunA', 'uRunB', 'uRunCount', 'uFogTexel', 'uCandle', 'uBloom', 'uDetail', 'uBg', 'uInk', 'uBefore', 'uAfter', 'uRule', 'uGhost', 'uMoon', 'uNight', 'uPot',
  'uInkTex', 'uChan', 'uFog',
] as const
type Locs<K extends string> = Record<K, WebGLUniformLocation | null>

/** A frame interval over this (ms) is a missed 55 fps frame. */
export const SLOW_FRAME_MS = 18.2
/** A lost context that is not restored within this many ms triggers the fallback. */
export const CONTEXT_RESTORE_MS = 2000
/** State callback period, ms (10 Hz). */
const STATE_PERIOD_MS = 100

/** Rolling frame statistics, mutated in place. Read by the fps overlay. */
export interface FrameStats {
  frames: number
  sumMs: number
  worstMs: number
  over: number
}

/** Sampler units. */
const UNIT_INK = 0
const UNIT_CHAN = 1
const UNIT_FOG = 2

/** Pot centre in pane UV, below the bottom edge. */
const POT_X = 0.5
const POT_Y = 1.18

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error(`steam: ${label} shader failed to compile:\n${gl.getShaderInfoLog(sh) ?? ''}`)
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string, label: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vert, `${label} vertex`)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag, `${label} fragment`)
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs)
    if (fs) gl.deleteShader(fs)
    return null
  }
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(`steam: ${label} program failed to link:\n${gl.getProgramInfoLog(prog) ?? ''}`)
    gl.deleteProgram(prog)
    return null
  }
  return prog
}

function locations<K extends string>(gl: WebGL2RenderingContext, prog: WebGLProgram, names: readonly K[]): Locs<K> {
  const out = {} as Locs<K>
  for (const n of names) out[n] = gl.getUniformLocation(prog, n)
  return out
}

interface Resources {
  progFog: WebGLProgram
  progComp: WebGLProgram
  vao: WebGLVertexArrayObject
  texInk: WebGLTexture
  texChan: WebGLTexture
  texFog: WebGLTexture
  fboFog: WebGLFramebuffer
  fogLoc: Locs<(typeof FOG_UNIFORMS)[number]>
  compLoc: Locs<(typeof COMP_UNIFORMS)[number]>
}

function texture(gl: WebGL2RenderingContext, unit: number, wrapX: number, minFilter: number = gl.LINEAR): WebGLTexture | null {
  const tex = gl.createTexture()
  if (!tex) return null
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapX)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

export class SteamRenderer {
  readonly canvas: HTMLCanvasElement
  readonly assets: RendererAssets
  readonly opts: RendererOptions
  readonly tokens: Tokens
  gl: WebGL2RenderingContext
  res: Resources
  layout: Layout
  readonly stats: FrameStats = { frames: 0, sumMs: 0, worstMs: 0, over: 0 }

  private playing = false
  /** True until the first draw; that draw leaves the `steam:first-frame` performance mark (read by e2e). */
  private firstFrame = true
  private rafId = 0
  private readonly loop: FrameRequestCallback
  private frozenT: number | null
  private revealStart = Number.NaN
  private t0 = Number.NaN
  private wipeAt: number | null = null
  private lastFrame = Number.NaN
  private lastNotify = -Infinity
  private stateCb: ((s: RevealState) => void) | null = null
  private readonly groupSrc = new Float32Array(16)
  private readonly groupDst = new Float32Array(16)
  /** t[0], t[1] per layout group. */
  private readonly groupT = new Float32Array(8)
  private groupCount = 0
  private canvasW = 1
  private canvasH = 1
  private fogW = 1
  private fogH = 1
  private dpr = 1
  private readonly trail = new Float32Array(2 * TRAIL_N)
  private readonly runA = new Float32Array(4 * RUN_MAX)
  private readonly runB = new Float32Array(4 * RUN_MAX)
  private readonly plan: PlannedRun[]
  private runs: PlacedRun[] = []
  private readonly seed: number
  /** Candle flame in pane uv (y down); set from the DOM flame by `setCandle`. */
  private candleU = 0.93
  private candleV = 0.86
  private disposed = false
  private readonly gov = new QualityGovernor()
  private fogDiv = FOG_DIV
  private detail = 1
  private degradeCb: (() => void) | null = null
  private lastStats = -Infinity
  readonly pub: SteamStats = { tier: 0, frames: 0, avgFps: 0, p95Ms: 0, framesOver: 0, renderer: null }
  private resumeOnRestore = false
  private lostTimer: ReturnType<typeof setTimeout> | null = null
  private lostCb: (() => void) | null = null
  private readonly onLost: (e: Event) => void
  private readonly onRestored: () => void

  private constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    res: Resources,
    assets: RendererAssets,
    layout: Layout,
    opts: RendererOptions,
    tokens: Tokens,
  ) {
    this.canvas = canvas
    this.gl = gl
    this.res = res
    this.assets = assets
    this.layout = layout
    this.opts = opts
    this.tokens = tokens
    this.frozenT = opts.frozenT
    const meta = assets.meta
    let seed = 2166136261
    for (let i = 0; i < meta.noteId.length; i++) seed = Math.imul(seed ^ meta.noteId.charCodeAt(i), 16777619) >>> 0
    this.seed = seed
    this.plan = planDrips(
      { ink: assets.derived.ink, toi: assets.derived.chan, width: meta.size[0], height: meta.size[1], groups: meta.groups },
      seed,
    )
    this.loop = this.frame.bind(this)
    this.applyLayout(layout, canvas.width, canvas.height, 1)
    this.onLost = this.handleLost.bind(this)
    this.onRestored = this.handleRestored.bind(this)
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    this.pub.renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : null
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.allocFog()
  }

  /** Returns null when WebGL2 is unavailable or a shader, program or framebuffer fails. */
  static create(
    canvas: HTMLCanvasElement,
    assets: RendererAssets,
    layout: Layout,
    opts: RendererOptions,
  ): SteamRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    })
    if (!gl) return null
    const tokens = opts.tokens ?? readTokens(canvas)
    const res = SteamRenderer.build(gl, assets, tokens)
    if (!res) return null
    return new SteamRenderer(canvas, gl, res, assets, layout, opts, tokens)
  }

  /** Builds every GPU resource once. Used by `create` and after a context restore. */
  static build(gl: WebGL2RenderingContext, assets: RendererAssets, tokens: Tokens): Resources | null {
    const progFog = link(gl, VERT, FOG_FRAG, 'fog')
    const progComp = link(gl, VERT, COMPOSITE_FRAG, 'composite')
    const vao = gl.createVertexArray()
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    const texInk = texture(gl, UNIT_INK, gl.CLAMP_TO_EDGE, gl.LINEAR_MIPMAP_LINEAR)
    const texChan = texture(gl, UNIT_CHAN, gl.CLAMP_TO_EDGE)
    const texFog = texture(gl, UNIT_FOG, gl.REPEAT)
    const fboFog = gl.createFramebuffer()
    if (!progFog || !progComp || !vao || !texInk || !texChan || !texFog || !fboFog) {
      SteamRenderer.release(gl, { progFog, progComp, vao, texInk, texChan, texFog, fboFog })
      return null
    }

    const [w, h] = assets.meta.size
    gl.activeTexture(gl.TEXTURE0 + UNIT_INK)
    gl.bindTexture(gl.TEXTURE_2D, texInk)
    // The scan's continuous ink alpha, single channel, with mips: `uInk` (design §2). The scan's RGB is never uploaded.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, assets.derived.ink)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.activeTexture(gl.TEXTURE0 + UNIT_CHAN)
    gl.bindTexture(gl.TEXTURE_2D, texChan)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, assets.derived.chan)
    // Fog storage is sized by `resize`; a 1x1 placeholder keeps the framebuffer complete until then.
    gl.activeTexture(gl.TEXTURE0 + UNIT_FOG)
    gl.bindTexture(gl.TEXTURE_2D, texFog)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, 1, 1, 0, gl.RG, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboFog)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texFog, 0)
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (!complete) {
      console.error('steam: fog framebuffer is incomplete')
      SteamRenderer.release(gl, { progFog, progComp, vao, texInk, texChan, texFog, fboFog })
      return null
    }

    const fogLoc = locations(gl, progFog, FOG_UNIFORMS)
    const compLoc = locations(gl, progComp, COMP_UNIFORMS)

    // Per-program constants, set once: sampler units and token colours.
    gl.useProgram(progComp)
    gl.uniform1i(compLoc.uInkTex, UNIT_INK)
    gl.uniform1i(compLoc.uChan, UNIT_CHAN)
    gl.uniform1i(compLoc.uFog, UNIT_FOG)
    gl.uniform3fv(compLoc.uBg, tokens.bg)
    gl.uniform3fv(compLoc.uInk, tokens.ink)
    gl.uniform3fv(compLoc.uBefore, tokens.before)
    gl.uniform3fv(compLoc.uAfter, tokens.after)
    gl.uniform3fv(compLoc.uRule, tokens.rule)
    gl.uniform3fv(compLoc.uGhost, tokens.ghost)
    gl.uniform3fv(compLoc.uMoon, tokens.moon)
    gl.uniform3fv(compLoc.uNight, tokens.night)
    gl.uniform2f(compLoc.uPot, POT_X, POT_Y)
    gl.uniform2f(compLoc.uNoteSize, w, h)
    gl.bindVertexArray(vao)

    return { progFog, progComp, vao, texInk, texChan, texFog, fboFog, fogLoc, compLoc }
  }

  /** Deletes whichever resources exist. Safe with nulls. */
  static release(
    gl: WebGL2RenderingContext,
    r: {
      progFog: WebGLProgram | null
      progComp: WebGLProgram | null
      vao: WebGLVertexArrayObject | null
      texInk: WebGLTexture | null
      texChan: WebGLTexture | null
      texFog: WebGLTexture | null
      fboFog: WebGLFramebuffer | null
    },
  ): void {
    if (r.progFog) gl.deleteProgram(r.progFog)
    if (r.progComp) gl.deleteProgram(r.progComp)
    if (r.vao) gl.deleteVertexArray(r.vao)
    if (r.texInk) gl.deleteTexture(r.texInk)
    if (r.texChan) gl.deleteTexture(r.texChan)
    if (r.texFog) gl.deleteTexture(r.texFog)
    if (r.fboFog) gl.deleteFramebuffer(r.fboFog)
  }

  /** Where the candle flame is, in pane uv (0..1, y down). */
  setCandle(u: number, v: number): void {
    this.candleU = u
    this.candleV = v
  }

  /** Registers the 10 Hz state callback for React. Pass null to remove it. */
  onState(cb: ((s: RevealState) => void) | null): void {
    this.stateCb = cb
  }

  /** Freezes the reveal clock at `tMs` and draws one frame. */
  setClock(tMs: number): void {
    this.frozenT = tMs
    if (!this.playing) this.draw(performance.now())
  }

  /** True while the requestAnimationFrame loop is scheduled. */
  get running(): boolean {
    return this.playing && this.rafId !== 0
  }

  /** Starts the requestAnimationFrame loop. */
  play(): void {
    if (this.playing) return
    this.playing = true
    this.rafId = requestAnimationFrame(this.loop)
  }

  /** "Show the note": starts the reveal now, or replays from thickening after a wipe. */
  startReveal(): void {
    if (this.frozenT !== null) return
    const now = performance.now()
    if (Number.isNaN(this.t0)) {
      this.t0 = now
      this.revealStart = now
    }
    const phase = revealState(now - this.revealStart, this.wipeAt).phase
    if (phase === 'fogged') {
      // the cue comes first: the cold bloom, the cloud and the candle, THICKEN_MS before the hand is written
      this.revealStart = now + THICKEN_MS
    } else if (phase === 'thickening') {
      this.revealStart = now
    } else if (phase === 'wiped') {
      this.wipeAt = null
      this.revealStart = now + THICKEN_MS
    } else {
      return
    }
    this.notify(now, true)
  }

  /** The cook's wipe. Accepted only while holding. */
  wipe(): void {
    if (this.frozenT !== null || Number.isNaN(this.revealStart)) return
    const t = performance.now() - this.revealStart
    if (revealState(t, this.wipeAt).phase !== 'holding') return
    this.wipeAt = t
    this.notify(performance.now(), true)
  }

  /** Registers the callback run when the governor reaches tier 3: the pane is to be replaced by the static images. */
  onDegrade(cb: (() => void) | null): void {
    this.degradeCb = cb
  }

  /** The governor's current tier. */
  get tier(): Tier {
    return this.gov.tier
  }

  /** Feeds one frame interval to the governor and applies a tier change. Never called for a frozen clock. */
  private govern(dt: number): void {
    const next = this.gov.push(dt)
    if (next === null) return
    if (next >= 1 && this.fogDiv !== FOG_DIV_REDUCED) {
      this.fogDiv = FOG_DIV_REDUCED
      this.applyLayout(this.layout, this.canvasW, this.canvasH, this.dpr)
      this.allocFog()
    }
    if (next >= 2) this.detail = 0
    this.publish(performance.now(), true)
    if (next >= 3) this.degradeCb?.()
  }

  /** Publishes `window.__steamStats` at 4 Hz (and at once on a tier change). */
  private publish(now: number, force = false): void {
    if (!force && now - this.lastStats < STATS_PERIOD_MS) return
    this.lastStats = now
    const s = this.stats
    const p = this.pub
    p.tier = this.gov.tier
    p.frames = s.frames
    p.avgFps = s.sumMs > 0 ? (s.frames * 1000) / s.sumMs : 0
    const q = this.gov.p95()
    if (q === q) p.p95Ms = q
    p.framesOver = s.over
    ;(globalThis as { __steamStats?: SteamStats }).__steamStats = p
  }

  /** Clears the rolling frame statistics. */
  resetStats(): void {
    this.stats.frames = 0
    this.stats.sumMs = 0
    this.stats.worstMs = 0
    this.stats.over = 0
    this.lastFrame = Number.NaN
  }

  private notify(now: number, force: boolean): void {
    const cb = this.stateCb
    if (!cb || (!force && now - this.lastNotify < STATE_PERIOD_MS)) return
    this.lastNotify = now
    const t = this.frozenT !== null ? this.frozenT : now - this.revealStart
    cb(revealState(t, this.wipeAt))
  }

  private frame(now: number): void {
    if (!this.playing) return
    const last = this.lastFrame
    this.lastFrame = now
    if (last === last) {
      const dt = now - last
      const s = this.stats
      s.frames += 1
      s.sumMs += dt
      if (dt > s.worstMs) s.worstMs = dt
      if (dt > SLOW_FRAME_MS) s.over += 1
      if (this.frozenT === null) this.govern(dt) // a frozen clock is a measurement frame: it is never degraded
    }
    this.draw(now)
    this.publish(now)
    this.notify(now, false)
    this.rafId = requestAnimationFrame(this.loop)
  }

  private draw(now: number): void {
    if (this.disposed) return
    if (this.frozenT === null && this.t0 !== this.t0) {
      this.t0 = now
      this.revealStart = now + this.opts.lead
    }
    if (this.firstFrame) {
      this.firstFrame = false
      performance.mark('steam:first-frame')
    }
    const frozen = this.frozenT
    const t = frozen !== null ? frozen : now - this.revealStart
    const time = frozen !== null ? frozen / 1000 : (now - this.t0) / 1000
    const st = revealState(t, this.wipeAt)
    const gl = this.gl
    const r = this.res

    gl.useProgram(r.progFog)
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fboFog)
    gl.viewport(0, 0, this.fogW, this.fogH)
    gl.uniform2f(r.fogLoc.uSize, this.fogW, this.fogH)
    gl.uniform1f(r.fogLoc.uTime, time)
    gl.uniform1f(r.fogLoc.uThicken, st.thicken)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    let bin = Math.round((st.u < 0 ? 0 : st.u) * (this.assets.derived.headBins - 1))
    if (bin < 0) bin = 0
    let headGroup = 0
    for (let k = 0; k < this.groupCount; k++) {
      if (st.u >= this.groupT[2 * k]) headGroup = k
    }
    const head = this.assets.derived.head

    gl.useProgram(r.progComp)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvasW, this.canvasH)
    gl.uniform2f(r.compLoc.uRes, this.canvasW, this.canvasH)
    gl.uniform1f(r.compLoc.uDpr, this.dpr)
    gl.uniform1f(r.compLoc.uTime, time)
    gl.uniform1f(r.compLoc.uU, st.u)
    gl.uniform1f(r.compLoc.uThicken, st.thicken)
    gl.uniform1f(r.compLoc.uHead, st.head)
    gl.uniform1f(r.compLoc.uWipe, st.wipe)
    gl.uniform1f(r.compLoc.uRefog, st.refog)
    gl.uniform4fv(r.compLoc.uGroupSrc, this.groupSrc)
    gl.uniform4fv(r.compLoc.uGroupDst, this.groupDst)
    gl.uniform1i(r.compLoc.uGroupCount, this.groupCount)
    gl.uniform2f(r.compLoc.uHeadPos, head[2 * bin], head[2 * bin + 1])
    gl.uniform1i(r.compLoc.uHeadGroup, headGroup)
    gl.uniform2f(r.compLoc.uFogTexel, 1 / this.fogW, 1 / this.fogH)
    gl.uniform3f(r.compLoc.uCandle, this.candleU, this.candleV, candleLevel(time, t))
    const nRuns = this.detail > 0 ? this.runs.length : 0
    for (let k = 0; k < nRuns; k++) writeRunUniforms(this.runs[k], t, this.dpr, this.runA, this.runB, k)
    this.writeTrail(bin)
    gl.uniform2fv(r.compLoc.uTrail, this.trail)
    gl.uniform4fv(r.compLoc.uRunA, this.runA)
    gl.uniform4fv(r.compLoc.uRunB, this.runB)
    gl.uniform1i(r.compLoc.uRunCount, nRuns)
    gl.uniform1f(r.compLoc.uBloom, this.opts.bloom === false ? 0 : bloomAt(t))
    gl.uniform1f(r.compLoc.uDetail, this.detail)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** The head's path at the last TRAIL_N samples, device px, for the breath. No allocation. */
  private writeTrail(bin: number): void {
    const head = this.assets.derived.head
    const last = this.assets.derived.headBins - 1
    for (let k = 0; k < TRAIL_N; k++) {
      let b = bin - k * TRAIL_STEP
      if (b < 0) b = 0
      const s = b / last
      let g = 0
      for (let i = 0; i < this.groupCount; i++) if (s >= this.groupT[2 * i]) g = i
      const sx = this.groupSrc[4 * g]
      const sw = this.groupSrc[4 * g + 2] - sx
      const dx = this.groupDst[4 * g]
      const scale = (this.groupDst[4 * g + 2] - dx) / (sw > 0 ? sw : 1)
      this.trail[2 * k] = dx + (head[2 * b] - sx) * scale
      this.trail[2 * k + 1] = this.groupDst[4 * g + 1] + (head[2 * b + 1] - this.groupSrc[4 * g + 1]) * scale
    }
  }

  /** Fills the preallocated group arrays. `ratio` is canvas px per CSS px. */
  protected applyLayout(layout: Layout, canvasW: number, canvasH: number, ratio: number): void {
    this.layout = layout
    this.canvasW = Math.max(1, canvasW)
    this.canvasH = Math.max(1, canvasH)
    this.dpr = ratio
    this.fogW = Math.ceil(this.canvasW / this.fogDiv)
    this.fogH = Math.ceil(this.canvasH / this.fogDiv)
    this.groupCount = Math.min(MAX_GROUPS, layout.groups.length)
    this.runs = placeDrips(this.plan, layout, this.canvasW / ratio, this.canvasH / ratio, this.seed)
    this.groupSrc.fill(0)
    this.groupDst.fill(0)
    for (let k = 0; k < this.groupCount; k++) {
      const g = layout.groups[k]
      for (let j = 0; j < 4; j++) {
        this.groupSrc[4 * k + j] = g.src[j]
        this.groupDst[4 * k + j] = g.dst[j] * ratio
      }
      const t = g.t
      this.groupT[2 * k] = t[0]
      this.groupT[2 * k + 1] = t[1]
    }
  }

  /**
   * Sizes the canvas to `css * min(devicePixelRatio, dprCap)`, the fog texture to a quarter of that,
   * and recomputes the group rectangles for `layout`.
   */
  resize(cssW: number, cssH: number, layout: Layout): void {
    if (this.disposed) return
    const dpr = Math.min(globalThis.devicePixelRatio || 1, this.opts.dprCap)
    const w = Math.max(1, Math.floor(cssW * dpr))
    const h = Math.max(1, Math.floor(cssH * dpr))
    this.canvas.width = w
    this.canvas.height = h
    this.applyLayout(layout, w, h, w / Math.max(1, cssW))
    this.allocFog()
    if (!this.playing && this.frozenT !== null) this.draw(performance.now())
  }

  /** Registers the callback run when the context is lost and not restored within 2 s. */
  onContextLost(cb: () => void): void {
    this.lostCb = cb
  }

  /** Stops the loop and deletes every GPU resource. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.playing = false
    this.stateCb = null
    this.lostCb = null
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    if (this.lostTimer !== null) clearTimeout(this.lostTimer)
    this.lostTimer = null
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
    SteamRenderer.release(this.gl, this.res)
  }

  /** (Re)allocates fog texture storage at the current fog size. Not a per-frame call. */
  private allocFog(): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + UNIT_FOG)
    gl.bindTexture(gl.TEXTURE_2D, this.res.texFog)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, this.fogW, this.fogH, 0, gl.RG, gl.UNSIGNED_BYTE, null)
  }

  private handleLost(e: Event): void {
    e.preventDefault()
    if (this.disposed) return
    this.resumeOnRestore = this.playing
    this.playing = false
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    if (this.lostTimer !== null) clearTimeout(this.lostTimer)
    this.lostTimer = setTimeout(() => {
      this.lostTimer = null
      this.lostCb?.()
    }, CONTEXT_RESTORE_MS)
  }

  private handleRestored(): void {
    if (this.disposed) return
    if (this.lostTimer !== null) clearTimeout(this.lostTimer)
    this.lostTimer = null
    const res = SteamRenderer.build(this.gl, this.assets, this.tokens)
    if (!res) {
      this.lostCb?.()
      return
    }
    this.res = res
    this.allocFog()
    this.lastFrame = Number.NaN
    if (this.resumeOnRestore) this.play()
    else if (this.frozenT !== null) this.draw(performance.now())
  }
}
