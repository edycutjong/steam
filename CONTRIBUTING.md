# Contributing

1. `npm ci`
2. `npm run typecheck && npm test && npm run props && npm run build && npm run check:dist`
3. `npm run e2e` (needs `npx playwright install chromium`)

Small commits with real messages. Product code that came from a Kiro turn is marked `[kiro]` in the commit subject, everything else `[claude-direct]`. See `docs/KIRO.md`.
