import { describe, expect, it } from 'vitest'
import {
  COMPOSITE_FRAG,
  DROP_LARGE,
  DROP_MID,
  DROP_TINY,
  BROAD_AMP,
  FOG_FRAG,
  HALO_GAIN,
  LENS_WARM,
  OLD_WIPES,
  OLD_WIPE_DENSITY,
  PRESSURE_DIM,
  RAIL_DROP_BOOST,
  MENISCUS_PX,
  MENISCUS_A,
  FAR_SHADE,
  LAMP_DIR,
  WINDOW_REFRACT_CSS,
  FINGER_R_CSS,
  RUN_CHAN_FILM,
  RUN_CHAN_GHOST,
  DROP_TOP_SCALE,
  LENS_BODY,
  FINGER_CLEAR,
  PULSE_DENSITY,
  HEAD_MAX_LUMA,
  TRAIL_N,
  TRAIL_FALLOFF,
  REFRACT_MAX_CSS,
  STROKE_LUMA_MAX,
  STROKE_PEAK_MAX,
} from './shaders.ts'
import { parseColor } from './tokens.ts'

describe('composite constants (steam-renderer-v1 design §4, §5)', () => {
  it('clears by the continuous transmission, never by a threshold band (R1.4)', () => {
    expect(COMPOSITE_FRAG).toContain('trans(aInk)')
    expect(COMPOSITE_FRAG).toContain('inkCubic')
    expect(COMPOSITE_FRAG).not.toMatch(/CLEAR_MID|CLEAR_HALF|edgeHalf/)
  })
  it('caps stroke luminance at 92% and keeps --ink under that cap too (D14)', () => {
    expect(STROKE_LUMA_MAX).toBeLessThanOrEqual(0.92)
    const [r, g, b] = parseColor('#EFE7DA')
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeGreaterThan(STROKE_LUMA_MAX - 0.03)
    expect(COMPOSITE_FRAG).toContain('STROKE_LUMA_MAX / max(lum')
  })
  it('caps the largest channel in a stroke, so a clipped red cannot turn the ember yellow-white (R2.4)', () => {
    expect(STROKE_PEAK_MAX).toBeLessThanOrEqual(0.9373) // --ink's red, 239/255
    expect(COMPOSITE_FRAG).toContain('STROKE_PEAK_MAX / max(peak')
  })
  it('refracts the room lookup by 1 to 3 css px (R2.2)', () => {
    expect(REFRACT_MAX_CSS).toBeGreaterThanOrEqual(1)
    expect(REFRACT_MAX_CSS).toBeLessThanOrEqual(3)
    expect(COMPOSITE_FRAG).toContain('roomLight(vUv + refr / uRes')
    expect(FOG_FRAG).toContain('oFog = vec2(')
  })
  it('draws droplets at three scales, each cell holding at most one drop of at most 0.3 cell radius (R3.2)', () => {
    const layers = [DROP_TINY, DROP_MID, DROP_LARGE]
    for (const l of layers) {
      expect(l.rHi).toBeLessThanOrEqual(0.3 * l.cell)
      expect(l.prob).toBeLessThan(1)
    }
    expect(DROP_TINY.cell).toBeLessThan(DROP_MID.cell)
    expect(DROP_MID.cell).toBeLessThan(DROP_LARGE.cell)
    expect(COMPOSITE_FRAG).toContain('uDetail > 0.5')
  })
  it('lights the room from the pot and the candle, with uniforms for both (R2.1, R6.5)', () => {
    expect(COMPOSITE_FRAG).toMatch(/uniform vec2 uPot/)
    expect(COMPOSITE_FRAG).toMatch(/uniform vec3 uCandle/)
    expect(COMPOSITE_FRAG).toMatch(/uniform float uBloom/)
    expect(COMPOSITE_FRAG).toMatch(/uniform float uDetail/)
  })
  it('has no colour literal and no template placeholder left in the GLSL (P-S1)', () => {
    for (const src of [COMPOSITE_FRAG, FOG_FRAG]) {
      expect(src).not.toMatch(/\$\{/)
      expect(src).not.toMatch(/vec3\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)\s*\)?;?\s*\/\/\s*colour/i)
      expect(src).not.toMatch(/#[0-9a-fA-F]{6}\b/)
    }
  })
  it('ends with the --ink clamp (R12.3)', () => {
    const tail = COMPOSITE_FRAG.slice(COMPOSITE_FRAG.lastIndexOf('col = min(col, uInk)'))
    expect(tail).toContain('oColor = vec4(col, 1.0)')
  })
  it('does not contain the v0 hash-grid drip (R4.8)', () => {
    expect(COMPOSITE_FRAG).not.toContain('h > 0.9 && c < 0.2')
  })
  it('keeps the writing head a capped cold glow and gives it a breath along its path (R5.1, R5.2)', () => {
    expect(HEAD_MAX_LUMA).toBeLessThanOrEqual(0.28)
    expect(COMPOSITE_FRAG).toContain('HEAD_MAX_LUMA')
    expect(COMPOSITE_FRAG).toContain('mix(uGhost, uMoon, 0.5)')
    expect(COMPOSITE_FRAG).toMatch(/uniform vec2 uTrail\[6\]/)
    expect(TRAIL_N).toBe(6)
    expect(TRAIL_FALLOFF).toBeLessThan(1)
    // the breath thickens the film and never lowers T: it multiplies (1 - T), it is not subtracted from T
    expect(COMPOSITE_FRAG).toContain('BREATH_DENSITY * breath * (1.0 - T)')
  })
})

describe('look pass 2 constants (R13 to R17)', () => {
  it('draws a thin broken meniscus, a faint halo and a pressure-dependent fill (R14.1 to R14.3)', () => {
    expect(MENISCUS_PX).toBeLessThanOrEqual(1.2)
    expect(COMPOSITE_FRAG).toContain('(0.12 + 0.88 * brk)') // the film height and a fine noise break the rim
    expect(HALO_GAIN).toBeLessThanOrEqual(0.2)
    expect(PRESSURE_DIM).toBeLessThan(1)
    expect(COMPOSITE_FRAG).toContain('smoothstep(PRESSURE_LO, PRESSURE_HI, aInk)')
  })
  it('draws the head of a run as a lens bead with one catch-light and no white dot (R13.5)', () => {
    expect(COMPOSITE_FRAG).toContain('beadColour(headQ')
    expect(COMPOSITE_FRAG).toContain('exp(-dot(a, a) * 70.0)')
    expect(COMPOSITE_FRAG).toContain('uniform vec4 uRunC[6]')
  })
  it('bends a run by the same path as drips.ts and re-fogs it from the top (R13.3, R13.4)', () => {
    expect(COMPOSITE_FRAG).toContain('runOff(dyc')
    expect(COMPOSITE_FRAG).toContain('smoothstep(front, front')
  })
  it('keeps sill droplets few, small and cool (R15.3)', () => {
    expect(RAIL_DROP_BOOST).toBeLessThanOrEqual(1.6)
    expect(LENS_WARM).toBeLessThan(1)
    expect(COMPOSITE_FRAG).toContain('RAIL_SHRINK')
  })
  it('gives the film a history without reading the note (R16.1, R16.2)', () => {
    expect(FOG_FRAG).toContain('oldWipes(')
    expect(OLD_WIPES).toBeGreaterThanOrEqual(2)
    expect(OLD_WIPE_DENSITY).toBeLessThanOrEqual(0.12)
    expect(BROAD_AMP).toBeGreaterThan(0)
    expect(FOG_FRAG).not.toMatch(/uChan|uInkTex/)
    expect(FOG_FRAG).not.toMatch(/uTime\s*\*[^;]*oldWipes/)
  })
  it('has no light streak over the upper film (R17.1)', () => {
    expect(COMPOSITE_FRAG).not.toMatch(/STREAK|streak/)
  })
})


describe('look pass 3: the stroke is a window (R19)', () => {
  it('shows the room behind the glass at two bokeh scales, refracted by the edge, with a soft shoulder (R19.1)', () => {
    expect(COMPOSITE_FRAG).toContain('windowLight(css + refr / px + wOff')
    expect(COMPOSITE_FRAG).toContain('WINDOW_FINE_CELL')
    expect(COMPOSITE_FRAG).toContain('BOKEH_CELL')
    expect(WINDOW_REFRACT_CSS).toBeGreaterThanOrEqual(1)
    expect(WINDOW_REFRACT_CSS).toBeLessThanOrEqual(3)
  })
  it('has no brown inner outline and no flat ember fill (R19.2, R19.3)', () => {
    expect(COMPOSITE_FRAG).not.toMatch(/EDGE_SHADE|EMBER_BASE|EMBER_GAIN|inner \* outN/)
  })
  it('draws the meniscus as a thin lamp-side highlight and a slight far-side shade, never an outline (R19.4)', () => {
    expect(MENISCUS_PX).toBeLessThanOrEqual(1.2)
    expect(MENISCUS_A).toBeGreaterThan(0)
    expect(FAR_SHADE).toBeLessThanOrEqual(0.2)
    expect(LAMP_DIR[1]).toBeGreaterThan(0) // the pot and the candle are below
    expect(COMPOSITE_FRAG).toContain('smoothstep(0.05, 0.75, facing)')
    expect(COMPOSITE_FRAG).toContain('smoothstep(0.05, 0.75, -facing)')
    expect(COMPOSITE_FRAG).toContain('(0.12 + 0.88 * brk)')
  })
  it('does not threshold the ink alpha (R19.5)', () => {
    expect(COMPOSITE_FRAG).not.toMatch(/\bstep\([^)]*aInk|aInk\s*[<>]=?\s*0\.\d/)
  })
})

describe('look pass 3: the unseen finger (R21)', () => {
  it('draws a fingertip-width wet smear that clears the film and carries a cold crescent, capped and never amber (R21.1)', () => {
    expect(FINGER_R_CSS).toBeGreaterThanOrEqual(6)
    expect(FINGER_R_CSS).toBeLessThanOrEqual(12)
    expect(FINGER_CLEAR).toBeGreaterThan(0)
    expect(COMPOSITE_FRAG).toContain('uniform vec4 uFinger')
    expect(COMPOSITE_FRAG).toContain('opacity *= 1.0 - FINGER_CLEAR * fing')
    expect(COMPOSITE_FRAG).toContain('cold * (HEAD_A * 1.3) * cres')
    expect(COMPOSITE_FRAG).toContain('HEAD_MAX_LUMA')
    expect(COMPOSITE_FRAG).toContain('mix(uGhost, uMoon, 0.5)')
  })
  it('no longer draws the pale smudge at the head (R21.1)', () => {
    expect(COMPOSITE_FRAG).not.toMatch(/uHeadPos|uHeadGroup|HEAD_R\b/)
  })
  it('pulses the film when the write-on starts and blooms a cold breath at the start of the path (R21.2, R21.3)', () => {
    expect(PULSE_DENSITY).toBeGreaterThan(0)
    expect(COMPOSITE_FRAG).toContain('uniform float uBreath')
    expect(COMPOSITE_FRAG).toContain('uniform float uPre')
    expect(COMPOSITE_FRAG).toContain('uTrail[0]')
    // a pulse thickens the film where the glass is not already clear
    expect(COMPOSITE_FRAG).toContain('(PULSE_DENSITY * pulse + PRE_DENSITY * pre) * (1.0 - T)')
  })
})

describe('look pass 3: runs, droplets and the edge (R25 to R27)', () => {
  it('draws a run as a channel lighter than the film beside it, hidden over ink, ending in a bright bead (R25.1)', () => {
    expect(RUN_CHAN_FILM + RUN_CHAN_GHOST).toBeGreaterThan(0.9) // the channel carries at least the film's own light
    expect(COMPOSITE_FRAG).toContain('vec3 chan = film * RUN_CHAN_FILM')
    expect(COMPOSITE_FRAG).toContain('(1.0 - smoothstep(0.0, 0.15, T))')
    expect(COMPOSITE_FRAG).toContain('exp(-dot(a, a) * 70.0)')
  })
  it('weighs droplets by gravity: fewer and finer at the top, larger and in clusters lower; lenses are dark with a small catch-light (R26)', () => {
    expect(DROP_TOP_SCALE).toBeLessThan(1)
    expect(LENS_BODY).toBeLessThan(0.8)
    expect(COMPOSITE_FRAG).toContain('mix(0.5, 1.2, g)')
    expect(COMPOSITE_FRAG).toContain('smoothstep(0.12, 0.6, low)')
    expect(COMPOSITE_FRAG).toContain('clump')
    expect(COMPOSITE_FRAG).toContain('smoothstep(0.12, 0.7, Lb)') // warm light only where the room light reaches the lens
    expect(COMPOSITE_FRAG).toContain('exp(-dot(a, a) * 60.0)')
  })
  it('condenses at the pane edges without a hue shift (R27.1)', () => {
    expect(COMPOSITE_FRAG).not.toContain('vec3(0.94, 1.06, 1.0)')
    expect(COMPOSITE_FRAG).toContain('film *= 1.0 + 0.05 * edgeShade')
    expect(COMPOSITE_FRAG).not.toMatch(/mix\(film, uGhost/) // the cue's cold is the film's own base colour, not --ghost's blue-green
  })
})
