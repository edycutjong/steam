import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The screens' CSS (R9.3, R10.1, R23.4, R24): tokens only, the sizes of the spec at their breakpoints, three faces.
const app = readFileSync('src/app/app.css', 'utf8')
const cook = readFileSync('src/app/cook.css', 'utf8')
const steam = readFileSync('src/steam/steam.css', 'utf8')
const all = `${app}\n${cook}`
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const rootVars = (s: string) => /:root\s*\{([^}]*)\}/.exec(s)![1]!
const desktopVars = (s: string) => /@media \(min-width: 1025px\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(s)![1]!
const v = (block: string, name: string) => new RegExp(`--${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim()

describe('screen CSS', () => {
  it('has no hex colour literal and no rgb() literal: every colour is a custom property', () => {
    expect(strip(all)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(strip(all)).not.toMatch(/\brgba?\(/)
  })
  it.each([
    ['step-size', '24px', '34px'],
    ['timer-size', '44px', '64px'],
    ['title-size', '34px', '56px'],
    ['transcription-size', '17px', '20px'],
    ['slip-size', '11px', '12px'],
  ])('--%s is %s up to 1024 px and %s from 1025 px', (name, phone, desk) => {
    expect(v(rootVars(app), name)).toBe(phone)
    expect(v(desktopVars(app), name)).toBe(desk)
  })
  it('the focus ring is a 2 px --ghost outline on :focus-visible', () => {
    expect(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ghost\)/.test(app)).toBe(true)
  })
  it('the drag surface has touch-action: none', () => expect(/\.stage\s*\{[^}]*touch-action:\s*none/.test(cook)).toBe(true))
  it('no screen container has a fixed pixel width', () => {
    for (const sel of ['.screen', '.cook', '.stage', '.cook__panel', '.cook__under', '.shelf__item', '.edition__grid', '.quote', '.controls']) {
      const rules = [...strip(all).matchAll(new RegExp(`(^|\\n)\\s*${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[2]!)
      for (const r of rules) expect(r, sel).not.toMatch(/(^|[^-])width:\s*\d+px/)
    }
  })
  it('names only IM Fell English, Literata and DM Mono (with generic fallbacks)', () => {
    const decls = [...strip(`${all}\n${steam}`).matchAll(/(?:font-family|--face-[a-z]+):\s*([^;]+);/g)].map((m) => m[1]!)
    expect(decls.length).toBeGreaterThan(3)
    for (const d of decls) {
      for (const f of d.split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, ''))) {
        expect(['IM Fell English', 'Literata', 'DM Mono', 'Georgia', 'serif', 'ui-monospace', 'monospace', 'inherit'].includes(f) || f.startsWith('var(--face-'), f).toBe(true)
      }
    }
  })
  it('the glass is 55 dvh on a phone and the stage 60% of the width, at most 1100 px, on desktop', () => {
    expect(/\.cook\s*\{[^}]*--glass-h:\s*55dvh/.test(cook)).toBe(true)
    expect(/@media \(min-width: 1025px\)\s*\{\s*\.cook\s*\{[^}]*--stage-w:\s*min\(60vw, 1100px\)/.test(cook)).toBe(true)
  })
})
