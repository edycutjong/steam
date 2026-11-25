import { useSyncExternalStore } from 'react'

const subscribe = (cb: () => void): (() => void) => {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** `navigator.onLine`, live. True where the browser cannot tell. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => (typeof navigator === 'undefined' ? true : navigator.onLine), () => true)
}
