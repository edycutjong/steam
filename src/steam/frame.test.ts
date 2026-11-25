import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseColor } from './tokens.ts'

const css = readFileSync('src/steam/steam.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const idx = readFileSync('src/index.css', 'utf8')
const token = (n: string): [number, number, number] => parseColor(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{3,6})`).exec(idx)![1])
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = (c: readonly number[]): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
const contrast = (a: readonly number[], b: readonly number[]): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

describe('the window frame (R28.1)', () => {
  it('has a bevel, a putty line and a soft inner shadow, all in gradients, with no 1 px border and no box-shadow', () => {
    for (const rule of ['.sash::before,', '.rail', '.rail--bottom', '.muntin']) expect(css, rule).toContain(rule)
    expect(css).toContain('--putty')
    expect(css).toContain('--bevel-hi')
    expect(css).toMatch(/\.rail--meeting::after,\s*\.rail--bottom::before/)
    expect(css).not.toMatch(/box-shadow/)
    expect(css).not.toMatch(/border(-(top|bottom|left|right))?:\s*1px/)
  })
})

describe('the button label (R28.2)', () => {
  const [r, g, b] = token('rule')
  const bg = token('bg')
  const button = [0.7 * r + 0.3 * bg[0], 0.7 * g + 0.3 * bg[1], 0.7 * b + 0.3 * bg[2]]
  it('is --ink on the button, 4.5:1 or more, in every state', () => {
    expect(/\.wipe-btn\s*\{[^}]*color:\s*var\(--ink\)/.test(css)).toBe(true)
    expect(/\.wipe-btn\[aria-disabled='true'\]\s*\{[^}]*(color|opacity):/.test(css)).toBe(false)
    expect(contrast(token('ink'), button)).toBeGreaterThanOrEqual(4.5)
  })
  it('--muted would also pass, but --ink is used', () => {
    expect(contrast(token('muted'), button)).toBeGreaterThanOrEqual(4.5)
  })
})
