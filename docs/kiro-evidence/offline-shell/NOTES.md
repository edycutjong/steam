# offline-shell: what was built and how to check it

Spec: `.kiro/specs/offline-shell/` (requirements, design with properties O1 and O2, tasks). Claim: after one online load, the app and the bundled recipes work offline; Cook Mode for `quinces-marmalade` runs from the shelf to "The hand, quoted" with the network off.

## What was built

| Piece | File | What it does |
|---|---|---|
| Precache list | `src/offline/precache.ts` | `buildPrecacheList(distFiles, recipeIds)`: every file of `dist/` as a URL, plus `/`; no `sw.js`, no `.map`; throws, naming the id, when a catalog recipe has no `recipe.json` in `dist/`. `cacheNameFor`: `steam-shell-` + 12 hex digits of a hash over every URL and the sha256 of its bytes. |
| Worker logic | `src/offline/swCore.ts` | `createShell`: `install` stores the list (`cache: 'reload'`, all or nothing), `activate` deletes the app's older `steam-shell-*` caches and no others, `respond` answers navigations with the cached `index.html` and listed same-origin GETs from the cache; foreign origins and non-GET are left to the network (returns `null`). Nothing is stored at runtime. |
| Worker entry | `src/offline/sw.ts` | Binds the shell to `install` (then `skipWaiting`), `activate` (then `clients.claim`) and `fetch`. |
| Build step | `tools/offline/vite-plugin.ts`, `vite.config.ts` | After the main build (`closeBundle`) it walks the real `dist/`, builds the list and the cache name, and runs a nested Vite build of `sw.ts` with those two constants defined, writing `dist/sw.js` (not minified, about 4 KB). The build log prints `offline shell: 46 URLs in steam-shell-<hash>`. Build only: `vite dev` and vitest never run it. |
| Registration | `src/offline/register.ts`, `src/main.tsx` | `registerOfflineShell(browserEnv())`: registers `/sw.js` after `load`, only when `import.meta.env.PROD` and `navigator.serviceWorker` exist; a throw or a rejection becomes one `console.warn`. |
| Offline line | `src/offline/useOnline.ts`, `src/app/Quoted.tsx`, `src/copy/strings.ts` (`QUOTED.offline`) | While `navigator.onLine` is false, "The hand, quoted" shows "You are offline. The verify links open the archive and need a connection." (`role="status"`), and each verify link points at it with `aria-describedby`. The links stay links. |
| Hosting | `vercel.json` (new: none existed, so no rewrite or header was lost) | `/sw.js` with `Cache-Control: no-cache`. Static files only, nothing Pro-only. |

Not cached, on purpose: the IIIF "verify at source" images and links (`iiif.wellcomecollection.org`), and the licence link on the slip. They need the network.

The list holds 46 URLs, 4.4 MB: `index.html`, `favicon.svg`, the hashed JS, CSS and fonts, and every file under `recipes/quinces-marmalade/` (18 StaticPane images, the three note crops and their time-of-ink maps, `page.jpg`, `recipe.json`).

## Tests

- `src/offline/precache.prop.test.ts` (fast-check): O1, every URL in the list exists in the generated `dist/`; O2, every recipe id's `recipe.json` is in the list, and a missing one fails the build; no worker, no maps; the cache name depends on every URL and hash.
- `src/offline/swCore.test.ts`: install stores the whole list with `cache: 'reload'`; activate deletes old `steam-shell-*` caches, keeps the current one, leaves other apps' caches alone; respond answers from the cache, falls back to `index.html` for navigations, leaves IIIF and POST alone, stores nothing at runtime, lets a network error through.
- `src/offline/register.test.ts`: production only, after load, no support, rejection, throw.
- `src/app/Quoted.test.tsx`: the offline line appears and goes.
- `scripts/check-dist.test.ts` (run `npm run build && npm run check:dist`): runs the real `dist/sw.js` in a `vm` with a fake worker scope; what install stores is checked against the files in `dist/` (O1) and against `content/catalog.json` and all of `dist/recipes/**` (O2); the cache name has the form `steam-shell-<12 hex>`.

## How to verify by hand

1. `npm run build && npx vite preview --port 4173`, open `http://localhost:4173/` in Chromium.
2. DevTools, Application, Service Workers: `sw.js` is "activated and is running". Cache Storage has one cache, `steam-shell-<12 hex>`, with 46 entries (the build log printed the same name and count).
3. Reload once, so the page is controlled. Open `#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12`, and the shelf at `#/`.
4. DevTools, Network, tick "Offline" (or stop the preview server). Reload the shelf: it lists the recipe. Press "Watch it at ×12": Cook Mode runs through the five steps to "The hand, quoted". Requests show "(ServiceWorker)" as their source.
5. On "The hand, quoted" offline, the line "You are offline. The verify links open the archive and need a connection." shows. Opening a verify link fails in its new tab, as it must.
6. Rebuild after any edit and reload twice: the cache name changes and the old cache is gone (Application, Cache Storage).
7. `npm run dev`: Application shows no service worker registered.
8. Automated: `python3 scripts/verify_offline.py` (the autopilot's script, not part of this spec). Run against this build on 2026-11-25 with the preview on port 4173 it printed: worker active, page controlled, A deep link offline reached "The hand, quoted" in 8.5 s, B shelf to "The hand, quoted" at ×12 in 24.0 s, 0 failed requests, `RESULT: PASS`. The raw output went to a scratch file (`VERIFY_OFFLINE_OUT`); the script's default `verify-offline.txt` in this folder is the autopilot's to write.

## Limits

- Update flow: a new deploy installs, takes over at once (`skipWaiting`) and deletes the old cache; a page already open keeps running its old JS until reloaded, and its later requests for old hashed files are not in the new cache and go to the network.
- The first visit must finish online; a visit that is closed before the install completes has no offline copy.
- Safari and Firefox were not run. `verify_offline.py` drives Chromium only.
- `navigator.onLine` is a hint: a browser that is "online" without a route to the archive gets no offline line.
