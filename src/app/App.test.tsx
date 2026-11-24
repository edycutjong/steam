// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { createShelfLoader } from '../data/catalog.ts'
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
