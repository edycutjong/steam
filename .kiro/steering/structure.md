---
inclusion: always
---

# Repository layout

Some folders do not exist yet. Create files in these places when tasks need them.

## Source
- `src/steam/`: WebGL2 renderer and `StaticPane`.
- `src/cook/`: step engine, sleep-safe timer, reveal scheduler (`timing.ts`).
- `src/ingest/`: thresholding, line finding, ownership masks, time-of-ink, properties (`props.ts`).
- `src/data/schema.ts`: zod schemas.
- `src/copy/`: user-facing strings.
- `src/app/`: screens (shelf, edition view, Cook Mode, "The hand, quoted").

## Tests
- Tests sit beside code: `*.test.ts`.
- Property tests: `*.prop.test.ts`.

## Content
- `content/recipes/<id>/`: one bundle per recipe:
  - `page.jpg`, `source.json`, `lines.json`, `strips/`
  - `agent/scribe.json`, `agent/second.json`
  - `alignment.json`, `transcription.md`, `gate.json`, `review.json`, `recipe.json`
  - note masks
- `content/catalog.json` is written only by `steam-ingest catalog`.

## Tools
- `tools/steam-ingest/`: build-time CLI.
- `tools/iiif-mcp/`: stdio MCP server for the Wellcome Catalogue + IIIF Image API.

## Measurement and evidence
- `scripts/`: reproducible measurement scripts.
- `bench/`: measured fps and timing JSON.
- `docs/kiro-evidence/`: probe results and `hooks.log`. Every shell hook appends one line: ISO time, hook, target, result.
- `docs/KIRO.md`: how Kiro was used.

## Kiro folder
- `.kiro/` is public build direction: steering, specs, hooks, agents, workflows.
- Never put secrets, personal data or anything about other entries in it.
