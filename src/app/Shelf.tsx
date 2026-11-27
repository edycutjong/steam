import { useEffect, useState } from 'react'
import { SHELF } from '../copy/strings.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import { shelfThumb } from '../data/shelfThumb.ts'
import { useApp } from './AppContext.tsx'
import ArchiveSlip, { creditLine } from './components/ArchiveSlip.tsx'
import { formatRoute } from './router.ts'
import { useScreen } from './useScreen.ts'

export const INTRO_KEY = 'introSeen'
/** page.jpg's width when a bundle carries no frame (every catalogued scan has one). */
const THUMB_FALLBACK_WIDTH = 1601

/** Discards the saved session, then navigates, in that order, so the new route cannot restore the old session (design 9). */
export async function startFresh(store: Promise<import('../data/store.ts').Store>, id: string, hash: string): Promise<void> {
  try {
    await (await store).deleteSession(id)
  } catch {
    /* a store that fails still lets the cook start */
  }
  location.hash = hash
}

function Card({ recipe, onLeave }: { recipe: LoadedRecipe; onLeave: () => void }) {
  const { store } = useApp()
  const b = recipe.bundle
  const go = (pace: 1 | 12) => {
    onLeave()
    void startFresh(store, b.id, formatRoute({ name: 'cook', id: b.id, pace, note: null, lead: null, fps: false }))
  }
  return (
    <li className="shelf__item">
      <div className="shelf__thumb">
        <div className="mat">
          {/* Above the fold and the page's largest paint: fetched eagerly, at high priority, and a phone gets a smaller copy of the same scan. */}
          <img
            {...shelfThumb(b.id, b.source.frame?.width ?? THUMB_FALLBACK_WIDTH)}
            fetchPriority="high"
            decoding="async"
            width={b.source.frame?.width}
            height={b.source.frame?.height}
            alt={SHELF.thumbAlt(b.source.shelfmark, b.source.page)}
          />
        </div>
      </div>
      <div className="shelf__body">
        <p className="kicker">
          {b.source.institution} · {b.source.shelfmark} · {b.source.page}
        </p>
        <h2 className="shelf__title">
          <a href={formatRoute({ name: 'edition', id: b.id })} onClick={onLeave}>
            {b.title}
          </a>
        </h2>
        <p className="shelf__hint">{SHELF.hint(b.steps.length, recipe.notes.length)}</p>
        <ArchiveSlip bundle={b} />
        <p className="credit-line">{creditLine(b)}</p>
        <div className="btn-row">
          <button type="button" className="btn btn--primary" onClick={() => go(1)}>
            {SHELF.cook}
          </button>
          <button type="button" className="btn" onClick={() => go(12)}>
            {SHELF.watch}
          </button>
        </div>
      </div>
    </li>
  )
}

export default function Shelf() {
  const h1 = useScreen(SHELF.title)
  const { shelf, store } = useApp()
  const [introSeen, setIntroSeen] = useState(false)
  useEffect(() => {
    let live = true
    void store.then((s) => s.getSetting<boolean>(INTRO_KEY)).then((v) => live && setIntroSeen(v === true)).catch(() => {})
    return () => {
      live = false
    }
  }, [store])
  const leave = () => void store.then((s) => s.putSetting(INTRO_KEY, true)).catch(() => {})

  return (
    <main className="screen shelf">
      <header className="shelf__head">
        <h1 ref={h1} tabIndex={-1} className="screen-title">
          {SHELF.title}
        </h1>
        <p className={introSeen ? 'lede lede--standing' : 'lede'}>{SHELF.intro}</p>
      </header>
      {shelf.state === 'loading' ? null : shelf.result.recipes.length === 0 ? (
        <p className="shelf__empty">{SHELF.empty}</p>
      ) : (
        <ul className="shelf__list">
          {shelf.result.recipes.map((r) => (
            <Card key={r.bundle.id} recipe={r} onLeave={leave} />
          ))}
        </ul>
      )}
    </main>
  )
}
