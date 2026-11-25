import { QUOTED } from '../copy/strings.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import { regionUrl } from '../data/provenance.ts'
import { quoteSegments } from '../data/reading.ts'
import { useApp } from './AppContext.tsx'
import ArchiveSlip, { creditLine } from './components/ArchiveSlip.tsx'
import ReadingText, { DisagreeDescription, hasMarks } from './components/ReadingText.tsx'
import { startFresh } from './Shelf.tsx'
import { formatRoute } from './router.ts'
import { useScreen } from './useScreen.ts'

/** Every note the writer left, as the scan shows it, each with a link to the same pixels on the archive's server (R20). */
export default function Quoted({ recipe }: { recipe: LoadedRecipe }) {
  const b = recipe.bundle
  const h1 = useScreen(QUOTED.title)
  const { store } = useApp()
  return (
    <main className="screen quoted">
      <p className="kicker">{b.title}</p>
      <h1 ref={h1} tabIndex={-1} className="screen-title">
        {QUOTED.title}
      </h1>
      <DisagreeDescription show={recipe.notes.some((n) => hasMarks(quoteSegments(b, n)))} />
      <ol className="quoted__list">
        {recipe.notes.map((n) => {
          const href = regionUrl(b, n)!
          return (
            <li key={n.id} className="quote" data-note={n.id}>
              <div className="mat quote__crop" style={{ width: 2 * n.size[0] }}>
                {/* scaled by CSS only, never above twice its pixel size (design 10.3) */}
                <img src={`/recipes/${b.id}/${n.files.png}`} width={n.size[0]} height={n.size[1]} alt={QUOTED.noteAlt(n.span)} loading="lazy" />
              </div>
              <div className="quote__body">
              <p className="quote__step">{QUOTED.step(n.step)}</p>
              <p className="quote__reading">
                <ReadingText segments={quoteSegments(b, n)} />
              </p>
              <ArchiveSlip bundle={b} compact />
              <div>
                <a className="verify" href={href} target="_blank" rel="noopener noreferrer" aria-label={QUOTED.verifyName}>
                  {QUOTED.verify}
                </a>
                {n.verifyApproximate ? <p className="quote__approx">{QUOTED.approximate}</p> : null}
              </div>
              </div>
            </li>
          )
        })}
      </ol>
      <footer className="quoted__foot">
        <p className="credit-line">{creditLine(b)}</p>
        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={() => void startFresh(store, b.id, formatRoute({ name: 'cook', id: b.id, pace: 1, note: null, lead: null, fps: false }))}>
            {QUOTED.cookAgain}
          </button>
          <a className="btn" href={formatRoute({ name: 'edition', id: b.id })}>
            {QUOTED.backToEdition}
          </a>
        </div>
      </footer>
    </main>
  )
}
