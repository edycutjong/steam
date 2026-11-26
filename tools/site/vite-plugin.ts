// Builds site/glass.tsx (the product's SteamGlass, mounted by the landing page and the deck) into dist/site/ after the app's own
// build. A separate build, so the app's bundle is byte-for-byte what it is without the pages, and dist/site/ sits outside the
// offline shell (SITE_PREFIXES in src/offline/precache.ts). Build only; `vite dev` and vitest never see it.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { build, type Plugin } from 'vite'

export const SITE_GLASS = 'site/glass.js'

export default function siteGlass(): Plugin {
  let root = process.cwd()
  let outDir = 'dist'
  return {
    name: 'steam-site-glass',
    apply: 'build',
    configResolved(c) {
      root = c.root
      outDir = resolve(c.root, c.build.outDir)
    },
    async closeBundle() {
      // the nested build below uses `configFile: false`, so this plugin never runs inside it
      await build({
        root,
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        plugins: [react()],
        // library mode leaves process.env alone; React needs it replaced to drop its development build
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          outDir: resolve(outDir, 'site'),
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          lib: { entry: resolve(root, 'site/glass.tsx'), formats: ['iife'], name: 'steamGlass', fileName: () => 'glass.js', cssFileName: 'glass' },
        },
      })
      console.log(`site glass: ${SITE_GLASS}`)
    },
  }
}
