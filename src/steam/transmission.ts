// How clear the glass gets as a function of the scan's continuous ink alpha (design §3), and the bicubic filter
// the composite uses to magnify that alpha. The GLSL in shaders.ts is generated from the same constants, so the
// functions here are the tested twins of the shader's.

export const TRANS_LO = 0.03
export const TRANS_HI = 0.97
export const TRANS_GAMMA = 0.75

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * Monotone and continuous over the whole alpha range, never a narrow band: hairlines (a about 0.1 to 0.3) come out partly
 * clear, so the pen's pressure shows in how clear the glass is.
 */
export function trans(a: number): number {
  const x = clamp01((a - TRANS_LO) / (TRANS_HI - TRANS_LO))
  return Math.pow(x * x * (3 - 2 * x), TRANS_GAMMA)
}

/** Catmull-Rom weights for the four texels around a sample at fractional position f in [0, 1). They sum to 1. */
export function catmullRom1D(f: number): [number, number, number, number] {
  const f2 = f * f
  const f3 = f2 * f
  return [-0.5 * f3 + f2 - 0.5 * f, 1.5 * f3 - 2.5 * f2 + 1, -1.5 * f3 + 2 * f2 + 0.5 * f, 0.5 * f3 - 0.5 * f2]
}

/**
 * Bicubic (Catmull-Rom) sample of an 8-bit single-channel image at pixel-space position (x, y), where texel centres are at
 * integer + 0.5. Clamped to the edge, result clamped to [0, 1]. The shader's 5-tap fold of the same filter drops the four
 * corner taps, so it agrees with this to within a few thousandths on photographic data.
 */
export function sampleCatmull(data: ArrayLike<number>, w: number, h: number, x: number, y: number): number {
  const px = x - 0.5
  const py = y - 0.5
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const wx = catmullRom1D(px - x0)
  const wy = catmullRom1D(py - y0)
  let s = 0
  for (let j = 0; j < 4; j++) {
    const yy = Math.min(h - 1, Math.max(0, y0 - 1 + j))
    let row = 0
    for (let i = 0; i < 4; i++) {
      const xx = Math.min(w - 1, Math.max(0, x0 - 1 + i))
      row += wx[i] * data[yy * w + xx]
    }
    s += wy[j] * row
  }
  return clamp01(s / 255)
}
