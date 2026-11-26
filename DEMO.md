# Demo: how to see it in 60 seconds

Live: https://steam.edycu.dev (static site on Vercel; no account, no install, no model call in the browser).

## Judge steps

| # | Do this | Expect |
|---|---|---|
| 1 | Open the [hero deep link](https://steam.edycu.dev/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=6) in desktop Chrome. | Cook Mode opens on the step "…boil it till it Looks red & smooth…". The pot runs at a visible ×12 pace. After a lead-in of 6 s (the `lead=6` in the link) the writer's note "till it Looks red & smooth" is written out of the fog in ink. Without input. |
| 2 | During the lead-in, press **Show the note**. | The fog thickens at once and the write-on follows about 1.2 s later, without waiting for the lead-in. Otherwise wait for it. |
| 3 | Wait for the write-on to finish (about 5 s of writing, about 6 s from the press). | The scanned ink holds on the glass. The typed step text stays on screen beside it. On this last step the control now reads **The hand, quoted**; on earlier steps (`?note=when-tender`, `?note=full-ripe`) it reads **Wipe the glass**, which clears the ink and moves to the next step. A drag across the glass with the mouse or a finger does the same (`e2e/cook-flow.spec.ts`); by keyboard, Tab to the control and press Space or Enter (`e2e/cook-a11y.spec.ts`). |
| 4 | Press **The hand, quoted** (or open `#/r/quinces-marmalade/quoted`). | The glass wipes and the page "The hand, quoted" opens, showing the notes quoted from the scan. |
| 5 | On that page press **verify at source ↗**. | The note's bounding box opens on Wellcome's own image server (needs a connection). The page says the box may take in a little of the neighbouring lines. |
| 6 | Open the shelf (`https://steam.edycu.dev/`) and press **Watch it at ×12** or **Cook it**. | One recipe on the shelf: *Marmalade of Quinces*. **Cook it** runs at real time (no `pace` in the URL). |
| 7 | Open the edition view, `#/r/quinces-marmalade`, and press **Read the provenance**. | The typed transcription with the two Kiro readers' disagreements marked `†` and both readings shown. The slip expands to institution, shelfmark MS.1810, page p.23, date, licence (Public Domain Mark), credit, the Wellcome work page and IIIF manifest (links), the canvas id and image service (text), the retrieval date and the review line. Beside each note the edition shows when it arrives ("with its step"); press that control to see the basis ("the manuscript gives no time; the note arrives with its step"). Cook Mode shows neither. |
| 8 | Offline: after one online visit, turn the network off and open the hero deep link again. | Cook Mode runs from the service worker's cache and reaches "The hand, quoted"; only **verify at source** needs the network. Checked by `python3 scripts/verify_offline.py https://steam.edycu.dev` on the production deploy (`docs/kiro-evidence/offline-shell/verify-offline-live.txt`: RESULT: PASS). |

Other deep links: `?note=when-tender` and `?note=full-ripe` (the other two notes); `pace=1`, `4` or `12`; `lead=<seconds>` (0 to 120); `fps=1` shows a frame-rate overlay.

Reduced motion: with the operating system's reduced-motion setting on, the canvas is replaced by a static pane and the held note fades in (`e2e/cook-a11y.spec.ts`); nothing is written.

## The landing page and the deck
https://steam.edycu.dev/landing/ and https://steam.edycu.dev/deck/ are static pages beside the app (`public/landing/`, `public/deck/`). Their steamed window is the app's own `SteamGlass` component, mounted by `site/glass.tsx` and built into `dist/site/glass.js` by `tools/site/vite-plugin.ts`. On a browser that draws WebGL in software (or has no WebGL2), both pages keep a still frame and say so under the pane. That frame is from the landing page's running pane (a local build), captured with Playwright on a GPU on 2026-11-26 (UTC+7). The three Cook Mode stills were captured from steam.edycu.dev with Playwright on 2026-11-26 (UTC+7), on Chromium's software GL. The capture scripts are not published. The pages sit outside the offline shell (`SITE_PREFIXES` in `src/offline/precache.ts`), so the service worker never serves them from its cache. A browser still controlled by a worker older than commit cf37cfb answers those two URLs with the app until the new worker takes over on a later load; a browser that never opened the site is unaffected. The entry is in the Costume Contest category.

## What is real and what is ours

- The ink is the scan's own ink lifted off the paper: its shape and density come from the scan and are drawn in the renderer's colour (a processed render, not a copy of its pixels). No handwriting font, no generated hand, no synthetic voice.
- The write-on follows a traced path through that ink, left to right. It is not the writer's pen order.
- The manuscript gives no cooking times. Each note arrives with its step (`checkAt` in `content/recipes/quinces-marmalade/recipe.json`), and the app says so.
- The recipe was read by two isolated Kiro agents and gated by code; the sign-off record is the builder's agent, not a human (`content/recipes/quinces-marmalade/review.json`).

## Numbers, and how to reproduce them

| Claim | Number | Reproduce |
|---|---|---|
| Unit and property tests | 1571 passed, 5 expected-fail (170 files) at 7318dcc | `npm ci && npm test` (output: `docs/kiro-evidence/unit-run.txt`) |
| Ingestion gate | P1-P6 pass on the shelf recipe | `npm run props` |
| Frame rate, four budget profiles (Apple M1 Max, ANGLE Metal, machine not idle) | 60 fps average, 0 frames under 55 fps in each | `BENCH_ANGLE=metal npm run bench` → `bench/results.json` (measured at renderer commit 553c771, since changed; second of two back-to-back runs; the first had 2 frames under 55 fps on desktop 1280×720) |
| Software GL, recorded, not a budget row | 34.96 fps average, 182 frames under 55 fps, quality governor at tier 3 (static pane) | same run |
| Provenance: the bundled page crop each note comes from vs a fresh IIIF fetch of the same region | NCC .960 / .976 / .991 against a fresh IIIF fetch, threshold .90 | `python3 scripts/verify_provenance.py` |

Emulated Pixel 5 profile only; no physical Android run was made.

## Cold-open timing (not a claim about the live bundle)

Gate used for the video's cold open: interactive + lead-in + full write-on + 1.5 s readable slip ≤ 18.0 s from navigation start, cold cache. The takes log is kept by the builder and is not published. The last take was measured on the bundle at commit 6e66923 (`lead=6`): ready at 2305 ms, lead-in 5321 ms, write-on 6247 ms, 15.4 s total. **That bundle has since been superseded** (hero-hold-clearance and the a2a-arch fixes), so this is a historical measurement. It was not re-measured on the current bundle: the demo video was captured frame by frame on Chrome's virtual clock, which records what the renderer draws at each instant but does not time a cold load, so the video does not test this gate. On the default link (no `lead`, a 10 s lead-in) 2 of the 3 takes were over the 18.0 s gate (18.1 s); that is why the hero link carries `lead=6`.
