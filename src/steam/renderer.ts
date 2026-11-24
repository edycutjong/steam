// Raw WebGL2, two full-screen passes: a quarter-resolution fog field, then the composite.
// All GPU resources are created in `build()`; nothing is allocated per frame.

import type { NoteMeta } from './assets.ts'
import type { Derived } from './derive.ts'
import type { Layout } from './layout.ts'
import { COMPOSITE_FRAG, FOG_FRAG, VERT } from './shaders.ts'
import type { Tokens } from './tokens.ts'
import { readTokens } from './tokens.ts'

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
  /** Design tokens. Read from the canvas's CSS custom properties when absent. */
  tokens?: Tokens
}

/** Fog texture is this many canvas pixels per texel per axis. */
export const FOG_DIV = 4

const FOG_UNIFORMS = ['uSize', 'uTime', 'uThicken'] as const
const COMP_UNIFORMS = [
  'uRes', 'uDpr', 'uTime', 'uU', 'uThicken', 'uHead', 'uWipe', 'uRefog',
  'uGroupSrc', 'uGroupDst', 'uGroupCount', 'uNoteSize', 'uHeadPos', 'uHeadGroup',
  'uBg', 'uInk', 'uBefore', 'uAfter', 'uRule', 'uGhost', 'uMoon', 'uNight', 'uPot',
  'uNote', 'uChan', 'uFog',
] as const
type Locs<K extends string> = Record<K, WebGLUniformLocation | null>

/** Sampler units. */
const UNIT_NOTE = 0
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
  texNote: WebGLTexture
  texChan: WebGLTexture
  texFog: WebGLTexture
  fboFog: WebGLFramebuffer
  fogLoc: Locs<(typeof FOG_UNIFORMS)[number]>
  compLoc: Locs<(typeof COMP_UNIFORMS)[number]>
}

function texture(gl: WebGL2RenderingContext, unit: number, wrapX: number): WebGLTexture | null {
  const tex = gl.createTexture()
  if (!tex) return null
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
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
    const texNote = texture(gl, UNIT_NOTE, gl.CLAMP_TO_EDGE)
    const texChan = texture(gl, UNIT_CHAN, gl.CLAMP_TO_EDGE)
    const texFog = texture(gl, UNIT_FOG, gl.REPEAT)
    const fboFog = gl.createFramebuffer()
    if (!progFog || !progComp || !vao || !texNote || !texChan || !texFog || !fboFog) {
      SteamRenderer.release(gl, { progFog, progComp, vao, texNote, texChan, texFog, fboFog })
      return null
    }

    const [w, h] = assets.meta.size
    gl.activeTexture(gl.TEXTURE0 + UNIT_NOTE)
    gl.bindTexture(gl.TEXTURE_2D, texNote)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, assets.note)
    gl.activeTexture(gl.TEXTURE0 + UNIT_CHAN)
    gl.bindTexture(gl.TEXTURE_2D, texChan)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, assets.derived.chan)
    // Fog storage is sized by `resize`; a 1x1 placeholder keeps the framebuffer complete until then.
    gl.activeTexture(gl.TEXTURE0 + UNIT_FOG)
    gl.bindTexture(gl.TEXTURE_2D, texFog)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboFog)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texFog, 0)
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (!complete) {
      console.error('steam: fog framebuffer is incomplete')
      SteamRenderer.release(gl, { progFog, progComp, vao, texNote, texChan, texFog, fboFog })
      return null
    }

    const fogLoc = locations(gl, progFog, FOG_UNIFORMS)
    const compLoc = locations(gl, progComp, COMP_UNIFORMS)

    // Per-program constants, set once: sampler units and token colours.
    gl.useProgram(progComp)
    gl.uniform1i(compLoc.uNote, UNIT_NOTE)
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

    return { progFog, progComp, vao, texNote, texChan, texFog, fboFog, fogLoc, compLoc }
  }

  /** Deletes whichever resources exist. Safe with nulls. */
  static release(
    gl: WebGL2RenderingContext,
    r: {
      progFog: WebGLProgram | null
      progComp: WebGLProgram | null
      vao: WebGLVertexArrayObject | null
      texNote: WebGLTexture | null
      texChan: WebGLTexture | null
      texFog: WebGLTexture | null
      fboFog: WebGLFramebuffer | null
    },
  ): void {
    if (r.progFog) gl.deleteProgram(r.progFog)
    if (r.progComp) gl.deleteProgram(r.progComp)
    if (r.vao) gl.deleteVertexArray(r.vao)
    if (r.texNote) gl.deleteTexture(r.texNote)
    if (r.texChan) gl.deleteTexture(r.texChan)
    if (r.texFog) gl.deleteTexture(r.texFog)
    if (r.fboFog) gl.deleteFramebuffer(r.fboFog)
  }
}
