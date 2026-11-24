// @vitest-environment happy-dom
import { act, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pace } from '../../cook/scheduler.ts'
import { click, css, key, mount, unmountAll } from '../render.fixture.tsx'
import FlameKnob from './FlameKnob.tsx'

afterEach(unmountAll)
function H({ spy }: { spy: (p: Pace) => void }) {
  const [p, setP] = useState<Pace>(1)
  return <FlameKnob pace={p} onPace={(x) => { spy(x); setP(x) }} />
}
const dial = (h: HTMLElement) => h.querySelector('[role="slider"]') as HTMLElement

describe('FlameKnob (R11.1 to R11.3, R11.6, R23.2)', () => {
  it('is a slider 0 to 2 with the value texts of its stops', () => {
    const h = mount(<H spy={() => {}} />)
    const d = dial(h)
    expect([d.getAttribute('aria-valuemin'), d.getAttribute('aria-valuemax'), d.getAttribute('aria-valuetext')]).toEqual(['0', '2', 'Real time'])
    key(d, 'ArrowRight')
    expect(d.getAttribute('aria-valuetext')).toBe('×4 pace')
    key(d, 'ArrowUp')
    expect(d.getAttribute('aria-valuetext')).toBe('×12 pace')
  })
  it('the arrows move between stops and clamp at the ends; each change calls onPace once', () => {
    const spy = vi.fn()
    const h = mount(<H spy={spy} />)
    const d = dial(h)
    key(d, 'ArrowLeft')
    expect(spy).not.toHaveBeenCalled()
    key(d, 'ArrowRight')
    key(d, 'ArrowRight')
    key(d, 'ArrowRight')
    expect(spy.mock.calls.map((c) => c[0])).toEqual([4, 12])
    key(d, 'ArrowDown')
    expect(spy.mock.calls.at(-1)![0]).toBe(4)
  })
  it('a click on a stop label sets it', () => {
    const spy = vi.fn()
    const h = mount(<H spy={spy} />)
    click([...h.querySelectorAll('.knob__stop')].find((b) => b.textContent === '×12')!)
    expect(spy).toHaveBeenCalledWith(12)
    expect(dial(h).getAttribute('aria-valuetext')).toBe('×12 pace')
  })
  it('a drag snaps to the nearest stop', () => {
    const spy = vi.fn()
    const h = mount(<H spy={spy} />)
    const p = (t: string, x: number) => act(() => void dial(h).dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, pointerId: 1 })))
    p('pointerdown', 100)
    p('pointermove', 145)
    p('pointerup', 145)
    expect(spy.mock.calls.map((c) => c[0])).toEqual([4])
  })
  it('each target is at least 48 x 48', () => {
    const c = css('src/app/cook.css')
    expect(/\.knob__dial\s*\{[^}]*width:\s*56px[^}]*height:\s*56px/.test(c)).toBe(true)
    expect(/\.knob__stop\s*\{[^}]*min-width:\s*48px[^}]*min-height:\s*48px/.test(c)).toBe(true)
  })
})
