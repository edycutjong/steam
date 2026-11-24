// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, expect, it } from 'vitest'

// R23.7, R26.1: the test environment can open IndexedDB and render React into a DOM.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('test environment', () => {
  it('opens a database with fake-indexeddb', async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('smoke', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('s')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    expect([...db.objectStoreNames]).toEqual(['s'])
    db.close()
  })
  it('renders a button with react-dom/client and reads it back', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(async () => createRoot(host).render(createElement('button', null, 'Wipe')))
    expect(host.querySelector('button')?.textContent).toBe('Wipe')
  })
})
