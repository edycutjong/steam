// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { createShelfLoader, type Rejection, type ShelfResult } from '../data/catalog.ts'
import { openStore } from '../data/store.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bundleText = readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')
const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8'))
const fetchMock = vi.fn(async (url: string) => (String(url).endsWith('/recipe.json') ? new Response(bundleText) : new Response('{}', { status: 404 })))

let root: Root | null = null
let host: HTMLElement
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  fetchMock.mockClear()
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  location.hash = ''
})

async function open(hash: string) {
  location.hash = hash
  const loader = createShelfLoader(fetchMock as unknown as typeof fetch, catalog)
  const store = openStore(null)
  await act(async () => {
    root = createRoot(host)
    root.render(createElement(App, { loader: () => loader.load(), store }))
    await vi.advanceTimersByTimeAsync(100)
  })
}
const go = async (hash: string) => {
  await act(async () => {
    location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await vi.advanceTimersByTimeAsync(100)
  })
}
const h1 = () => host.querySelector('h1')?.textContent

describe('App shell and routes (R1, R15.8, R23.6)', () => {
  it('#/ renders the shelf <h1>', async () => {
    await open('#/')
    expect(h1()).toBe('Recipes in a hand')
  })
  it('#/r/<id> renders the edition <h1>', async () => {
    await open('#/r/quinces-marmalade')
    expect(h1()).toBe('To make Marmalade of Quinces')
  })
  it('#/r/nope shows "This recipe is not on the shelf" with a link to #/', async () => {
    await open('#/r/nope')
    expect(h1()).toBe('This recipe is not on the shelf')
    expect(host.querySelector('a[href="#/"]')).not.toBeNull()
  })
  it('#/zzz shows the same screen', async () => {
    await open('#/zzz')
    expect(h1()).toBe('This recipe is not on the shelf')
  })
  it('#/pane/<id>/<noteId> renders SteamPane for that note, reading its parameters from the hash query only', async () => {
    const search = vi.spyOn(window.location, 'search', 'get').mockImplementation(() => { throw new Error('read location.search') })
    await open('#/pane/quinces-marmalade/till-it-looks-red-smooth?t=2000&lead=0&fps=1')
    expect(host.querySelector('section.steam-root')).not.toBeNull()
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/recipes/quinces-marmalade/note-till-it-looks-red-smooth.json')
    expect(host.querySelector('.fps')).not.toBeNull() // fps=1 came from the hash query
    search.mockRestore()
  })
  it('a hashchange back to the previous hash restores the previous screen', async () => {
    await open('#/')
    await go('#/r/quinces-marmalade')
    expect(h1()).toBe('To make Marmalade of Quinces')
    await go('#/')
    expect(h1()).toBe('Recipes in a hand')
  })
  it('a route change sets document.title and focuses the <h1>, except on the cook route', async () => {
    await open('#/')
    expect(document.title).toBe('Recipes in a hand · Her Hand in the Steam')
    expect(document.activeElement).toBe(host.querySelector('h1'))
    await go('#/r/quinces-marmalade')
    expect(document.title).toBe('To make Marmalade of Quinces · Her Hand in the Steam')
    expect(document.activeElement).toBe(host.querySelector('h1'))
    await go('#/r/quinces-marmalade/cook')
    expect(document.activeElement).not.toBe(host.querySelector('h1'))
  })
  it('the live region says "Opening the shelf…" while bundles load', async () => {
    location.hash = '#/'
    await act(async () => {
      root = createRoot(host)
      root.render(createElement(App, { loader: () => new Promise<never>(() => {}), store: openStore(null) }))
      await vi.advanceTimersByTimeAsync(100)
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) }) // the effect that announces runs when the first act exits
    expect(host.querySelector('[role="status"]')!.textContent).toBe('Opening the shelf…')
  })
  it('exactly one live region exists', async () => {
    await open('#/')
    expect(host.querySelectorAll('[role="status"], [aria-live]').length).toBe(1)
    await go('#/r/quinces-marmalade/quoted')
    expect(host.querySelectorAll('[role="status"], [aria-live]').length).toBe(1)
  })
  it('never reads location.search anywhere in src outside the spike\'s params reader', () => {
    expect(readFileSync('src/App.tsx', 'utf8')).not.toContain('location.search')
    expect(readFileSync('src/app/useRoute.ts', 'utf8')).not.toContain('location.search')
  })
})

// a2a-arch-r06 C1: the shelf's transport failures are not final; the screen says so and can ask again.
describe('a deep link whose load failed on transport can be retried (a2a-arch-r06 C1)', () => {
  const rejection = (transient: boolean): Rejection => ({ id: 'quinces-marmalade', reason: 'recipe.json: HTTP 503', ...(transient ? { transient: true } : {}) }) as Rejection
  const failed = (r: Rejection): ShelfResult => ({ recipes: [], rejected: [r] })
  let good: ShelfResult
  beforeEach(async () => {
    vi.useRealTimers()
    good = await createShelfLoader(fetchMock as unknown as typeof fetch, catalog).load()
    vi.useFakeTimers()
  })
  async function mount(hash: string, loader: () => Promise<ShelfResult>) {
    location.hash = hash
    await act(async () => {
      root = createRoot(host)
      root.render(createElement(App, { loader, store: openStore(null) }))
      await vi.advanceTimersByTimeAsync(100)
    })
  }
  const retryBtn = () => [...host.querySelectorAll('button')].find((b) => /try again/i.test(b.textContent ?? '')) ?? null
  const press = async (el: Element) => {
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(100)
    })
  }

  it('a transient rejection shows the one short line and a "Try again" button; the plain not-found heading stays', async () => {
    await mount('#/r/quinces-marmalade', async () => failed(rejection(true)))
    expect(h1()).toBe('This recipe is not on the shelf')
    const b = retryBtn()
    expect(b).not.toBeNull()
    expect(b!.type).toBe('button')
    expect(b!.classList.contains('btn')).toBe(true) // 48 px high in app.css (see the css check below)
    const lines = [...host.querySelectorAll('main p')].map((p) => p.textContent ?? '').filter((t) => /did not load/i.test(t))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.length).toBeLessThan(80)
  })
  it('Try again runs the loader again; a recipe that loads replaces the not-found screen on the same route', async () => {
    const loader = vi.fn<() => Promise<ShelfResult>>().mockResolvedValueOnce(failed(rejection(true))).mockResolvedValue(good)
    await mount('#/r/quinces-marmalade', loader)
    expect(loader).toHaveBeenCalledTimes(1)
    await press(retryBtn()!)
    expect(loader).toHaveBeenCalledTimes(2)
    expect(h1()).toBe('To make Marmalade of Quinces')
    expect(location.hash).toBe('#/r/quinces-marmalade')
    expect(retryBtn()).toBeNull()
  })
  it('a retry that fails again keeps the screen and the button, usable again', async () => {
    const loader = vi.fn<() => Promise<ShelfResult>>().mockResolvedValue(failed(rejection(true)))
    await mount('#/r/quinces-marmalade', loader)
    await press(retryBtn()!)
    expect(loader).toHaveBeenCalledTimes(2)
    expect(h1()).toBe('This recipe is not on the shelf')
    const b = retryBtn()
    expect(b).not.toBeNull()
    expect(b!.getAttribute('aria-disabled')).not.toBe('true')
    await press(b!)
    expect(loader).toHaveBeenCalledTimes(3)
  })
  it('the window "online" event runs the loader again while a transient rejection exists, and the recipe replaces not-found', async () => {
    const loader = vi.fn<() => Promise<ShelfResult>>().mockResolvedValueOnce(failed(rejection(true))).mockResolvedValue(good)
    await mount('#/r/quinces-marmalade', loader)
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(loader).toHaveBeenCalledTimes(2)
    expect(h1()).toBe('To make Marmalade of Quinces')
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(loader).toHaveBeenCalledTimes(2) // nothing transient is left: "online" asks for nothing
  })
  it('a 404 or a content failure keeps the plain not-found: no line, no button, and "online" does nothing', async () => {
    const loader = vi.fn<() => Promise<ShelfResult>>().mockResolvedValue(failed(rejection(false)))
    await mount('#/r/quinces-marmalade', loader)
    expect(h1()).toBe('This recipe is not on the shelf')
    expect(retryBtn()).toBeNull()
    expect(host.querySelectorAll('main p').length).toBe(1) // only the back link's paragraph
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(loader).toHaveBeenCalledTimes(1)
  })
  it('an id the catalog does not list is plain not-found even while another recipe is transient', async () => {
    await mount('#/r/nope', async () => failed(rejection(true)))
    expect(h1()).toBe('This recipe is not on the shelf')
    expect(retryBtn()).toBeNull()
  })
  it('the button is keyboard operable: a native button in the tab order, not disabled', async () => {
    await mount('#/r/quinces-marmalade', async () => failed(rejection(true)))
    const b = retryBtn()!
    expect(b.tabIndex).toBe(0)
    expect(b.hasAttribute('disabled')).toBe(false)
  })
  it('a retry already running is not started twice', async () => {
    let release!: (r: ShelfResult) => void
    const loader = vi.fn<() => Promise<ShelfResult>>().mockResolvedValueOnce(failed(rejection(true))).mockImplementationOnce(() => new Promise<ShelfResult>((r) => (release = r)))
    await mount('#/r/quinces-marmalade', loader)
    const b = retryBtn()!
    await press(b)
    await press(retryBtn()!)
    expect(loader).toHaveBeenCalledTimes(2)
    await act(async () => {
      release(good)
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(h1()).toBe('To make Marmalade of Quinces')
  })
  it('the button is at least 44 px high in app.css', () => {
    const css = readFileSync('src/app/app.css', 'utf8')
    const rule = /(?:^|\n)\.btn \{([^}]*)\}/.exec(css)![1]!
    expect(Number(/min-height:\s*(\d+)px/.exec(rule)![1])).toBeGreaterThanOrEqual(44)
  })
})
