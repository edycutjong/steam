import { describe, expect, it, vi } from 'vitest'
import { registerOfflineShell, SW_URL, type RegisterEnv } from './register.ts'

const env = (o: Partial<RegisterEnv> & { register?: () => Promise<unknown> }): { e: RegisterEnv; register: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } => {
  const register = vi.fn(o.register ?? (async () => ({})))
  const warn = vi.fn()
  return { register, warn, e: { prod: true, nav: { serviceWorker: { register } }, whenLoaded: (fn) => fn(), warn, ...o } }
}

describe('registerOfflineShell', () => {
  it('registers /sw.js in a production build', () => {
    const { e, register } = env({})
    expect(registerOfflineShell(e)).toBe(true)
    expect(register).toHaveBeenCalledWith(SW_URL)
  })
  it('does nothing in dev and test (prod false): no registration, not even a load listener', () => {
    const whenLoaded = vi.fn()
    const { e, register } = env({ prod: false, whenLoaded })
    expect(registerOfflineShell(e)).toBe(false)
    expect(register).not.toHaveBeenCalled()
    expect(whenLoaded).not.toHaveBeenCalled()
  })
  it('does nothing where there is no service worker support', () => {
    expect(registerOfflineShell({ prod: true, nav: {}, whenLoaded: (f) => f() })).toBe(false)
    expect(registerOfflineShell({ prod: true, nav: undefined, whenLoaded: (f) => f() })).toBe(false)
  })
  it('waits for the page to load before it registers', () => {
    let run: () => void = () => {}
    const { e, register } = env({ whenLoaded: (fn) => (run = fn) })
    registerOfflineShell(e)
    expect(register).not.toHaveBeenCalled()
    run()
    expect(register).toHaveBeenCalledTimes(1)
  })
  it('a rejected registration is a warning, never an error that reaches the app', async () => {
    const { e, warn } = env({ register: () => Promise.reject(new Error('SecurityError')) })
    expect(() => registerOfflineShell(e)).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SecurityError'))
  })
  it('a registration that throws at once is caught the same way', () => {
    const throwing = vi.fn(() => {
      throw new Error('boom')
    })
    const warn = vi.fn()
    expect(() => registerOfflineShell({ prod: true, nav: { serviceWorker: { register: throwing } }, whenLoaded: (f) => f(), warn })).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
  it('a navigator whose serviceWorker getter throws leaves the app alone', () => {
    const nav = {
      get serviceWorker(): never {
        throw new Error('denied')
      },
    }
    expect(registerOfflineShell({ prod: true, nav: nav as never, whenLoaded: (f) => f() })).toBe(false)
  })
})
