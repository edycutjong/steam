// Emits dist/sw.js after the main build: the precache list comes from the real files of dist/, the cache name from their hashes
// (offline-shell, design.md). Build only; `vite dev` and vitest never see it.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { build, type Plugin } from 'vite'
import { buildPrecacheList, cacheNameFor, SW_FILE, urlOf } from '../../src/offline/precache.ts'

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
const sha = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** The recipe ids the shelf lists: content/catalog.json, the same file src/data/catalog.ts imports. */
export function catalogIds(root: string): string[] {
  const c = JSON.parse(readFileSync(join(root, 'content/catalog.json'), 'utf8')) as { id: string }[]
  return c.map((e) => e.id)
}

export interface Shell {
  urls: string[]
  cacheName: string
}

/** The list and the name for the files now in `dist`. Pure of side effects. */
export function planShell(root: string, dist: string): Shell {
  const files = walk(dist).map((f) => relative(dist, f))
  const urls = buildPrecacheList(files, catalogIds(root))
  const entries = urls.map((u) => ({ url: u, hash: u === '/' ? 'index' : sha(readFileSync(join(dist, u.slice(1)))) }))
  return { urls, cacheName: cacheNameFor(entries, sha) }
}

export default function offlineShell(): Plugin {
  let root = process.cwd()
  let outDir = 'dist'
  return {
    name: 'steam-offline-shell',
    apply: 'build',
    configResolved(c) {
      root = c.root
      outDir = resolve(c.root, c.build.outDir)
    },
    async closeBundle() {
      // the worker's own build runs this plugin's host config again with `configFile: false`, so it never recurses
      if (process.env.STEAM_SW_BUILD === '1') return
      const shell = planShell(root, outDir)
      process.env.STEAM_SW_BUILD = '1'
      try {
        await build({
          root,
          configFile: false,
          logLevel: 'warn',
          publicDir: false,
          define: { __PRECACHE__: JSON.stringify(shell.urls), __CACHE_NAME__: JSON.stringify(shell.cacheName) },
          build: {
            outDir,
            emptyOutDir: false,
            minify: false,
            sourcemap: false,
            copyPublicDir: false,
            lib: { entry: resolve(root, 'src/offline/sw.ts'), formats: ['iife'], name: 'steamSw', fileName: () => SW_FILE },
          },
        })
      } finally {
        delete process.env.STEAM_SW_BUILD
      }
      console.log(`offline shell: ${shell.urls.length} URLs in ${shell.cacheName}, ${urlOf(SW_FILE)}`)
    },
  }
}
