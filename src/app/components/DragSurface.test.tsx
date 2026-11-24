// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { css, mount, unmountAll } from '../render.fixture.tsx'
import DragSurface from './DragSurface.tsx'

beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, toJSON() {} } as DOMRect }
})
afterEach(unmountAll)
const path = (el: Element, xs: number[], dt = 30) => {
  xs.forEach((x, i) => {
    const type = i === 0 ? 'pointerdown' : 'pointermove'
    const e = new PointerEvent(type, { bubbles: true, clientX: x, clientY: 100, pointerId: 7 })
    Object.defineProperty(e, 'timeStamp', { value: i * dt })
    act(() => void el.dispatchEvent(e))
  })
  act(() => void el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 })))
}

describe('DragSurface (R14.4, R14.9)', () => {
  it('a path that meets dragWipe calls the action once', () => {
    const spy = vi.fn()
    const s = mount(<DragSurface onDrag={spy}><i /></DragSurface>).querySelector('.stage')!
    path(s, [0, 40, 80, 120, 160, 200])
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('a tap and a short move do not', () => {
    const spy = vi.fn()
    const s = mount(<DragSurface onDrag={spy}><i /></DragSurface>).querySelector('.stage')!
    path(s, [50])
    path(s, [50, 70, 90])
    expect(spy).not.toHaveBeenCalled()
  })
  it('the surface has touch-action: none', () => {
    const s = mount(<DragSurface onDrag={() => {}}><i /></DragSurface>).querySelector('.stage') as HTMLElement
    expect(s.style.touchAction).toBe('none')
    expect(/\.stage\s*\{[^}]*touch-action:\s*none/.test(css('src/app/cook.css'))).toBe(true)
  })
})
