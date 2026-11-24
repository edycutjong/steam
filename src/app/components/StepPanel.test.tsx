// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { css, loaded, mount, text, unmountAll } from '../render.fixture.tsx'
import StepPanel from './StepPanel.tsx'

afterEach(unmountAll)
const r = loaded()

describe('StepPanel (R9.2, R9.3)', () => {
  it('shows "Step 4 of 5" and the step text built from its lines, with marks', () => {
    const h = mount(<StepPanel bundle={r.bundle} stepIndex={3} />)
    expect(text(h.querySelector('.step__of'))).toBe('Step 4 of 5')
    expect(text(h.querySelector('.step__text'))).toBe('the same weight of dry †[6.|C.] Sugar, boil the Quince, in that Liquor, & when Tender, mash them, & then put your †[sug.r|sugʳ.]')
    expect(h.querySelectorAll('.step__text .mark').length).toBe(2)
  })
  it('the text is at least 24 px, and from 1025 px at least 34 px, in Literata 500 at line height 1.3', () => {
    const c = css('src/app/app.css', 'src/app/cook.css')
    expect(/\.step__text\s*\{[^}]*\}/.exec(c)![0]).toMatch(/font-size:\s*var\(--step-size\)[\s\S]*font-weight|font-weight:\s*500[\s\S]*font-size:\s*var\(--step-size\)/)
    expect(/\.step__text\s*\{[^}]*\}/.exec(c)![0]).toMatch(/line-height:\s*1\.3/)
    expect(c).toMatch(/:root\s*\{[^}]*--step-size:\s*24px/)
    expect(c).toMatch(/@media \(min-width: 1025px\)\s*\{\s*:root\s*\{[^}]*--step-size:\s*34px/)
  })
  it('the panel has a focusable, labelled scroll region', () => {
    const s = mount(<StepPanel bundle={r.bundle} stepIndex={4} />).querySelector('.step__scroll')!
    expect(s.getAttribute('tabindex')).toBe('0')
    expect(s.getAttribute('aria-label')).toBe('Step text')
    expect(s.getAttribute('role')).toBe('region')
  })
})
