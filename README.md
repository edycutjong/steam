<div align="center">
  <img src="docs/icon-animated.svg" alt="Her Hand in the Steam icon, animated: a sash window at night, the full moon in the upper sash; below, the writer's word &quot;smooth&quot;, lifted from the c. 1750 scan, is wiped clear of the fog and holds" width="144">
  <h1>Her Hand in the Steam 🕯️</h1>
  <p><em>A dead writer's hand, still writing in the steam.</em></p>
  <img src="docs/readme-hero-animated.svg" alt="Animated banner, an illustration composed from the scan: on All Hallows' night a cloud crosses the moon, a candle gutters, the fog thickens over the pot, and the writer's c. 1750 note &quot;till it Looks red &amp; smooth&quot; is written out of the steam on the window and holds; beside it, c. 1750, Wellcome MS.1810, p.23, Public Domain Mark" width="100%">

  A typed copy can keep "till it Looks red & smooth" and still lose the writer's hand, the page it came from, and the moment at the stove when it matters. Her Hand in the Steam is Cook Mode for one such page, *Marmalade of Quinces* (Wellcome Collection MS.1810, p.23, c. 1750): at each step where the writer left a judgement, steam condenses on a pane of glass, the writer's own scanned ink is wiped clear of the fog, and every note links back to its region of the archive's scan. The browser runs no model; two isolated Kiro agents read the page at build time, and a code gate decides what may be published.

  <br/>

  [![Live Demo](https://img.shields.io/badge/🚀_Try_it-live-06b6d4?style=for-the-badge)](https://steam.edycu.dev/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=6)
  [![Pitch Deck](https://img.shields.io/badge/📊_Pitch-Deck-f59e0b?style=for-the-badge)](https://steam.edycu.dev/deck/)
  [![Built for Kiroween 2026](https://img.shields.io/badge/Devpost-Kiroween_2026-8b5cf6?style=for-the-badge)](https://kiroween.devpost.com/)

  <br/>

  ![Kiro](https://img.shields.io/badge/Built_with-Kiro-8845f4?style=flat)
  ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)
  ![React](https://img.shields.io/badge/React_19-20232a?style=flat&logo=react&logoColor=61dafb)
  ![WebGL2](https://img.shields.io/badge/WebGL2-990000?style=flat&logo=webgl&logoColor=white)
  ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite&logoColor=white)
  [![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)
  [![CI](https://github.com/edycutjong/steam/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/steam/actions/workflows/ci.yml)

</div>

---

## 📸 See it in Action

*The animated banner above is an illustration composed from the scan's ink; the live app renders the glass in WebGL2.*

**Try it:** [open the hero moment](https://steam.edycu.dev/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=6). No install and no input: the pot runs at a visible ×12 pace and the note is written out of the fog after a 6 s lead-in. [`DEMO.md`](DEMO.md) has the exact judge steps and what to expect at each one.

The recipe is *Marmalade of Quinces* from Wellcome Collection MS.1810, an anonymous collection of cookery receipts, "by several hands", c. 1750. The three notes you can meet in Cook Mode are the writer's own words, cut from the scan: "till it Looks red & smooth", "when Tender", "full ripe".

## 💡 The Problem & Solution

### The Problem
Handwritten recipes keep the judgement calls in the writer's own hand. Typing a recipe up flattens "till it looks red & smooth" into a line of text, and the person who wrote it disappears.

### The Solution
Cook Mode runs the recipe's steps against a pot on a fogged window. At the step where the writer left a judgement, the lamp dips, the simmer drops, and the writer's own ink is wiped clear of the glass. The typed step stays on screen for reading and for screen readers. **The handwriting is never generated:** the ink is the scan's own ink lifted off the paper: its shape and density come from the scan and are drawn in the renderer's colour, a processed render and not a copy of the scan's pixels. `scripts/verify_provenance.py` re-fetches each note's region from the archive and checks that the bundled page crop matches it and that the displayed ink lies inside it (the bounding box of the displayed pixels, check b1). The write-on follows a traced path through that ink, so the order of strokes is ours, not the writer's. "Verify at source" opens the untouched region on the archive's server.

## 🏗️ Architecture & Tech Stack

![Architecture as built, drawn as a sash window and read 1 to 9. Upper sash: 1 the Wellcome Collection archive (Catalogue API for the licence, IIIF Image API for the page). Left pane, build time, down: 2 steam-ingest fetch checks the licence first, 3 segment cuts the lines and their ink masks, 4 two isolated Kiro agents (scribe, second-reader) read the strips inside the Kiro workflow ingest-recipe, 5 the code gate merges the readings with a Kiro agent's word cuts and stroke review and checks P1 to P6, 6 steam-ingest catalog publishes the bundle. Along the sill: 7 GitHub Actions, where CI must pass before Deploy ships the prebuilt site to Vercel and a live smoke test runs. Right pane, runtime, up: 8 the Cook Mode app reveals the scan's own ink in 9 the WebGL2 steam pane, and its verify-at-source link returns to the archive. Below: Kiro steering, specs and hooks, how the code was written.](docs/architecture.png)

*Read steps 1 to 9: down the build pane, along the sill (shipping), up the runtime pane; the dashed "verify at source" link closes the loop at the archive. The picture inside the steam pane is the renderer's own held frame. Every box, with the files behind it and the same diagram in Mermaid: [`ARCHITECTURE.md`](ARCHITECTURE.md).*

| Layer | What |
|---|---|
| App | React 19 + TypeScript, Vite, hash router (shelf, edition, Cook Mode, "The hand, quoted"); static `dist/` on Vercel, offline-capable shell (service-worker precache of the Cook path) |
| Renderer | One WebGL2 steamed-glass renderer: fog field, droplets and runs, candle, a quality governor that steps down to a static pane |
| Ingestion | `tools/steam-ingest`: IIIF fetch with a licence allow-list, code-built ink-ownership masks per line (the word boundaries inside a line are chosen by a Kiro agent from code-found runs and checked by the gate), and a gate of properties P1-P6 that a recipe must pass before it reaches Cook Mode |
| Agents | Two isolated Kiro custom agents read the page (`scribe`, `second-reader`); disagreements are kept and shown as `†`, never resolved by a model |
| Runtime model | None. The browser runs no model |

## 🏆 Kiro Integration

Kiro is the engine, not decoration. [`docs/KIRO.md`](docs/KIRO.md) is the causal chain: for each Kiro feature, the files that drove the work, the commits it produced and where to check it, plus what was planned and **not** built.

- **Specs:** 5 feature specs and 10 bugfix specs in [`.kiro/specs/`](.kiro/specs/). 8 of the 10 bugfix specs committed a failing test before the fix.
- **Steering:** 5 files in [`.kiro/steering/`](.kiro/steering/) encode "quoted, not generated".
- **Hooks:** 6 in [`.kiro/hooks/`](.kiro/hooks/); `docs/KIRO.md` section 2 states what they saw and what they missed, including the gap we measured in our own hook evidence.
- **Custom agents and a workflow:** [`.kiro/agents/`](.kiro/agents/) and [`.kiro/workflows/ingest-recipe.workflow.json`](.kiro/workflows/ingest-recipe.workflow.json).
- **Commit labels:** every product commit says who wrote it, `[kiro]` or `[claude-direct]`. Run `git log --format=%s | grep -c '^\[kiro\]'` to count.
- **Not built:** an MCP server, a Power, an archivist agent, the fog A/B and the spec-vs-vibe comparison. No build-wide credit total was kept (one workflow run is measured). All stated in `docs/KIRO.md` section 4.

Experiments, counted by what ran, with "not run" stated for the rest: [`docs/EXPERIMENTS.md`](docs/EXPERIMENTS.md). Friction with Kiro, dated: [`docs/DX-REPORT.md`](docs/DX-REPORT.md).

## 📊 Engineering Rigor

| Check | Result | Source |
|---|---|---|
| Unit and property tests | **1571 passed, 5 expected-fail** (170 files) at 7318dcc; the 5 are the crop-overlap bug reproduction, kept red on purpose: the kill test's eye-read crop boxes must keep failing property P4 on steps 1-5 (`it.fails`, `src/ingest/cropOverlap.bug.test.ts`) | `npm test` (output: `docs/kiro-evidence/unit-run.txt`) |
| End-to-end (Playwright) | **114 of 114 passed** in the full local run of 2026-11-27 (macOS, Chromium on software GL); CI runs the same suite on `macos-latest` (E2E workflow). The intermittent failure of earlier runs, `e2e/cook-session.spec.ts` "a note with an unsupported licence is withheld" (formerly line 110; the deep link started at step 4, not 1), was a race in the test, not the app: once the service worker had precached `recipe.json` and claimed the page, the reload was answered from its cache with the real bundle instead of the test's mocked one. Waiting for the worker before the reload reproduced it 3 of 3; the test now blocks the worker, as `shelf-retry.spec.ts` already did | `npm run e2e` (output: `docs/kiro-evidence/e2e-run.txt`) |
| Ingestion gate P1-P6 on the shelf recipe | pass | `npm run props` |
| Provenance: the bundled page region each note comes from matches a fresh IIIF fetch (the displayed note is a processed render of those pixels) | 3 of 3 notes match a fresh IIIF fetch, NCC .960 / .976 / .991 (threshold .90 fixed before the first run); a shifted region and a wrong page both fail | `scripts/verify_provenance.py` |
| Agent-output evals | 8 ran, 8 pass; E3 not run | `docs/EXPERIMENTS.md`, row 7 |
| Lighthouse (CI, mobile emulation, median of 5 runs) | performance `/landing/` 100, `/deck/` 99, `/` 88 (its runs spread 80-95: the shelf renders after the app bundle); accessibility, best practices and SEO 100 on all three; budgets in `lighthouserc.json` | [Quality run 45913908565](https://github.com/edycutjong/steam/actions/runs/45913908565) (2026-11-27) |
| Bundle (gzip) | app JavaScript 141.6 KiB, app CSS 7.1 KiB; the landing page and deck add the 116.3 KiB renderer bundle | `npm run budget` (`scripts/bundle-budget.ts`, budgets about 10 % above these) |

### Frame rate
From [`bench/results.json`](bench/results.json): Chromium 159 on an Apple M1 Max through ANGLE Metal, 15 s per profile, `npm run bench`. **The machine was not idle** while it ran (other jobs; the load averages are in [`bench/README.md`](bench/README.md)). Reproduce with `BENCH_ANGLE=metal npm run bench`. The renderer, governor and layout have changed since this run (`bench/README.md` records the shader at commit 553c771), so re-run before quoting it. This table is the second of two back-to-back runs; in the first, `desktop-1280x720` averaged 59.34 fps with 2 frames under 55 fps (`bench/README.md`).

| Profile | Avg fps | Frames under 55 fps | p95 frame | Quality tier at end |
|---|---|---|---|---|
| Desktop 1280×720 | 60 | 0 | 16.7 ms | 0 (full) |
| Desktop 1920×1080 | 60 | 0 | 16.8 ms | 0 (full) |
| Pixel 5 emulation, 4× CPU throttle, 393×851 @2.75 | 60 | 0 | 16.7 ms | 0 (full) |
| Capture setup 1920×1080 | 60 | 0 | 16.7 ms | 0 (full) |
| Software GL (SwiftShader), 1280×720, recorded, not a budget row | 34.96 | 182 | 50.1 ms | 3 (static pane) |

Emulated Pixel 5 only; no physical Android run was made. On software GL the quality governor gives up the animation and shows the static pane, so that row is not the full-quality figure.

### Honest limits
- The renderer's look gate (7/10) was **not met** at look pass 2: a frame review scored it 6.5 on desktop and 6.5 on phone. The shipped look pass 3 has no score recorded in this repository, so the animated renderer ships as a bounded claim. Record: `docs/kiro-evidence/renderer-v1/NOTES.md`, `docs/EXPERIMENTS.md`.
- Only one recipe is on the shelf, and the reading was done by two Kiro agents. The sign-off in `content/recipes/quinces-marmalade/review.json` is the builder's agent, not a human; a human sign-off is still owed.
- The manuscript gives no cooking times, so none is invented: each note is placed at its step or at a cited modern check time, and each time is labelled.

## 🚀 Getting Started

### Prerequisites
Node 22 and npm.

### Installation
```bash
npm ci
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
```

## 🧪 Testing & CI

```bash
npm test           # vitest: unit + property suites
npm run props      # ingestion gate over every recipe
npm run e2e        # Playwright (installs Chromium: npx playwright install chromium)
npm run bench      # frame-rate profiles → bench/results.json
```
Six GitHub Actions workflows run on every push to `main` (and on pull requests, except Deploy):

[![CI](https://github.com/edycutjong/steam/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/steam/actions/workflows/ci.yml)
[![E2E](https://github.com/edycutjong/steam/actions/workflows/e2e.yml/badge.svg)](https://github.com/edycutjong/steam/actions/workflows/e2e.yml)
[![CodeQL](https://github.com/edycutjong/steam/actions/workflows/codeql.yml/badge.svg)](https://github.com/edycutjong/steam/actions/workflows/codeql.yml)
[![Security](https://github.com/edycutjong/steam/actions/workflows/security.yml/badge.svg)](https://github.com/edycutjong/steam/actions/workflows/security.yml)
[![Quality](https://github.com/edycutjong/steam/actions/workflows/quality.yml/badge.svg)](https://github.com/edycutjong/steam/actions/workflows/quality.yml)
[![Deploy](https://github.com/edycutjong/steam/actions/workflows/deploy.yml/badge.svg)](https://github.com/edycutjong/steam/actions/workflows/deploy.yml)

| Workflow | What it runs |
|---|---|
| [CI](.github/workflows/ci.yml) | oxlint + actionlint, typecheck, the unit + property suite on Node 22 and 24 (built first, so the dist checks run too: 1571 passed + 5 expected-fail on both), the ingestion gate, build + `check:dist` |
| [E2E](.github/workflows/e2e.yml) | the Playwright suite against the production build, Chromium on software GL, on `macos-latest` (the platform the timing checks were measured on); in CI a failed test is retried once and a pass on retry is reported as flaky, not as passed |
| [CodeQL](.github/workflows/codeql.yml) | `security-extended` queries over the TypeScript and over these workflows |
| [Security](.github/workflows/security.yml) | gitleaks over the full history (pinned release, checksum checked), `npm audit` at moderate, dependency review on pull requests |
| [Quality](.github/workflows/quality.yml) | Lighthouse CI on `/`, `/landing/`, `/deck/` (median of 5 mobile runs, budgets in `lighthouserc.json`) and a gzip budget for the code those pages load (`npm run budget`) |
| [Deploy](.github/workflows/deploy.yml) | only after CI passes on `main`: `vercel build`, then `vercel deploy --prebuilt` of that output to https://steam.edycu.dev, then `npm run smoke:live`: the three pages, the hero deep link opened in Chromium (it must reveal the note and end on "The hand, quoted") and the files it loads |

Every action is pinned to a commit SHA; Dependabot keeps npm packages and actions current. The Vercel project has no Git integration, so the Deploy workflow is the only path from a push to production.

## 📁 Project Structure

```
.kiro/          specs, steering, hooks, agents, workflow: the build direction
src/steam/      the WebGL2 renderer      src/app/     shelf, edition, Cook Mode
src/ingest/     ownership masks, gate    tools/       steam-ingest CLI, hooks, evidence
content/        the recipe, its readings, review record
bench/          frame-rate runs          docs/        KIRO, EXPERIMENTS, DX-REPORT
```

## 📽️ Demo Materials

- Live: https://steam.edycu.dev
- Judge steps: [`DEMO.md`](DEMO.md)
- Architecture, box by box: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Landing page: https://steam.edycu.dev/landing/ and pitch deck: https://steam.edycu.dev/deck/ (both mount the app's own `SteamGlass` through `site/glass.tsx`)
- Demo video: not published yet.

## 📄 License

Code: MIT ([LICENSE](LICENSE)). The manuscript images are public domain: Wellcome Collection MS.1810, Public Domain Mark.

## 🙏 Acknowledgments

Wellcome Collection, for the manuscript and its open IIIF service. The unnamed writer of this page of *Marmalade of Quinces*.
