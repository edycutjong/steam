import { useEffect, useRef } from 'react'
import { titleFor } from '../copy/strings.ts'

/**
 * Sets `document.title` to the screen name followed by the product title, and moves focus to the screen's `<h1>` when the screen
 * opens (R1.5). Cook Mode passes `focus: false`: it focuses the Wipe control instead (R14.9).
 */
export function useScreen(name: string, focus = true) {
  const h1 = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    document.title = titleFor(name)
  }, [name])
  useEffect(() => {
    if (focus) h1.current?.focus({ preventScroll: true })
  }, [focus])
  return h1
}
