import { SHELF } from '../copy/strings.ts'
import { useScreen } from './useScreen.ts'

// Filled in by task 33.
export default function Shelf() {
  const h1 = useScreen(SHELF.title)
  return (
    <main className="screen">
      <h1 ref={h1} tabIndex={-1} className="screen-title">
        {SHELF.title}
      </h1>
    </main>
  )
}
