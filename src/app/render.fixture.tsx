// Test helpers for the DOM tests (happy-dom): mount a React tree, advance fake timers inside act, read the real bundle.
import { readFileSync } from 'node:fs'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { vi } from 'vitest'
import { displayableNotes } from '../data/provenance.ts'
import { RecipeBundle } from '../data/schema.ts'
import type { LoadedRecipe } from '../data/catalog.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export const bundleText = readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')
export const realBundle = (): RecipeBundle => RecipeBundle.parse(JSON.parse(bundleText))
export function loaded(edit?: (b: RecipeBundle) => void): LoadedRecipe {
  const bundle = realBundle()
  edit?.(bundle)
  const d = displayableNotes(bundle)
  return { bundle, notes: d.notes, withheld: d.withheld }
}

const roots: Root[] = []
export function mount(node: ReactNode): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  const r = createRoot(host)
  roots.push(r)
  act(() => r.render(node))
  return host
}
export function rerender(host: HTMLElement, node: ReactNode): void {
  const i = [...document.body.children].indexOf(host)
  act(() => roots[i]!.render(node))
}
export function unmountAll(): void {
  for (const r of roots.splice(0)) act(() => r.unmount())
  document.body.innerHTML = ''
}
export const tick = async (ms = 0): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
export const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}
export const click = (el: Element | null): void => {
  if (!el) throw new Error('click: no element')
  act(() => (el as HTMLElement).click())
}
export const key = (el: Element | Document, k: string, opts: KeyboardEventInit = {}): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, cancelable: true, ...opts })
  act(() => void el.dispatchEvent(e))
  return e
}
export const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
/** Reads the CSS files a component imports, for assertions on rules (happy-dom does not apply media queries). */
export const css = (...files: string[]): string => files.map((f) => readFileSync(f, 'utf8')).join('\n')
export const stubBrowser = (): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
}
