// @vitest-environment happy-dom
import { act, createElement, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import StaticPane, { paneImage } from './StaticPane.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('StaticPane images per note (R15.10)', () => {
  it('paneImage names <dir>/<noteId>-<kind>-<state>.webp', () => {
    expect(paneImage('/recipes/quinces-marmalade/panes', 'when-tender', 'page', 'fogged')).toBe('/recipes/quinces-marmalade/panes/when-tender-page-fogged.webp')
    expect(paneImage('/p', 'a', 'groups', 'wiped')).toBe('/p/a-groups-wiped.webp')
  })
  const mount = (fogOnly: boolean) => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    const host = document.createElement('div')
    document.body.append(host)
    const ref = createRef<{ startReveal(): void; wipe(): void } | null>() as { current: { startReveal(): void; wipe(): void } | null }
    act(() => createRoot(host).render(createElement(StaticPane, { paneDir: '/d', noteId: 'n', params: { t: null, lead: Infinity, fps: false }, controllerRef: ref, onState: () => {}, fogOnly })))
    return host
  }
  it('renders three stacked images for a note, in fogged, held, wiped order', () => {
    const imgs = [...mount(false).querySelectorAll('img')]
    expect(imgs.map((i) => i.getAttribute('src')!.replace(/-(page|groups)-/, '-K-'))).toEqual(['/d/n-K-fogged.webp', '/d/n-K-held.webp', '/d/n-K-wiped.webp'])
  })
  it('fogOnly renders the fogged image only', () => {
    const imgs = [...mount(true).querySelectorAll('img')]
    expect(imgs.length).toBe(1)
    expect(imgs[0]!.getAttribute('src')).toMatch(/-fogged\.webp$/)
  })
})
