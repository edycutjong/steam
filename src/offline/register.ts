// Registers the service worker, in a production build only, and never lets a failure reach the app (offline-shell).

export interface RegisterEnv {
  /** `import.meta.env.PROD`. */
  prod: boolean
  nav: { serviceWorker?: { register(url: string): Promise<unknown> } } | undefined
  /** Runs `fn` once the page has loaded, so registering never competes with the first paint. */
  whenLoaded: (fn: () => void) => void
  warn?: (msg: string) => void
}

export const SW_URL = '/sw.js'

/** Returns true when a registration was started. Dev, test and browsers without service workers return false and touch nothing. */
export function registerOfflineShell(env: RegisterEnv): boolean {
  try {
    const sw = env.nav?.serviceWorker
    if (!env.prod || !sw) return false
    const warn = env.warn ?? (() => {})
    env.whenLoaded(() => {
      try {
        void Promise.resolve(sw.register(SW_URL)).catch((e: unknown) => warn(`offline shell: registration failed: ${String(e)}`))
      } catch (e) {
        warn(`offline shell: registration failed: ${String(e)}`)
      }
    })
    return true
  } catch {
    return false
  }
}

/** The browser's environment. */
export const browserEnv = (): RegisterEnv => ({
  prod: import.meta.env.PROD,
  nav: typeof navigator === 'undefined' ? undefined : (navigator as unknown as RegisterEnv['nav']),
  whenLoaded: (fn) => (document.readyState === 'complete' ? fn() : window.addEventListener('load', fn, { once: true })),
  warn: (m) => console.warn(m),
})
