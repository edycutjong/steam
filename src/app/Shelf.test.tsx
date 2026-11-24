// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openStore } from '../data/store.ts'
import { testApp } from './app.fixture.tsx'
import { click, css, flush, loaded, mount, text, unmountAll } from './render.fixture.tsx'
import Shelf from './Shelf.tsx'

beforeEach(() => { location.hash = '#/' })
afterEach(unmountAll)

describe('Shelf (R4, R2.8)', () => {
  it('title, the intro line, one card with its thumbnail, title link, slip and two buttons; no upload card', async () => {
    const { wrap } = testApp({ recipes: [loaded()] })
    const host = mount(wrap(<Shelf />))
    await flush()
    expect(text(host.querySelector('h1'))).toBe('Recipes in a hand')
    expect(text(host.querySelector('.lede'))).toBe("Every note you'll see is the writer's own hand, photographed. Nothing is generated.")
    expect(host.querySelectorAll('.shelf__item').length).toBe(1)
    const img = host.querySelector('.shelf__item img')!
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('width')).toBe('1601')
    expect(img.getAttribute('height')).toBe('2052')
    expect(img.getAttribute('alt')).toBe('The manuscript page, MS.1810 p.23')
    expect(host.querySelector('.mat')).not.toBeNull()
    expect(host.querySelector('h2 a')!.getAttribute('href')).toBe('#/r/quinces-marmalade')
    expect(host.querySelector('.slip')).not.toBeNull()
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Cook it', 'Watch it at ×12'])
    expect(text(host)).not.toMatch(/upload|Add a page/i)
    expect(text(host)).toContain('Wellcome Collection, Public Domain Mark')
  })
  it('"Cook it" deletes the saved session and opens the cook route; "Watch it at ×12" adds pace=12; introSeen is then kept', async () => {
    const store = openStore(null)
    const s = await store
    await s.putSession({ recipeId: 'quinces-marmalade' })
    const { wrap } = testApp({ recipes: [loaded()], store })
    const host = mount(wrap(<Shelf />))
    await flush()
    click(host.querySelectorAll('button')[0]!)
    await flush()
    expect(await s.getSession('quinces-marmalade')).toBeNull()
    expect(location.hash).toBe('#/r/quinces-marmalade/cook')
    click(host.querySelectorAll('button')[1]!)
    await flush()
    expect(location.hash).toBe('#/r/quinces-marmalade/cook?pace=12')
    expect(await s.getSetting('introSeen')).toBe(true)
    unmountAll()
    const again = mount(testApp({ recipes: [loaded()], store }).wrap(<Shelf />))
    await flush()
    expect(again.querySelector('.lede')!.className).toContain('lede--standing')
  })
  it('an empty result shows "No recipe could be loaded."', async () => {
    const host = mount(testApp({ recipes: [] }).wrap(<Shelf />))
    expect(text(host)).toContain('No recipe could be loaded.')
  })
  it('the opening state shows no card (the shell announces "Opening the shelf…", App.test)', () => {
    const host = mount(testApp({ shelf: { state: 'loading' } }).wrap(<Shelf />))
    expect(host.querySelectorAll('.shelf__item').length).toBe(0)
  })
  it('buttons are at least 48 x 48 CSS px', () => {
    const rule = /\.btn\s*\{[^}]*\}/.exec(css('src/app/app.css'))![0]
    expect(rule).toMatch(/min-width:\s*48px/)
    expect(rule).toMatch(/min-height:\s*48px/)
  })
})
