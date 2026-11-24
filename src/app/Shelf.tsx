import { useEffect, useState } from 'react'
import { SHELF } from '../copy/strings.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import { useApp } from './AppContext.tsx'
import ArchiveSlip, { creditLine } from './components/ArchiveSlip.tsx'
import { formatRoute } from './router.ts'
import { useScreen } from './useScreen.ts'

export const INTRO_KEY = 'introSeen'

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
          <img src={`/recipes/${b.id}/page.jpg`} loading="lazy" width={b.source.frame?.width} height={b.source.frame?.height} alt={SHELF.thumbAlt(b.source.shelfmark, b.source.page)} />
        </div>
        <p className="credit-line">{creditLine(b)}</p>
      </div>
      <div className="shelf__body">
        <h2 className="shelf__title">
          <a href={formatRoute({ name: 'edition', id: b.id })} onClick={onLeave}>
            {b.title}
          </a>
        </h2>
        <ArchiveSlip bundle={b} />
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
