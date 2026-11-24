import { QUOTED } from '../copy/strings.ts'
import type { LoadedRecipe } from '../data/catalog.ts'
import { useScreen } from './useScreen.ts'

// Filled in by task 47.
export default function Quoted({ recipe: _recipe }: { recipe: LoadedRecipe }) {
  const h1 = useScreen(QUOTED.title)
  return (
    <main className="screen">
      <h1 ref={h1} tabIndex={-1} className="screen-title">
        {QUOTED.title}
      </h1>
    </main>
  )
}
