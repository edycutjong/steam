import { NOT_FOUND } from '../copy/strings.ts'
import { useScreen } from './useScreen.ts'

export interface Retry {
  /** Runs the shelf load again. */
  run(): void
  /** A load that this button started is still running. */
  busy: boolean
}

/** `retry` is given only when the recipe's load failed on the network (a2a-arch-r06 C1); a 404 or a content failure is plain. */
export default function NotFound({ retry }: { retry?: Retry }) {
  const h1 = useScreen(NOT_FOUND.title)
  return (
    <main className="screen">
      <h1 ref={h1} tabIndex={-1} className="screen-title">
        {NOT_FOUND.title}
      </h1>
      {retry ? <p data-transient>{NOT_FOUND.transient}</p> : null}
      <p className="btn-row">
        {retry ? (
          <button type="button" className="btn btn--primary" aria-disabled={retry.busy ? true : undefined} onClick={() => !retry.busy && retry.run()}>
            {NOT_FOUND.retry}
          </button>
        ) : null}
        <a className="btn" href="#/">
          {NOT_FOUND.back}
        </a>
      </p>
    </main>
  )
}
