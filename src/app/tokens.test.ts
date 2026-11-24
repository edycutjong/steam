import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseColor } from '../steam/tokens.ts'

// Contrast of the design tokens, computed from the values in src/index.css (R23.4, R23.5, design 11).
const css = readFileSync('src/index.css', 'utf8')
const token = (name: string) => parseColor(new RegExp(`--${name}:\\s*([^;]+);`).exec(css)![1]!)
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const L = ([r, g, b]: [number, number, number]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a: string, b: string) => {
  const [x, y] = [L(token(a)), L(token(b))].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

describe('token contrast against --bg', () => {
  it('--ink is at least 4.5:1', () => expect(contrast('ink', 'bg')).toBeGreaterThanOrEqual(4.5))
  it('--muted is at least 4.5:1', () => expect(contrast('muted', 'bg')).toBeGreaterThanOrEqual(4.5))
  it('--after (the large timer) is at least 3:1', () => expect(contrast('after', 'bg')).toBeGreaterThanOrEqual(3))
  it('--ghost (the focus ring) is at least 3:1', () => expect(contrast('ghost', 'bg')).toBeGreaterThanOrEqual(3))
  it('--bg on --ink (the primary button text) is at least 4.5:1', () => expect(contrast('bg', 'ink')).toBeGreaterThanOrEqual(4.5))
})
