import type { LoadedRecipe } from '../data/catalog.ts'
import type { Route } from './router.ts'
import { useScreen } from './useScreen.ts'

// Filled in by tasks 38 to 46. Cook Mode focuses the Wipe control, not the heading (R14.9).
export default function Cook({ recipe }: { recipe: LoadedRecipe; route: Extract<Route, { name: 'cook' }> }) {
  const h1 = useScreen(recipe.bundle.title, false)
  return (
    <main className="screen">
      <h1 ref={h1} tabIndex={-1} className="sr-only">
        {recipe.bundle.title}
      </h1>
    </main>
  )
}
