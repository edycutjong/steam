# Contributing

1. `npm ci`
2. `npm run lint && npm run typecheck && npm run build && npm test && npm run props && npm run check:dist`
   (build before `npm test`, so the dist checks in `scripts/check-dist.test.ts` run instead of skipping)
3. `npm run e2e` (needs `npx playwright install chromium`)
4. `npm run budget` (gzip budget for the code the pages load; needs the build from step 2)

A pull request runs the same checks in GitHub Actions: CI (the steps above on Node 22 and 24), E2E, CodeQL, Security
(gitleaks, `npm audit`, dependency review) and Quality (Lighthouse CI + the bundle budget). Only `main` deploys, and
only after CI passes on it.

Small commits with real messages. Product code that came from a Kiro turn is marked `[kiro]` in the commit subject, everything else `[claude-direct]`. See `docs/KIRO.md`.

Two rules hold for every change: the hand stays quoted from the scan (no handwriting font, no generated stroke, no
synthetic voice), and a recipe reaches Cook Mode only through the ingestion gate (`npm run props`). Security problems go
to a private advisory, not an issue (`SECURITY.md`).
