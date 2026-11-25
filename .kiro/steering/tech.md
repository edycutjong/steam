---
inclusion: always
---

# Stack and budgets

## Stack
- Vite 8 + React 19 + TypeScript (strict), hash router.
- Static `dist/` hosted on Vercel. No runtime server, no runtime model.

## Steam renderer
- Raw WebGL2, two full-screen passes:
  1. A fog field at quarter resolution.
  2. A composite that reveals pixel p when the reveal clock passes its time-of-ink value.
- No three.js or other 3D engine.
- `StaticPane` fallback (pre-rendered fog + CSS crossfade of the note mask) covers no-WebGL2 and `prefers-reduced-motion`.

## Ingestion
- Pure TypeScript in `src/ingest/`.
- The same functions run in Node (`tools/steam-ingest`, run by Kiro hooks and the workflow) and in vitest. They never run in the browser: the web app ships no Web Worker and no ingestion code (upload in the browser was cut).

## Tests
- vitest + fast-check property tests: `npm test`.
- Playwright for e2e, judge-path timing and fps: `npm run e2e`.
- zod validates recipe bundles, `gate.json` and agent outputs.

## Performance budget
- At least 55 fps average with zero frames under 55, on desktop and on a Pixel 5 with 4x CPU throttling.
- Measure; never assume.

## Design tokens
Use these CSS custom properties. Never use ad-hoc colours.
- `--bg` #0E0A0A
- `--ink` #EFE7DA
- `--muted` #9A8F82
- `--before` #7F909C (fogged)
- `--after` #F2A65A (revealed ember; only in light through wiped strokes, dim on the pot flame, timer in the last 10 s before a note)
- `--fault` #D9654E (upload gate failures only)
- `--rule` #3A2D24 (sash wood)
- `--paper` #E8DCC2
- `--ghost` #BCD3E4 (cold rim of wiped strokes)
- `--moon` #E4E9EC
- `--night` #121A24

## Fonts
- IM Fell English: titles.
- Literata: body.
- DM Mono: shelfmarks, coordinates, pace badge only.

## Audio
- Web Audio noise only. No music files, no voice.
- Muted until the first user gesture.
