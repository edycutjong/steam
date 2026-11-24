// Synthetic ink pages for tests and property tests: seeded, pure, no host globals.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Canvas {
  w: number
  h: number
  ink: Uint8Array
}
export const blank = (w: number, h: number): Canvas => ({ w, h, ink: new Uint8Array(w * h) })

/** A straight stroke drawn with a `thick` x `thick` square brush; out-of-page pixels are dropped. */
export function stroke(c: Canvas, x0: number, y0: number, x1: number, y1: number, thick = 2): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2))
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n)
    const y = Math.round(y0 + ((y1 - y0) * k) / n)
    for (let dy = 0; dy < thick; dy++)
      for (let dx = 0; dx < thick; dx++) {
        const px = x + dx
        const py = y + dy
        if (px >= 0 && py >= 0 && px < c.w && py < c.h) c.ink[py * c.w + px] = 1
      }
  }
}

export interface RowSpec {
  /** Vertical centre of the row at x = x0. */
  yc: number
  /** Half height of a letter stroke. */
  hh: number
  x0: number
  /** Letters per word. */
  words: number[]
  /** Empty columns between words (before slant). */
  gap: number
  /** Lean to the right: the top of a stroke is shifted right by `slant * hh`. */
  slant: number
  /** Tilt in degrees, positive descends to the right. */
  tilt?: number
  letterW?: number
  thick?: number
}
export interface WordTruth {
  x0: number
  x1: number
}

/** Draws letters (leaning strokes joined by a short link) in words; returns each word's true x extent. */
export function textRow(c: Canvas, s: RowSpec): WordTruth[] {
  const lw = s.letterW ?? 8
  const th = s.thick ?? 2
  const tan = Math.tan(((s.tilt ?? 0) * Math.PI) / 180)
  const out: WordTruth[] = []
  let x = s.x0
  for (const n of s.words) {
    const wx0 = x
    let lo = Infinity
    let hi = -Infinity
    for (let k = 0; k < n; k++) {
      const yo = (x - s.x0) * tan
      const topX = x + s.slant * s.hh
      const botX = x - s.slant * s.hh
      stroke(c, topX, s.yc - s.hh + yo, botX, s.yc + s.hh + yo, th)
      stroke(c, botX, s.yc + yo, botX + lw, s.yc + yo + lw * tan, th)
      lo = Math.min(lo, topX, botX)
      hi = Math.max(hi, topX + th, botX + lw + th)
      x += lw
    }
    out.push({ x0: Math.floor(Math.min(lo, wx0)), x1: Math.ceil(hi) })
    x += s.gap + Math.ceil(s.slant * s.hh * 2)
  }
  return out
}

/** A full-width ruled line of `thick` rows. */
export function rule(c: Canvas, y: number, x0: number, x1: number, thick = 3): void {
  stroke(c, x0, y, x1, y, thick)
}
