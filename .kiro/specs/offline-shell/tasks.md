# Tasks: offline-shell

- [x] 1. `precache.ts`: `buildPrecacheList`, `cacheNameFor`; property tests O1, O2 first (`precache.prop.test.ts`). R1, R2.
- [x] 2. `swCore.ts`: `createShell` with install, activate, respond; unit tests first (`swCore.test.ts`). R3, R4.
- [x] 3. `register.ts` and `main.tsx`; unit tests first (`register.test.ts`). R6.
- [x] 4. `sw.ts`, `tools/offline/vite-plugin.ts`, `vite.config.ts`: emit `dist/sw.js` from the real `dist/`. `scripts/check-dist.test.ts` runs it (O1, O2 on the real build). R1, R2.
- [x] 5. `useOnline.ts`, the offline line in `Quoted`, copy in `strings.ts`; test first (`Quoted.test.tsx`). R5.
- [x] 6. `vercel.json` (`/sw.js` no-cache; the file did not exist, nothing to keep). R7.
- [x] 7. `docs/kiro-evidence/offline-shell/NOTES.md`. R8.
- [x] 8. Final: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:dist`, Playwright `cook-phone steam-phone-fit cook-flow cook-a11y cook-layout-p1d`.
