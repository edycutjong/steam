// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Plan } from '../../cook/plan.ts'
import { controlFor, initialState, type SchedState } from '../../cook/scheduler.ts'
import { click, css, key, mount, rerender, unmountAll } from '../render.fixture.tsx'
import WipeControl from './WipeControl.tsx'

afterEach(unmountAll)
const plan: Plan = { steps: [{ note: { id: 'p', checkAtMs: 5000 } }, { note: null }, { note: { id: 'q', checkAtMs: 0 } }, { note: null }] }
const at = (stepIndex: number, revealed: string[]): SchedState => ({ ...initialState, status: 'running', stepIndex, revealed, lastWall: 0, paceHistory: [{ atWall: 0, pace: 1 }] })
const rows: [string, SchedState, string, string][] = [
  ['no note, not last', at(1, []), 'Next step', 'wipe'],
  ['pending', at(0, []), 'Show the note', 'show'],
  ['revealed, not last', at(2, ['q']), 'Wipe the glass', 'wipe'],
  ['last step no note', at(3, []), 'The hand, quoted', 'wipe'],
]

describe('WipeControl (R14.1 to R14.6, R14.9, R14.10)', () => {
  it.each(rows)('%s: label and action from controlFor', (_n, s, label, action) => {
    let t = 0
    const spy = vi.fn()
    const h = mount(<WipeControl control={controlFor(plan, s)} writing={false} ready={false} onAct={spy} now={() => (t += 1000)} />)
    const b = h.querySelector('button')!
    expect(b.textContent).toBe(label)
    click(b)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ label, action }))
  })
  it('while writing: aria-disabled, the description "The note is being written", and no action', () => {
    const spy = vi.fn()
    const h = mount(<WipeControl control={controlFor(plan, at(2, ['q']))} writing ready={false} onAct={spy} />)
    const b = h.querySelector('button')!
    expect(b.textContent).toBe('Wipe the glass')
    expect(b.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(b.getAttribute('aria-describedby')!)!.textContent).toBe('The note is being written')
    click(b)
    key(document.body, ' ')
    expect(spy).not.toHaveBeenCalled()
  })
  it('Space on the document acts and prevents scroll, unless focus is in another button', () => {
    let t = 0
    const spy = vi.fn()
    const h = mount(<><WipeControl control={controlFor(plan, at(1, []))} writing={false} ready={false} onAct={spy} now={() => (t += 1000)} /><button id="other">x</button></>)
    const e = key(document.body, ' ')
    expect(e.defaultPrevented).toBe(true)
    expect(spy).toHaveBeenCalledTimes(1)
    key(h.querySelector('#other')!, ' ')
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('a second activation within 400 ms is ignored', () => {
    let t = 0
    const spy = vi.fn()
    const h = mount(<WipeControl control={controlFor(plan, at(1, []))} writing={false} ready={false} onAct={spy} now={() => t} />)
    const b = h.querySelector('button')!
    click(b)
    t = 399
    click(b)
    expect(spy).toHaveBeenCalledTimes(1)
    t = 800
    click(b)
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('is at least 48 x 48 (60 px tall), sits outside the pane, and takes focus when ready', () => {
    expect(/\.wipe\s*\{[^}]*min-height:\s*60px/.test(css('src/app/cook.css'))).toBe(true)
    const node = (ready: boolean) => <div><div className="stage" /><WipeControl control={controlFor(plan, at(1, []))} writing={false} ready={ready} onAct={() => {}} /></div>
    const h = mount(node(false))
    const b = h.querySelector('button')!
    expect(b.closest('.stage')).toBeNull()
    expect(document.activeElement).not.toBe(b)
    rerender(h, node(true))
    expect(document.activeElement).toBe(b)
  })
})
