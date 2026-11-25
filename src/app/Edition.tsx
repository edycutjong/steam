import { Fragment, useEffect, useState } from 'react'
import { EDITION, SLIP } from '../copy/strings.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import { parseReading } from '../data/reading.ts'
import type { BundleNote } from '../data/schema.ts'
import { useApp } from './AppContext.tsx'
import ArchiveSlip, { creditLine, readersLine } from './components/ArchiveSlip.tsx'
import Facsimile from './components/Facsimile.tsx'
import TimingStepper from './components/TimingStepper.tsx'
import ReadingText, { DisagreeDescription, hasMarks } from './components/ReadingText.tsx'
import { startFresh } from './Shelf.tsx'
import { formatRoute } from './router.ts'
import { useScreen } from './useScreen.ts'

const pad2 = (i: number): string => String(i).padStart(2, String(0)) // "00" to "11", as in transcription.md

/** The edition view: the page beside its line-by-line reading, with every disagreement and every judgement line shown (R5 to R7). */
export default function Edition({ recipe }: { recipe: LoadedRecipe }) {
  const b = recipe.bundle
  const h1 = useScreen(b.title)
  const { store } = useApp()
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [provOpen, setProvOpen] = useState(false)
  useEffect(() => {
    let live = true
    void store.then((s) => s.getTiming(b.id)).then((t) => live && setOverrides(t)).catch(() => {})
    return () => {
      live = false
    }
  }, [store, b.id])

  // line index -> the displayable note that quotes it (R7.1); the moment shows after the note's last line
  const byLine = new Map<number, BundleNote>()
  for (const n of recipe.notes) for (const g of n.groups) byLine.set(g.line, n)
  const lastLine = new Map(recipe.notes.map((n) => [n.id, Math.max(...n.groups.map((g) => g.line))]))

  return (
    <main className="screen edition">
      <a className="back-link" href="#/">
        {EDITION.backToShelf}
      </a>
      <header className="edition__head">
        <div>
          <p className="kicker">
            {b.source.shelfmark} · {b.source.page} · {b.source.date}
          </p>
          <h1 ref={h1} tabIndex={-1} className="screen-title">
            {b.title}
          </h1>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => void startFresh(store, b.id, formatRoute({ name: 'cook', id: b.id, pace: 1, note: null, lead: null, fps: false }))}>
          {EDITION.cook}
        </button>
      </header>
      <div className="edition__grid">
        <div className="edition__scan">
          <Facsimile src={`/recipes/${b.id}/page.jpg`} width={b.source.frame?.width ?? 1} height={b.source.frame?.height ?? 1} credit={creditLine(b)} />
        </div>
        <section className="edition__text" aria-label={EDITION.transcription}>
          <p className="legend">{readersLine(b)}</p>
          <p className="legend">{SLIP.disagreements(b.transcription.disagreements.length)}</p>
          <p className="legend">{EDITION.legend}</p>
          {recipe.withheld.length > 0 ? <p className="notice">{EDITION.withheld(recipe.withheld.length)}</p> : null}
          <DisagreeDescription show={b.lines.some((l) => hasMarks(parseReading(l.corrected ?? l.merged)) || (l.corrected !== undefined && hasMarks(parseReading(l.merged))))} />
          <div className="transcription" role="list">
            {b.lines.map((l) => {
              const note = byLine.get(l.i)
              const showMoment = note && lastLine.get(note.id) === l.i
              return (
                <Fragment key={l.i}>
                  <div role="listitem" className={`tline ${l.i === 0 ? 'tline--title' : ''} ${note ? 'tline--judgement' : ''}`} data-line={pad2(l.i)}>
                    <span className="tline__n" aria-label={`${EDITION.lineLabel} ${pad2(l.i)}`}>
                      {pad2(l.i)}
                    </span>
                    <span className="tline__glyph" data-on={note ? 'true' : 'false'} aria-hidden="true" />
                    <span className="tline__text">
                      {note ? <span className="sr-only">{EDITION.judgementOn(note.span)} </span> : null}
                      <ReadingText segments={parseReading(l.corrected ?? l.merged)} />
                      {l.corrected !== undefined ? (
                        <span className="tline__merged" data-label={EDITION.asMerged}>
                          <ReadingText segments={parseReading(l.merged)} />
                        </span>
                      ) : null}
                    </span>
                    {showMoment ? (
                      <div className="tline__moment">
                        <TimingStepper recipeId={b.id} note={note} overrides={overrides} setOverrides={setOverrides} />
                      </div>
                    ) : null}
                  </div>
                </Fragment>
              )
            })}
          </div>
          <div className="disclosure">
            <button type="button" className="btn disclosure__btn" aria-expanded={provOpen} aria-controls="provenance" onClick={() => setProvOpen((o) => !o)}>
              {SLIP.readProvenance}
            </button>
            <div id="provenance" hidden={!provOpen}>
              {provOpen ? <ArchiveSlip bundle={b} expanded notes={recipe.notes} /> : null}
            </div>
            {provOpen ? null : <ArchiveSlip bundle={b} />}
          </div>
          <div className="edition__actions">
            <button type="button" className="btn btn--primary" onClick={() => void startFresh(store, b.id, formatRoute({ name: 'cook', id: b.id, pace: 1, note: null, lead: null, fps: false }))}>
              {EDITION.cook}
            </button>
            <a className="back-link" href="#/">
              {EDITION.backToShelf}
            </a>
          </div>
        </section>
      </div>
    </main>
  )
}
