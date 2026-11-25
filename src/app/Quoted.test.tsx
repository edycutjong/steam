// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openStore } from '../data/store.ts'
import { testApp } from './app.fixture.tsx'
import { click, css, flush, loaded, mount, stubBrowser, text, unmountAll } from './render.fixture.tsx'
import Quoted from './Quoted.tsx'

beforeEach(() => { stubBrowser(); location.hash = '#/r/quinces-marmalade/quoted' })
afterEach(unmountAll)

// The test's own copy of the region arithmetic (R21.4), so the page's code is not checking itself.
function expectedUrl(b: ReturnType<typeof loaded>['bundle'], id: string): string {
  const n = b.notes.find((x) => x.id === id)!
  const c = b.source.canvas!
  const f = b.source.frame!
  const [vx, vy, vw, vh] = n.verifyBox
  const x = Math.max(0, Math.floor((vx * c.width) / f.width))
  const y = Math.max(0, Math.floor((vy * c.height) / f.height))
  const x1 = Math.min(c.width, Math.ceil(((vx + vw) * c.width) / f.width))
  const y1 = Math.min(c.height, Math.ceil(((vy + vh) * c.height) / f.height))
  return `${b.source.imageService}/${x},${y},${x1 - x},${y1 - y}/full/0/default.jpg`
}

describe('"The hand, quoted" (R20, R22.3, R3.3, R25.5)', () => {
  const r = loaded()
  const open = async (rec = r, store = openStore(null)) => {
    const h = mount(testApp({ recipes: [rec], store }).wrap(<Quoted recipe={rec} />))
    await flush()
    return h
  }
  it('the <h1> and three rows in step order, each with the crop on a paper mat, the reading, "Step n", the slip and the link', async () => {
    const h = await open()
    expect(text(h.querySelector('h1'))).toBe('The hand, quoted')
    const rows = [...h.querySelectorAll('.quote')]
    expect(rows.map((x) => text(x.querySelector('.quote__step')))).toEqual(['Step 1', 'Step 4', 'Step 5'])
    const hero = rows[2]!
    const img = hero.querySelector('.mat img')!
    expect(img.getAttribute('src')).toBe('/recipes/quinces-marmalade/note-till-it-looks-red-smooth.png')
    expect(img.getAttribute('alt')).toBe("The writer's note, handwritten: till it Looks red & smooth")
    expect(text(hero.querySelector('.quote__reading'))).toBe('till it Looks red & smooth,')
    expect(hero.querySelector('.slip')).not.toBeNull()
    expect(/\.mat\s*\{[^}]*background:\s*var\(--paper\)/.test(css('src/app/app.css'))).toBe(true)
  })
  it('the hero link is the IIIF region URL, recomputed here, opening in a new tab with its accessible name', async () => {
    const h = await open()
    const a = h.querySelector('[data-note="till-it-looks-red-smooth"] a.verify')!
    const want = expectedUrl(r.bundle, 'till-it-looks-red-smooth')
    expect(a.getAttribute('href')).toBe(want)
    expect(want).toBe('https://iiif.wellcomecollection.org/image/b18419665_MS_1810_0033.JP2/641,3660,2897,511/full/0/default.jpg')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    expect(a.getAttribute('aria-label')).toBe('Verify at source: opens the same pixels on the Wellcome Collection image server in a new tab')
    for (const n of r.notes) expect(h.querySelector(`[data-note="${n.id}"] a.verify`)!.getAttribute('href')).toBe(expectedUrl(r.bundle, n.id))
  })
  it('shows the approximate-region line, and the credit line closes the list', async () => {
    const h = await open()
    expect((text(h).match(/may take in a little of the lines beside it/g) ?? []).length).toBe(3)
    const foot = h.querySelector('.quoted__foot')!
    expect(foot.compareDocumentPosition(h.querySelector('.quoted__list')!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(text(foot.querySelector('.credit-line'))).toBe('Wellcome Collection, Public Domain Mark')
  })
  // offline-shell: the verify links need the archive's server; offline the page says so, briefly
  it('says so, once, while the browser is offline, and the links stay; online there is no such line', async () => {
    const online = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine')
    const set = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true })
    try {
      set(true)
      const h = await open()
      expect(h.querySelector('#offline-note')).toBeNull()
      expect(h.querySelector('a.verify')!.hasAttribute('aria-describedby')).toBe(false)
      set(false)
      window.dispatchEvent(new Event('offline'))
      await flush()
      expect(text(h.querySelector('#offline-note'))).toBe('You are offline. The verify links open the archive and need a connection.')
      expect(h.querySelectorAll('a.verify')).toHaveLength(3)
      expect(h.querySelector('a.verify')!.getAttribute('aria-describedby')).toBe('offline-note')
      set(true)
      window.dispatchEvent(new Event('online'))
      await flush()
      expect(h.querySelector('#offline-note')).toBeNull()
    } finally {
      delete (navigator as { onLine?: boolean }).onLine
      if (online) Object.defineProperty(Navigator.prototype, 'onLine', online)
    }
  })
  it('"Cook again" deletes the session and opens the cook route; there is no upload action', async () => {
    const store = openStore(null)
    await (await store).putSession({ recipeId: 'quinces-marmalade' })
    const h = await open(r, store)
    expect(text(h)).not.toMatch(/upload/i)
    click([...h.querySelectorAll('button')].find((b) => b.textContent === 'Cook again')!)
    await flush()
    expect(await (await store).getSession('quinces-marmalade')).toBeNull()
    expect(location.hash).toBe('#/r/quinces-marmalade/cook')
  })
  it('a withheld note leaves two rows, and the screen opens with no session', async () => {
    const h = await open(loaded((b) => { b.notes.find((n) => n.id === 'when-tender')!.verifyBox = [1, 1, 0, 0] }))
    expect(h.querySelectorAll('.quote').length).toBe(2)
  })
  // cook-mode-qa-r1 Q3
  it('the "readers disagree" description is on the † spans only: absent when no row has a mark, one hidden element when one does', async () => {
    const none = await open()
    expect(none.querySelector('#disagree-desc')).toBeNull()
    expect(text(none)).not.toContain('Two independent readers')
    unmountAll()
    const marked = await open(loaded((b) => { const l = b.lines.find((x) => x.i === 9)!; l.merged = l.merged.replace('Looks', '†[Looks|looks]') }))
    const d = marked.querySelectorAll('#disagree-desc')
    expect(d.length).toBe(1)
    expect(d[0]!.hasAttribute('hidden')).toBe(true)
    const marks = [...marked.querySelectorAll('.quote .mark')]
    expect(marks.length).toBe(1)
    expect(marks[0]!.getAttribute('aria-describedby')).toBe('disagree-desc')
    expect([...marked.querySelectorAll('[aria-describedby]')].every((e) => e.classList.contains('mark'))).toBe(true)
  })
})
