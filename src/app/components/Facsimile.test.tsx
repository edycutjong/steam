// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { click, css, key, mount, stubBrowser, text, unmountAll } from '../render.fixture.tsx'
import Facsimile from './Facsimile.tsx'

beforeEach(() => {
  stubBrowser()
  Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, toJSON() {} } as DOMRect }
})
afterEach(unmountAll)

const make = () => mount(<Facsimile src="/recipes/quinces-marmalade/page.jpg" width={1601} height={2052} credit="Wellcome Collection, Public Domain Mark" />)
const view = (h: HTMLElement) => h.querySelector('.facsimile__viewport') as HTMLElement
const scale = (h: HTMLElement) => Number(view(h).dataset.scale)

describe('Facsimile (R5.1, R5.2, R5.6, R23.2)', () => {
  it('the scan has its text alternative and the credit line, and no CSS filter', () => {
    const h = make()
    expect(view(h).getAttribute('aria-label')).toBe('A photograph of the manuscript page. The transcription beside it gives the same words.')
    expect(text(h)).toContain('Wellcome Collection, Public Domain Mark')
    expect(h.querySelector('img')!.getAttribute('style') ?? '').not.toMatch(/filter/)
    expect(css('src/app/app.css')).not.toMatch(/(^|[^-])filter\s*:/m)
  })
  it('three buttons "Zoom in", "Zoom out", "Reset" with the 48 px button class', () => {
    const b = [...make().querySelectorAll('button')]
    expect(b.map((x) => x.textContent)).toEqual(['Zoom in', 'Zoom out', 'Reset'])
    for (const x of b) expect(x.classList.contains('btn')).toBe(true)
  })
  it('buttons zoom and reset', () => {
    const h = make()
    click(h.querySelectorAll('button')[0]!)
    expect(scale(h)).toBeCloseTo(1.5, 3)
    click(h.querySelectorAll('button')[1]!)
    expect(scale(h)).toBeCloseTo(1, 3)
    click(h.querySelectorAll('button')[0]!)
    click(h.querySelectorAll('button')[2]!)
    expect(scale(h)).toBe(1)
  })
  it('the keys + - 0 and the arrows act when the viewport has focus', () => {
    const h = make()
    view(h).focus()
    key(view(h), '+')
    expect(scale(h)).toBeCloseTo(1.5, 3)
    const before = (h.querySelector('.facsimile__layer') as HTMLElement).style.transform
    const e = key(view(h), 'ArrowRight')
    expect(e.defaultPrevented).toBe(true)
    expect((h.querySelector('.facsimile__layer') as HTMLElement).style.transform).not.toBe(before)
    key(view(h), '-')
    expect(scale(h)).toBeCloseTo(1, 3)
    key(view(h), '+')
    key(view(h), '0')
    expect(scale(h)).toBe(1)
  })
  it('Ctrl + wheel zooms; a plain wheel at scale 1 is not prevented; at scale 2 it pans', () => {
    const h = make()
    const w = (o: WheelEventInit) => { const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...o }); for (const [k, v] of Object.entries({ ctrlKey: !!o.ctrlKey, metaKey: false, clientX: 200, clientY: 150, deltaX: 0 })) Object.defineProperty(e, k, { value: v }) /* happy-dom drops these */; act(() => void view(h).dispatchEvent(e)); return e }
    expect(w({ deltaY: 100 }).defaultPrevented).toBe(false)
    expect(scale(h)).toBe(1)
    expect(w({ deltaY: -300 * Math.log(2), ctrlKey: true }).defaultPrevented).toBe(true)
    expect(scale(h)).toBeCloseTo(2, 2)
    const before = (h.querySelector('.facsimile__layer') as HTMLElement).style.transform
    expect(w({ deltaY: 50 }).defaultPrevented).toBe(true)
    expect((h.querySelector('.facsimile__layer') as HTMLElement).style.transform).not.toBe(before)
  })
  it('a two-pointer pinch zooms', () => {
    const h = make()
    const p = (type: string, id: number, x: number) => act(() => void view(h).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: id, clientX: x, clientY: 150 })))
    p('pointerdown', 1, 150)
    p('pointerdown', 2, 250)
    p('pointermove', 2, 350)
    expect(scale(h)).toBeCloseTo(2, 3)
    p('pointerup', 1, 150)
    p('pointerup', 2, 350)
  })
})
