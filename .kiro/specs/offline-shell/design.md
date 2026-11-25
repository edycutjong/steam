# Design: offline-shell

## Shape

```
vite build                       (main build: index.html, assets/, public/** copied)
  └─ steam-offline-shell plugin, closeBundle
       walk dist/  →  buildPrecacheList(files, catalogIds)        src/offline/precache.ts   (pure)
                   →  cacheNameFor(url + sha256(bytes) entries)    src/offline/precache.ts   (pure)
       nested vite build (lib, iife) of src/offline/sw.ts with
         define __PRECACHE__ = list, __CACHE_NAME__ = name          →  dist/sw.js
src/offline/swCore.ts            createShell({cacheName, urls, caches, fetchFn, origin}): install, activate, respond
src/offline/sw.ts                binds the shell to install, activate, fetch of the worker scope (no logic)
src/offline/register.ts          registerOfflineShell(env): prod only, after load, failures become warnings
src/offline/useOnline.ts         navigator.onLine, live; Quoted shows the offline line
vercel.json                      /sw.js: Cache-Control: no-cache
```

Why one nested build and not a plugin like workbox: the worker is 60 lines, the list must come from the *finished* `dist/` (including `public/` copies), and nothing else may be added to the dependency tree. The logic sits in `swCore.ts` with its environment injected, so vitest drives install, activate and respond without a browser.

Decisions.
- **Cache-first from a versioned cache.** Every stored URL is either content-hashed (`assets/*`) or part of the same build (`recipes/**`, `index.html`), and the cache name changes with any byte, so a stored answer is never stale for its worker. No runtime caching: what is stored is exactly the list, which makes O1 and O2 checkable.
- **Navigation fallback is unconditional.** The router is a hash router: every path is the same document. A navigation to any same-origin path gets the cached `index.html`.
- **`skipWaiting` after a complete install, `clients.claim` on activate.** The first online load is controlled without a second visit, which the claim "after one online load" needs. A cache is deleted only after its replacement is complete (activate runs after a successful install).
- **Cross-origin is never touched.** The IIIF server cannot be stored (opaque, unbounded, not ours) and must not be faked; `Quoted` says so while offline.
- **The worker is not in its own list**, and `vercel.json` makes the browser re-check it on every navigation.

## Correctness properties

**O1 (every listed URL exists).** For every set of `dist/` files containing `index.html`, and every set of recipe ids whose `recipe.json` is among them, every URL of `buildPrecacheList` is the URL of a file of that set, or `/` when `index.html` is in it. Install can therefore never fail on a 404 of our own making, and the list can never name `sw.js`. Test: `src/offline/precache.prop.test.ts` (fast-check, generated file sets), and on the real build `scripts/check-dist.test.ts` runs `dist/sw.js` in a vm with a fake scope and checks what install stores against `dist/`.

**O2 (every shelf recipe is in the list).** For every set of `dist/` files and every list of recipe ids the shelf shows, each `/recipes/<id>/recipe.json` is in the list; and if one is missing from `dist/` the builder throws, naming the id. The shelf can therefore always load its recipes offline. Test: the same two files, reading the ids from the real `content/catalog.json`.

Secondary property (unit tests, `swCore.test.ts`): after `activate`, the set of caches with the app's prefix is exactly the current cache, and caches of other names are untouched.

## Error handling

| Case | Behaviour |
|---|---|
| A listed URL 404s at install | Install rejects, the old worker and cache stay (R3.2). |
| `serviceWorker.register` rejects or throws | One `console.warn`, the app runs normally (R6.3). |
| No `serviceWorker` in `navigator` (old browser, insecure origin) | Nothing is registered (R6.2). |
| Offline, URL not in the list | The fetch error reaches the page (R4.5). |
| Offline, IIIF verify link | The browser's own error in the new tab; the page says beforehand that it needs a connection (R5). |
| dist/ lacks a catalog recipe | The build fails with the id (R1.3). |

## Testing

vitest: `precache.prop.test.ts`, `swCore.test.ts`, `register.test.ts`, `Quoted.test.tsx` (offline line), `scripts/check-dist.test.ts` (real build). Manual and autopilot: `scripts/verify_offline.py`, and the steps in `docs/kiro-evidence/offline-shell/NOTES.md`.
