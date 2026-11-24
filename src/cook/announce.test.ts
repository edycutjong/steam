import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RecipeBundle } from '../data/schema.ts'
import { compose } from './announce.ts'

const b = RecipeBundle.parse(JSON.parse(readFileSync('public/recipes/quinces-marmalade/recipe.json', 'utf8')))
const text = (n: number) => b.steps[n - 1]!.lineIdx.map((i) => b.lines.find((l) => l.i === i)!.merged).join(' ')

describe('compose (R9.4, R11.3, R23.3, R25.1)', () => {
  it('arrival at step 3 of 5', () => {
    expect(compose({ kind: 'arrive', stepIndex: 2, stepCount: 5, stepText: text(3) })).toBe('Step 3 of 5. Pareings & seeds in Spring water, strain the Liquor, & weigh your Quinces, with')
  })
  it("arrival at the hero step adds the writer's note, built from span", () => {
    const hero = b.notes.find((n) => n.id === 'till-it-looks-red-smooth')!
    expect(compose({ kind: 'arrive', stepIndex: 4, stepCount: 5, stepText: text(5), note: { span: hero.span } })).toBe(`Step 5 of 5. to the Quinces, & boil it till it Looks red & smooth, keeping it †[stir'd|stirred] all The time it Boils`.replace("†[stir'd|stirred]", "stir'd (the second reader reads stirred)") + " The writer's note, handwritten: till it Looks red & smooth")
  })
  it('a wipe prefixes "Glass wiped. "', () => {
    expect(compose({ kind: 'wipe', stepIndex: 2, stepCount: 5, stepText: text(3) })).toMatch(/^Glass wiped\. Step 3 of 5\. Pareings/)
  })
  it('a pace change', () => {
    expect(compose({ kind: 'pace', pace: 12 })).toBe('Pace ×12')
    expect(compose({ kind: 'pace', pace: 4 })).toBe('Pace ×4')
    expect(compose({ kind: 'pace', pace: 1 })).toBe('Pace real time')
  })
  it('a restore and a deep link', () => {
    expect(compose({ kind: 'resume', stepIndex: 4, stepCount: 5 })).toBe('Resumed at step 5 of 5.')
    expect(compose({ kind: 'deepLink', stepIndex: 4, stepCount: 5 })).toBe('Started at step 5 of 5.')
  })
  it('plain step text turns a marker into "a (the second reader reads b)", and an empty reading into "nothing"', () => {
    expect(compose({ kind: 'arrive', stepIndex: 1, stepCount: 5, stepText: text(2) })).toBe('Step 2 of 5. them, & pare them, & Quarter them, then (N.26) (the second reader reads nothing) take out the Cores (the second reader reads cores) and seeds, & boil the')
  })
})
