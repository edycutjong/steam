# Requirements: offline-shell

Claim to make true and testable: **after one online load, the app and the bundled recipes work offline.** Cook Mode for `quinces-marmalade` runs from the shelf to "The hand, quoted" with no network. Hosting is Vercel static on the Hobby plan: no server code, no Pro-only feature. The judged app still runs no model and no server; the service worker is client code.

Terms. "The shell": the service worker `dist/sw.js`, its cache, and the code that registers it. "The precache list": the URLs the shell stores at install. "Bundled recipes": the folders under `public/recipes/` that `content/catalog.json` lists. "The Cook path": shelf, edition, Cook Mode, "The hand, quoted", for each bundled recipe, including the StaticPane images, the note crops and the facsimile (`page.jpg`).

## Requirements

1. **R1 (the list is real).** The build shall generate the precache list from the files that exist in `dist/` after the main build, which include `index.html`, the hashed `assets/`, the fonts and everything copied from `public/recipes/**`.
   1.1. The list shall not name a file that is not in `dist/`.
   1.2. The list shall contain `/` and `/index.html`.
   1.3. The list shall contain the `recipe.json` of every recipe in `content/catalog.json`. IF a listed recipe has no `recipe.json` in `dist/`, THEN the build shall fail with the recipe's id in the message.
   1.4. The list shall contain every file of `dist/recipes/**` (StaticPane images, note crops, time-of-ink maps, `page.jpg`), so the Cook path loads nothing it has not stored.
   1.5. The list shall not contain `sw.js` or a source map.
2. **R2 (the cache is versioned).** The cache name shall be `steam-shell-` and 12 hex digits of a hash over every URL in the list and the hash of its bytes, so that a change to any file in `dist/` gives a new name.
3. **R3 (install and activate).**
   3.1. WHEN the worker installs, it shall store every URL of the list, bypassing the HTTP cache, and shall skip waiting after all of them are stored.
   3.2. IF any URL fails to store, THEN the install shall fail and the previous worker shall stay in charge.
   3.3. WHEN the worker activates, it shall delete every cache whose name starts with `steam-shell-` and is not its own, shall delete no other cache, and shall claim the open pages.
4. **R4 (answers offline).**
   4.1. WHILE a request is a navigation to the app's origin, the worker shall answer with the stored `index.html` whatever the path.
   4.2. WHILE a request is a GET to the app's origin for a URL in the list, the worker shall answer from the cache and shall not use the network.
   4.3. WHILE a request is not GET, or goes to another origin, the worker shall not answer it: the network decides.
   4.4. The worker shall not store any response at runtime. A same-origin URL outside the list goes to the network and is not stored.
   4.5. IF the network fails for a request the worker passes on, THEN the error shall reach the page unchanged. The worker shall not invent a response.
5. **R5 (the archive's pixels stay online).** The IIIF "verify at source" links and images are never stored.
   5.1. WHILE `navigator.onLine` is false, "The hand, quoted" shall show one status line, "You are offline. The verify links open the archive and need a connection.", and each verify link shall name it with `aria-describedby`.
   5.2. WHILE the browser is online, the line shall be absent.
   5.3. The links shall stay links; the app shall not block them.
6. **R6 (registration).**
   6.1. The app shall register `/sw.js` once the page has loaded, in a production build only (`import.meta.env.PROD`). In `vite dev` and in vitest it shall register nothing.
   6.2. WHERE the browser has no service worker support, the app shall do nothing.
   6.3. IF registration throws or is rejected, THEN the app shall log one warning and carry on.
7. **R7 (hosting).**
   7.1. `vercel.json` shall serve `/sw.js` with `Cache-Control: no-cache`, so a new build's worker is found on the next navigation.
   7.2. `vercel.json` shall keep every rewrite and header that existed (none did when this spec was written: the file was absent).
   7.3. The change shall use no server code and no Pro-only feature.
8. **R8 (what the user can check).** `docs/kiro-evidence/offline-shell/NOTES.md` shall state what was built and how to verify it by hand. `scripts/verify_offline.py` (written by the autopilot, not by this spec) drives the production build offline.

## Out of scope

- A Playwright offline script (the autopilot's `scripts/verify_offline.py` is it).
- Caching IIIF responses, background sync, push, an install prompt, update toasts.
- Offline editing of check times beyond what IndexedDB already does on this device.
