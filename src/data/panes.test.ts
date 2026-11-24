import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { displayableNotes } from './provenance.ts'
import { Catalog, RecipeBundle } from './schema.ts'

// R15.10: every displayable note of the catalog has its six StaticPane images, as WebP, in public/recipes/<id>/panes/.
// (This test lives in src/ rather than public/ because everything in public/ is copied into dist/.)
const catalog = Catalog.parse(JSON.parse(readFileSync('content/catalog.json', 'utf8')))

describe('committed StaticPane images (R15.10)', () => {
  it('the catalog has a recipe to check', () => expect(catalog.length).toBeGreaterThan(0))
  for (const e of catalog) {
    const bundle = RecipeBundle.parse(JSON.parse(readFileSync(`public/recipes/${e.id}/recipe.json`, 'utf8')))
    for (const n of displayableNotes(bundle).notes) {
      for (const kind of ['page', 'groups'] as const) {
        for (const state of ['fogged', 'held', 'wiped'] as const) {
          const f = `public/recipes/${e.id}/panes/${n.id}-${kind}-${state}.webp`
          it(`${f} exists and is WebP`, () => {
            expect(existsSync(f), f).toBe(true)
            const b = readFileSync(f)
            expect(b.length).toBeGreaterThan(0)
            expect(b.subarray(0, 4).toString('latin1')).toBe('RIFF')
            expect(b.subarray(8, 12).toString('latin1')).toBe('WEBP')
          })
        }
      }
    }
  }
})
