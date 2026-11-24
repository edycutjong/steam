import { NOT_FOUND } from '../copy/strings.ts'
import { useScreen } from './useScreen.ts'

export default function NotFound() {
  const h1 = useScreen(NOT_FOUND.title)
  return (
    <main className="screen">
      <h1 ref={h1} tabIndex={-1} className="screen-title">
        {NOT_FOUND.title}
      </h1>
      <p>
        <a className="btn" href="#/">
          {NOT_FOUND.back}
        </a>
      </p>
    </main>
  )
}
