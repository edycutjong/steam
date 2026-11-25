// @vitest-environment happy-dom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Candle from './Candle.tsx'
import NightView, { STAR_COUNT, stars } from './NightView.tsx'

const html = (el: React.ReactElement): string => renderToStaticMarkup(el)

describe('NightView (R6.1, R6.2, R6.6)', () => {
  const out = html(createElement(NightView, { haunt: 'calm' }))
  it('is an SVG night with at least 15 stars, a moon, branches, a cloud and a muntin', () => {
    expect(STAR_COUNT).toBeGreaterThanOrEqual(15)
    expect(stars(1751)).toHaveLength(STAR_COUNT)
    expect(out).toContain('<svg')
    expect(out).toContain('class="moon"')
    expect(out).toContain('night__branches')
    expect(out).toContain('night__cloud-haunt')
    expect(out).toContain('class="muntin"')
    expect(out.match(/<circle/g)!.length).toBeGreaterThanOrEqual(STAR_COUNT + 2)
  })
  it('uses SVG gradients and filters only: no raster, no clip-art', () => {
    expect(out).not.toMatch(/<image|\.png|\.jpg|\.webp|data:image/)
    expect(out).toContain('feGaussianBlur')
    expect(out).toContain('radialGradient')
  })
  it('carries the haunt state on the sash', () => {
    for (const h of ['calm', 'gather', 'clear'] as const) expect(html(createElement(NightView, { haunt: h }))).toContain(`data-haunt="${h}"`)
  })
  it('seeds the stars: the same seed gives the same stars and none sits on the moon', () => {
    expect(stars(5)).toEqual(stars(5))
    for (const s of stars(5)) expect(Math.hypot(s.x - 760, s.y - 196)).toBeGreaterThan(58 * 2)
  })
})

describe('Candle (R6.4)', () => {
  const out = html(createElement(Candle, { haunt: 'calm' }))
  it('has wax, runs, a wick and a flame the shader can find', () => {
    expect(out).toContain('candle__flame')
    expect(out).toContain('data-candle-flame')
    expect(out.match(/candle__run/g)!.length).toBeGreaterThanOrEqual(2)
    expect(out).toContain('candle__wick')
  })
  it('is still under prefers-reduced-motion: the CSS turns off every flame animation', () => {
    const css = readFileSync('src/steam/steam.css', 'utf8')
    const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}\n/.exec(css)![1]
    expect(block).toMatch(/\.candle__flame[\s\S]*animation:\s*none/)
    expect(block).toMatch(/\.night__cloud-drift[\s\S]*animation:\s*none/)
    expect(block).toMatch(/\.night__cloud-haunt[\s\S]*transition:\s*none/)
  })
  it('uses design tokens only (no colour literal in the sash CSS)', () => {
    const css = readFileSync('src/steam/steam.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(css).not.toMatch(/\brgba?\(/)
  })
})
