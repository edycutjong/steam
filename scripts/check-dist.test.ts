import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Checks on the built site (R2.6, R15.10, R25.6, R26.1). Run after `npm run build` (`npm run check:dist`; CI runs it after the build).
const DIST = 'dist'
const have = existsSync(join(DIST, 'index.html'))
if (!have) console.log('check-dist: skipped, dist/ is absent (run npm run build first)')
const walk = (d: string): string[] => readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : [p] })

describe.skipIf(!have)('the built site', () => {
  it('has only index.html, assets/, recipes/ and favicon.svg at its top: no server entry', () => {
    expect(readdirSync(DIST).sort()).toEqual(['assets', 'favicon.svg', 'index.html', 'recipes'])
  })
  it('contains no speech synthesis', () => {
    for (const f of walk(DIST).filter((x) => /\.(js|html|css)$/.test(x))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/speechSynthesis|SpeechSynthesisUtterance/)
  })
  it('ships the 18 StaticPane images of the quinces notes', () => {
    const panes = readdirSync(join(DIST, 'recipes/quinces-marmalade/panes')).filter((f) => f.endsWith('.webp'))
    expect(panes.length).toBe(18)
  })
  it('has no spike folder', () => expect(existsSync(join(DIST, 'hero'))).toBe(false))
  it('ships no test file', () => expect(walk(DIST).filter((f) => /\.test\./.test(f))).toEqual([]))
})
