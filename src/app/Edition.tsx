import type { LoadedRecipe } from '../data/catalog.ts'
import { useScreen } from './useScreen.ts'

// Filled in by tasks 36 and 37.
export default function Edition({ recipe }: { recipe: LoadedRecipe }) {
  const h1 = useScreen(recipe.bundle.title)
  return (
    <main className="screen">
      <h1 ref={h1} tabIndex={-1} className="screen-title">
        {recipe.bundle.title}
      </h1>
    </main>
  )
}
