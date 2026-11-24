import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// R15.9: the spike's public/hero folder is gone, and nothing names it.
const walk = (d: string): string[] => (existsSync(d) ? readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : [p] }) : [])

describe('no spike folder (R15.9)', () => {
  it('public/hero does not exist', () => expect(existsSync('public/hero')).toBe(false))
  it('no file under src/, e2e/ or scripts/ names public/hero or /hero/ (this file excepted)', () => {
    const hits = ['src', 'e2e', 'scripts']
      .flatMap(walk)
      .filter((f) => /\.(ts|tsx|css|json|md)$/.test(f) && !f.endsWith('nohero.test.ts'))
      .filter((f) => /public\/hero|\/hero\//.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
  it('no HERO_DIR or NOTE_STEM constant remains', () => {
    const hits = ['src', 'e2e', 'scripts'].flatMap(walk).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('nohero.test.ts')).filter((f) => /\bHERO_DIR\b|\bNOTE_STEM\b/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})
