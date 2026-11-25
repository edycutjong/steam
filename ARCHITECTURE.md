# Architecture

![Her Hand in the Steam, architecture as built, drawn as a sash window. Upper sash, step 1: the Wellcome Collection archive. Left lower pane, build time, steps 2 to 6: steam-ingest fetch checks the licence first; segment finds the lines; two isolated Kiro agents, scribe and second-reader, read the line strips inside the Kiro workflow ingest-recipe; the code gate merges the readings with a Kiro agent's word cuts and stroke review and checks properties P1 to P6; steam-ingest catalog publishes the bundle. Right lower pane, runtime, steps 7 to 9: static files on Vercel load the Cook Mode app, which reveals the scan's own ink in the WebGL2 steam pane and links back to the archive. Sill: Kiro steering, specs and hooks, how the code was written.](docs/architecture.png)

Read it as a window, steps 1 to 9: the archive is outside, in the clear upper sash. The left pane is **build time** (top to bottom), the right pane is **runtime** (bottom to top), and the sill is how the code itself was written. At build time two isolated Kiro agents read the page, run through the `ingest-recipe` workflow; a Kiro agent then chose the word boundaries (`alignment.json`) and settled the joined strokes (`ownership-review.json`), and the code gate checks every result. The browser runs no model.

The same boxes and arrows as text:

```mermaid
flowchart TB
  subgraph archive["Outside the repo: the archive"]
    W["1 Wellcome Collection<br/>Catalogue API: the licence, read first<br/>IIIF Image API: the page, and each note's region<br/>MS.1810 p.23, c. 1750, Public Domain Mark"]
  end
  subgraph build["Build time: Node CLI + Kiro"]
    F["2 Fetch, licence first<br/>allow-list: pdm, cc0, cc-by, fails closed<br/>steam-ingest fetch: page.jpg, source.json"]
    S["3 Find the lines<br/>steam-ingest segment: strips/, ownership/"]
    subgraph wf["Kiro workflow: ingest-recipe"]
      R["4 Two isolated readers (Kiro agents)<br/>scribe: claude-opus-5.5<br/>second-reader: claude-sonnet-5.5<br/>parallel, neither sees the other: agent/"]
      G["5 Merge + gate (watch step)<br/>merge readings, note masks, time-of-ink<br/>+ word cuts, stroke review by a Kiro agent<br/>P1 structure, P2 in the page, P3 ownership,<br/>P4 note fidelity, P5 contrast, P6 time-of-ink<br/>hook props-on-save: re-runs on saves"]
    end
    C["6 Publish the bundle<br/>steam-ingest catalog: public/recipes/<br/>hook catalog-gate: blocks unverified writes"]
  end
  subgraph runtime["Runtime: the browser runs no model"]
    V["7 Static files on Vercel<br/>vite build: dist/ + sw.js precache<br/>steam.edycu.dev, no server at runtime"]
    A["8 Cook Mode app (React 19)<br/>shelf, edition, Cook, The hand, quoted<br/>scheduler, reveal gate, sleep-safe timer<br/>wake lock, offline shell (service worker)<br/>archive slip: verify at source"]
    P["9 The steam pane (WebGL2)<br/>fog field, time-of-ink write-on, droplets<br/>governor: p95 over 18 ms, next quality tier<br/>tier 3 or reduced motion: StaticPane .webp"]
  end
  subgraph sill["Kiro: how the code was written"]
    K1["Steering: 5 files<br/>rules: quoted, not generated"]
    K2["Specs: 5 feature + 10 bugfix<br/>tasks.md: [kiro] commits"]
    K3["Hooks: 6<br/>write, shell, save hooks: hooks.log"]
  end
  W -->|licence + page| F
  F --> S
  S --> R
  R -->|2 readings| G
  G -->|pass + review| C
  C -->|bundle| V
  V -->|static files| A
  A ==>|reveal| P
  A -.->|verify source| W
```

## Where each box lives

| Box | Files in this repo |
|---|---|
| 1 Wellcome Collection | `tools/steam-ingest/fetch.ts` (`catalogueUrl`: `api.wellcomecollection.org/catalogue/v2/works/<id>?include=items`; then the IIIF manifest and image service); the record of what was fetched: `content/recipes/quinces-marmalade/source.json` |
| 2 Fetch, licence first | `tools/steam-ingest/fetch.ts` ("licence first, then manifest, then the page"; writes `page.jpg` and `source.json` only after everything succeeded), `src/ingest/licence.ts`, `LICENCE_ALLOW` (`pdm`, `cc0`, `cc-by`) in `src/ingest/constants.ts` |
| 3 Find the lines | `tools/steam-ingest/segment.ts` (writes `lines.json`, `region.json`, `runs.json`, `strips/`, `ownership/`), `src/ingest/segment.ts` (with `threshold.ts`, `deskew.ts`, `components.ts`, `lines.ts`, and `ownership` from `masks.ts`) |
| Kiro workflow `ingest-recipe` | `.kiro/workflows/ingest-recipe.workflow.json`: a `parallel` step `readers` (both agents), then a `watch` step `gate` that runs `npx tsx tools/steam-ingest/cli.ts gate --once`. How the runs went: [`docs/KIRO.md`](docs/KIRO.md) |
| 4 Two isolated readers | `.kiro/agents/scribe.json`, `.kiro/agents/second-reader.json`; their readings: `content/recipes/quinces-marmalade/agent/scribe.json`, `agent/second.json` |
| 5 Merge + gate | `tools/steam-ingest/watch.ts` (the watch-step protocol) → `tools/steam-ingest/gate.ts` → `src/ingest/gate.ts` (`mergeReadings`, `noteOwnership` from `masks.ts`, `buildNote` from `timeofink.ts`); properties P1-P6 in `src/ingest/props.ts` and `src/ingest/gate.ts`; result: `content/recipes/quinces-marmalade/gate.json` (P1-P6 pass). Its other agent-made inputs: `alignment.json` (word boundaries, by a Kiro agent) and `ownership-review.json` (joined strokes, by a Kiro agent). Hook: `.kiro/hooks/props-on-save.json` → `tools/hooks/props-on-save.ts` re-runs the gate when an agent writes a gate input |
| 6 Publish the bundle | `tools/steam-ingest/catalog.ts`, the only writer of `content/catalog.json`; it refuses a recipe whose gate did not pass, and an agent-transcribed recipe without a `review.json` that matches the gate; it copies `recipe.json`, `page.jpg` and the note files to `public/recipes/<id>/`. The review record is agent-signed, not a human's (README, "Honest limits"). Hook: `.kiro/hooks/catalog-gate.json` → `tools/hooks/catalog-gate.ts` refuses a write to the catalog that lists a recipe failing those checks |
| 7 Static files on Vercel | `vite.config.ts`, `tools/offline/vite-plugin.ts` (emits `dist/sw.js` with the precache list), `vercel.json`; live at https://steam.edycu.dev |
| 8 Cook Mode app | `src/App.tsx`, `src/app/router.ts` (hash router), `src/app/Shelf.tsx`, `Edition.tsx`, `Cook.tsx`, `Quoted.tsx`; `src/cook/scheduler.ts` (sleep and resume), `src/cook/clock.ts` (wall time), `src/app/useCookSession.ts` (sleep and resume from page visibility), `src/cook/revealGate.ts`, `src/cook/visibleTimer.ts` (the visible-only wait for the final wipe), `src/cook/wakelock.ts`; `src/offline/`; the verify link: `src/app/components/ArchiveSlip.tsx` → `regionUrl` in `src/data/provenance.ts` |
| 9 The steam pane | `src/steam/renderer.ts` (`getContext('webgl2')`), `src/steam/governor.ts` (`GOV_P95_MS = 18`, `MAX_TIER = 3`), `src/steam/SteamGlass.tsx` (static when reduced motion, no WebGL2 or a lost context), `src/steam/StaticPane.tsx`, `src/steam/drips.ts` |
| Steering, specs, hooks | `.kiro/steering/` (5 files), `.kiro/specs/` (5 feature specs, 10 bugfix specs), `.kiro/hooks/` (6) → `tools/hooks/*.ts` → `docs/kiro-evidence/hooks.log`. Five hooks run on write, shell and file-save events; the sixth, `tests-after-task`, runs at the end of a spec task and has no `hooks.log` line (it does not fire in headless runs). How each was used: [`docs/KIRO.md`](docs/KIRO.md) |

## Notes

- **The picture inside the steam pane** is the renderer's own frame, not an illustration: `public/recipes/quinces-marmalade/panes/till-it-looks-red-smooth-page-held.webp`, written by `scripts/render-static-panes.ts`, which opens the live pane and photographs it (the same images `StaticPane` shows). It is cropped and scaled down to fit the figure.
- **Not drawn as an arrow:** the `panes/*.webp` files reach `public/` through `scripts/render-static-panes.ts` (`npm run static-panes`), not through `steam-ingest catalog`; a catalog run clears `public/recipes/<id>/` first, so the panes are rendered again after it. The diagram shows one recipe-bundle arrow.
- **Commit labels:** each product commit says who wrote it, `[kiro]` or `[claude-direct]`; count them with `git log --format=%s | grep -c '^\[kiro\]'`.
- The diagram's source is kept outside this repository; it is drawn from the files listed above.
