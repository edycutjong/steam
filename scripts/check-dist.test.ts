import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

// Checks on the built site (R2.6, R15.10, R25.6, R26.1). Run after `npm run build` (`npm run check:dist`; CI runs it after the build).
const DIST = 'dist'
const have = existsSync(join(DIST, 'index.html'))
if (!have) console.log('check-dist: skipped, dist/ is absent (run npm run build first)')
const walk = (d: string): string[] => readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : [p] })

describe.skipIf(!have)('the built site', () => {
  it('has only index.html, sw.js, assets/, recipes/, favicon.svg and the pages beside the app (landing/, deck/, judge/, site/) at its top: sw.js is the offline shell (client code), no server entry', () => {
    expect(readdirSync(DIST).sort()).toEqual(['assets', 'deck', 'favicon.svg', 'index.html', 'judge', 'landing', 'recipes', 'site', 'sw.js'])
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

  // offline-shell O1 and O2 on the real build: the worker is run with a fake scope, its install records what it would store
  describe('the offline shell (dist/sw.js)', () => {
    const run = async () => {
      const listeners: Record<string, (e: unknown) => void> = {}
      const added: string[] = []
      const names: string[] = []
      const self = {
        location: { origin: 'https://steam.test' },
        caches: { open: async (n: string) => (names.push(n), { addAll: async (rs: { url: string }[]) => void added.push(...rs.map((r) => new URL(r.url).pathname)), match: async () => undefined }), keys: async () => [], delete: async () => true },
        skipWaiting: async () => {},
        clients: { claim: async () => {} },
        addEventListener: (t: string, cb: (e: unknown) => void) => void (listeners[t] = cb),
      }
      vm.runInNewContext(readFileSync(join(DIST, 'sw.js'), 'utf8'), { self, Request: class { url: string; cache: string; constructor(u: string, i: { cache: string }) { this.url = u; this.cache = i.cache } }, fetch: async () => ({}), URL })
      let waited: Promise<unknown> = Promise.resolve()
      listeners.install!({ waitUntil: (p: Promise<unknown>) => (waited = p) })
      await waited
      return { added, names }
    }
    it('O1: every URL it stores is a file of dist/ ("/" is index.html), none is sw.js', async () => {
      const { added } = await run()
      expect(added.length).toBeGreaterThan(20)
      const files = new Set(walk(DIST).map((f) => '/' + f.slice(DIST.length + 1).replace(/\\/g, '/')))
      for (const u of added) expect(u === '/' ? files.has('/index.html') : files.has(u), u).toBe(true)
      expect(added).not.toContain('/sw.js')
    })
    it('O2: it stores the recipe.json of every recipe in content/catalog.json, the Cook path\'s panes and note crops, and the hashed bundle', async () => {
      const { added } = await run()
      const catalog = JSON.parse(readFileSync('content/catalog.json', 'utf8')) as { id: string }[]
      for (const c of catalog) expect(added, c.id).toContain(`/recipes/${c.id}/recipe.json`)
      const files = new Set(walk(DIST).map((f) => '/' + f.slice(DIST.length + 1).replace(/\\/g, '/')))
      for (const u of files) if (u.startsWith('/recipes/') || u.startsWith('/assets/') || u === '/index.html' || u === '/favicon.svg') expect(added, u).toContain(u)
      expect(added.filter((u) => /\/panes\/.*\.webp$/.test(u)).length).toBe(18)
    })
    it('stores none of the pages beside the app (landing/, deck/, judge/, site/): the browser fetches them, the shell never answers for them', async () => {
      const { added } = await run()
      expect(added.filter((u) => /^\/(landing|deck|judge|site)(\/|$)/.test(u))).toEqual([])
    })
    it('names its cache after the build: steam-shell- and 12 hex digits', async () => {
      const { names } = await run()
      expect(names).toEqual([expect.stringMatching(/^steam-shell-[0-9a-f]{12}$/)])
    })
  })
})
