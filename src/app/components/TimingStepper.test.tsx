// @vitest-environment happy-dom
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { openStore } from '../../data/store.ts'
import { testApp } from '../app.fixture.tsx'
import { click, flush, loaded, mount, text, unmountAll } from '../render.fixture.tsx'
import TimingStepper from './TimingStepper.tsx'

afterEach(unmountAll)
const r = loaded()
const note = r.notes.find((n) => n.id === 'when-tender')!

function Harness() {
  const [o, setO] = useState<Record<string, number>>({})
  return <TimingStepper recipeId="quinces-marmalade" note={note} overrides={o} setOverrides={setO} />
}
const btn = (h: HTMLElement, label: string) => [...h.querySelectorAll('button')].find((b) => b.textContent === label)!

describe('TimingStepper (R7.3, R8.2 to R8.6, R18.8)', () => {
  it('opens from the moment label and shows the value, the basis and the three buttons', async () => {
    const h = mount(testApp().wrap(<Harness />))
    const m = h.querySelector('.moment-btn')!
    expect(m.getAttribute('aria-expanded')).toBe('false')
    expect(text(m)).toContain('with its step')
    click(m)
    expect(m.getAttribute('aria-expanded')).toBe('true')
    for (const l of ['Earlier', 'Later', "Reset to the manuscript's"]) expect(btn(h, l).className).toMatch(/\bbtn\b/)
    expect(text(h)).toContain('Basis: the manuscript gives no time; the note arrives with its step')
  })
  it('"Later" twice writes 60 s, relabels "check from 1 min · set by you" and announces it; Reset restores "with its step"', async () => {
    const store = openStore(null)
    const app = testApp({ store })
    const h = mount(app.wrap(<Harness />))
    click(h.querySelector('.moment-btn'))
    click(btn(h, 'Later'))
    await flush()
    click(btn(h, 'Later'))
    await flush()
    expect(await (await store).getTiming('quinces-marmalade')).toEqual({ 'when-tender': 60 })
    expect(text(h.querySelector('.moment-btn'))).toContain('check from 1 min · set by you')
    expect(app.said.at(-1)).toBe('when Tender: check from 1 min · set by you')
    click(btn(h, "Reset to the manuscript's"))
    await flush()
    expect(await (await store).getTiming('quinces-marmalade')).toEqual({})
    expect(text(h.querySelector('.moment-btn'))).toContain('with its step')
  })
  it('clamps at the range ends', async () => {
    const store = openStore(null)
    const h = mount(testApp({ store }).wrap(<Harness />))
    click(h.querySelector('.moment-btn'))
    click(btn(h, 'Earlier'))
    await flush()
    expect(await (await store).getTiming('quinces-marmalade')).toEqual({ 'when-tender': 0 })
    expect(text(h.querySelector('.moment-btn'))).toContain('with its step · set by you')
  })
  it('with a store that is not persistent, "Not saved on this device." shows', async () => {
    const h = mount(testApp({ store: openStore(null) }).wrap(<Harness />))
    await flush()
    click(h.querySelector('.moment-btn'))
    expect(text(h)).toContain('Not saved on this device.')
  })
})
