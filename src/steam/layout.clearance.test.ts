// hero-hold-clearance R1: on the desktop layout the ink keeps clear of the two shade bands and the block is centred in the clear glass.
import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CLEAR_CSS, GROUP_GAP_CSS, MIN_CORE_CSS_PX, SHADE_CSS, V_INSET, chooseLayout, computeLayout, type LayoutMeta } from './layout.ts'

/** public/recipes/quinces-marmalade/note-when-tender.json: the two groups of the hero deep link ("when", then "Tender,"). */
const whenTender: LayoutMeta = {
  size: [1287, 186],
  groups: [
    { rect: [1003, 32, 1255, 118], coreBand: [58, 80], t: [0, 0.5305105853051058] },
    { rect: [32, 95, 238, 154], coreBand: [126, 146], t: [0.5305105853051058, 1] },
  ],
}
/** The pane of the deep link at 1280 x 720, measured in the browser (`.steam-canvas` box). */
const PANE = { w: 724, h: 209.109375 }

const TOL = 0.5

describe('desktop layout keeps the ink clear of the shade bands (hero-hold-clearance R1)', () => {
  const l = computeLayout('page', PANE.w, PANE.h, whenTender)
  const top = Math.min(...l.groups.map((g) => g.inked[1]))
  const bottom = Math.max(...l.groups.map((g) => g.inked[3]))

  it('uses the desktop layout at this pane', () => {
    expect(chooseLayout(PANE.w)).toBe('page')
    expect(l.kind).toBe('page')
  })
  it('the lower group ends at least 12 CSS px above the bottom shade band', () => {
    expect(bottom, `inked bottom ${bottom}`).toBeLessThanOrEqual(PANE.h - SHADE_CSS - CLEAR_CSS + 1e-9)
  })
  it('the upper group starts at least 12 CSS px below the top shade band', () => {
    expect(top, `inked top ${top}`).toBeGreaterThanOrEqual(SHADE_CSS + CLEAR_CSS - 1e-9)
  })
  it('the block is centred in the clear glass, 0.5 CSS px', () => {
    const middle = (top + bottom) / 2
    expect(Math.abs(middle - PANE.h / 2), `block middle ${middle}`).toBeLessThanOrEqual(TOL)
  })
  it('keeps one scale, the group gap and the 16 CSS px core band', () => {
    const [a, b] = l.groups
    expect(a.scale).toBe(b.scale)
    expect(b.inked[1] - a.inked[3]).toBeGreaterThanOrEqual(GROUP_GAP_CSS - 1e-9)
    for (const g of l.groups) expect(g.coreBandCssPx, `group ${g.index}`).toBeGreaterThanOrEqual(MIN_CORE_CSS_PX)
  })
  it('fits is true, and false for a pane with no room between the two insets', () => {
    expect(l.fits).toBe(true)
    expect(computeLayout('page', PANE.w, 60, whenTender).fits).toBe(false)
  })
})

describe('the shade is the 16 CSS px of steam.css, and V_INSET is shade plus phone-fit clearance', () => {
  const css = readFileSync(new URL('./steam.css', import.meta.url), 'utf8')
  const rule = (sel: string, last = false): string => {
    const i = last ? css.lastIndexOf(`${sel} {`) : css.indexOf(`${sel} {`)
    expect(i, sel).toBeGreaterThanOrEqual(0)
    return css.slice(i, css.indexOf('}', i))
  }
  it('both shade rules are SHADE_CSS high', () => {
    expect(rule('.rail--meeting::after,\n.rail--bottom::before')).toContain(`height: ${SHADE_CSS}px`)
  })
  it('the gradients run into the pane from the meeting rail and from the bottom rail', () => {
    expect(rule('.rail--meeting::after', true)).toContain('top: 100%')
    expect(rule('.rail--bottom::before', true)).toContain('bottom: 100%')
  })
  it('CLEAR_CSS is the clearance the phone-fit e2e asserts', () => {
    const e2e = readFileSync(new URL('../../e2e/steam-phone-fit.spec.ts', import.meta.url), 'utf8')
    expect(e2e).toContain(`const CLEAR_CSS = ${CLEAR_CSS}`)
    expect(V_INSET).toBe(SHADE_CSS + CLEAR_CSS)
  })
})

describe('desktop layout properties (hero-hold-clearance R1)', () => {
  it('every inked rect is at least V_INSET from the top and the bottom, and the block is centred, for any pane where fits is true', () => {
    fc.assert(
      fc.property(fc.integer({ min: 641, max: 2560 }), fc.integer({ min: 120, max: 1200 }), (w, h) => {
        const l = computeLayout('page', w, h, whenTender)
        if (!l.fits) return true
        const top = Math.min(...l.groups.map((g) => g.inked[1]))
        const bottom = Math.max(...l.groups.map((g) => g.inked[3]))
        return top >= V_INSET - 1e-9 && bottom <= h - V_INSET + 1e-9 && Math.abs((top + bottom) / 2 - h / 2) <= 1e-6
      }),
    )
  })
  it('a pane that is tall enough for the rule always fits', () => {
    fc.assert(
      fc.property(fc.integer({ min: 641, max: 2560 }), fc.integer({ min: 400, max: 1200 }), (w, h) => computeLayout('page', w, h, whenTender).fits),
    )
  })
})
