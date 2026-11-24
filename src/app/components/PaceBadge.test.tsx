// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { css, mount, text, unmountAll } from '../render.fixture.tsx'
import PaceBadge from './PaceBadge.tsx'

afterEach(unmountAll)

describe('PaceBadge (R11.4, R25.4)', () => {
  it('is absent at pace 1 and names the pace otherwise', () => {
    expect(mount(<PaceBadge pace={1} />).innerHTML).toBe('')
    expect(text(mount(<PaceBadge pace={4} />))).toBe('×4 pace')
    expect(text(mount(<PaceBadge pace={12} />))).toBe('×12 pace')
  })
  it('is set in DM Mono and pinned top right of the stage', () => {
    const rule = /\.badge\s*\{[^}]*\}/.exec(css('src/app/cook.css'))![0]
    expect(rule).toMatch(/font-family:\s*var\(--face-data\)/)
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/top:\s*12px/)
    expect(rule).toMatch(/right:/)
  })
})
