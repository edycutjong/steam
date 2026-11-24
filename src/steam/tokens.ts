// Reads the design-token CSS custom properties once and turns them into sRGB float triples for GLSL uniforms.

export type Vec3 = [number, number, number]

export const TOKEN_NAMES = ['bg', 'ink', 'before', 'after', 'rule', 'ghost', 'moon', 'night'] as const
export type TokenName = (typeof TOKEN_NAMES)[number]
export type Tokens = Record<TokenName, Vec3>

/** Parses `#RGB`, `#RRGGBB`, `rgb(r, g, b)` and `rgb(r g b)`. Throws on anything else, including empty. */
export function parseColor(raw: string): Vec3 {
  const s = raw.trim().toLowerCase()
  let m = /^#([0-9a-f]{6})$/.exec(s)
  if (m) {
    const n = parseInt(m[1], 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s)
  if (m) return [m[1], m[2], m[3]].map((c) => parseInt(c + c, 16) / 255) as Vec3
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)\s*(?:[,/]\s*[\d.]+%?\s*)?\)$/.exec(s)
  if (m) {
    const v = [m[1], m[2], m[3]].map(Number)
    if (v.every((x) => x >= 0 && x <= 255)) return v.map((x) => x / 255) as Vec3
  }
  throw new Error(`unparseable colour: "${raw}"`)
}

export function readTokens(el: Element): Tokens {
  const style = getComputedStyle(el)
  const out = {} as Tokens
  for (const name of TOKEN_NAMES) {
    const raw = style.getPropertyValue(`--${name}`)
    if (raw.trim() === '') throw new Error(`design token --${name} is missing`)
    out[name] = parseColor(raw)
  }
  return out
}
