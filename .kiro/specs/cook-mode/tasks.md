# Tasks: cook-mode

Order follows dependencies: ingest additions and pure data first, then the pure cook logic, then the renderer changes, then screens, then end to end, then measurement. Every task writes its test first, watches it fail (a failing run is the evidence), then implements until it passes. Requirement numbers refer to `requirements.md` (R14.2 = requirement 14, criterion 2). Tests sit beside code as `*.test.ts`; property tests as `*.prop.test.ts`. Property names (P7, P8, K1 to K9) refer to `design.md` §13.

Rules for every task:

- Run `npm test` and `npm run typecheck` before ticking it. The `tests-after-task` hook runs `npm test` after a task; its log line is written by the hook, never by hand.
- No task adds recipe data to `src/`. Tests read `public/recipes/quinces-marmalade/` or derive from it.
- No task writes a number into user-facing copy that a file or a named constant does not produce (honesty steering).
- Commit messages say who wrote the code: `[kiro]` for Kiro's work, `[claude-direct]` for the builder agent's.

## A. Tooling and the bundle's missing fields

- [x] 1. Test environment and dev dependencies
  - Test first: a smoke test that imports `fake-indexeddb/auto` and opens a database; a smoke test with the docblock `// @vitest-environment happy-dom` that renders `<button>` with `react-dom/client` and reads it back.
  - Implement: `npm i -D happy-dom fake-indexeddb @axe-core/playwright`. Leave `vitest.config.ts` on the node environment, with the per-file docblock for DOM tests.
  - Files: `package.json`, `package-lock.json`, `src/app/env.smoke.test.tsx`.
  - Satisfies: R23.7, R26.1.

- [x] 2. One computation for the verify box and the percentage URL
  - Test first: extend `src/ingest/verify-url.test.ts`. `verifyRegion(input)` returns `{box: [x, y, w, h], approximate}` in page-frame px; `verifyUrl(input).url` equals the percentage form of that box (4 decimals); the three committed `verifyUrl` strings of `public/recipes/quinces-marmalade/recipe.json` are reproduced exactly from the committed `pageBox`, frame 1601×2052 and `deskewDeg` 1.6 of `content/recipes/quinces-marmalade/lines.json`; the box is clipped to the frame; with no deskew the box equals `pageBox` as `[x, y, w, h]`.
  - Implement: `verifyRegion()` in `src/ingest/bundle.ts`; `verifyUrl()` calls it and formats the result. No output of `verifyUrl` changes.
  - Files: `src/ingest/bundle.ts`, `src/ingest/verify-url.test.ts`.
  - Satisfies: R21.2, R21.3.

- [x] 3. Record the manifest canvas: `steam-ingest canvas`
  - Test first: `Source` accepts `canvas: {id, width, height}` (positive integers, non-empty id) and still accepts a file without it. `canvasCmd(root, id, {fromFixture: true})` reads `fixtures/wellcome-manifest-b18419665.trimmed.json`, finds the canvas at the recipe's `canvasIndex`, and writes `canvas` into `source.json` (id `https://iiif.wellcomecollection.org/presentation/b18419665/canvases/b18419665_MS_1810_0033.JP2`, width 3695, height 4737) with every other field byte-identical. It refuses a manifest whose canvas has no width or height, and a canvas whose image service differs from `source.imageService`. `gate --all --verify` is unchanged by it (`source.json` is not a gate input). The CLI prints a one-line usage and exits 2 on bad arguments.
  - Implement: `canvas` subcommand in `tools/steam-ingest/cli.ts` and a `canvas.ts` beside `fetch.ts`; `Source.canvas` optional in `src/data/schema.ts`; live mode reads the manifest through the same injected `Get` as `fetch`. Run it for the existing recipe: `npx tsx tools/steam-ingest/cli.ts canvas quinces-marmalade --from-fixture`, and commit the new `source.json`.
  - Files: `src/data/schema.ts`, `tools/steam-ingest/canvas.ts`, `tools/steam-ingest/canvas.test.ts`, `tools/steam-ingest/cli.ts`, `tools/steam-ingest/cli.test.ts`, `content/recipes/quinces-marmalade/source.json`.
  - Satisfies: R21.1.

- [x] 4. Bundle fields: `source.canvas`, `source.frame`, `verifyBox`, `review`
  - Test first: in `src/ingest/bundle.test.ts` and `src/data/schema.test.ts`: a bundle without `source.canvas`, without `source.frame`, with a note lacking `verifyBox`, or (for scribe and second-reader readers) without `review` fails `RecipeBundle`; a `["fallback"]` bundle needs no `review`. `buildRecipeBundle` takes `frame`, `deskew` and `review` as inputs and writes `notes[].verifyBox` from `verifyRegion`. In `tools/steam-ingest/catalog.test.ts`: regenerating the quinces bundle changes no file that `gate.json` hashes and leaves `gateSha256` equal to `eb3fabc0…df10d`; `review.reviewedBy` in the bundle equals "Claude Code builder agent (autopilot P1b), not a human" character for character; `source.frame` is 1601×2052; `source.canvas` is 3695×4737.
  - Implement: schema (`Source` stays optional-`canvas` for source.json; `RecipeBundle.source` requires it), `buildRecipeBundle`, `catalog.ts` passing `lines.json`'s frame and deskew and `review.json`'s `reviewedBy` and `reviewedAt`. Run `npm run catalog` (the only writer of `content/catalog.json`) and `npm run props`, and commit the regenerated `public/recipes/quinces-marmalade/recipe.json`. The diff of `recipe.json` shall be the four added fields only.
  - Files: `src/data/schema.ts`, `src/ingest/bundle.ts`, `tools/steam-ingest/catalog.ts`, `src/ingest/bundle.test.ts`, `src/data/schema.test.ts`, `tools/steam-ingest/catalog.test.ts`, `public/recipes/quinces-marmalade/recipe.json`.
  - Satisfies: R21.2, R21.3, R21.7, R3.5, R3.6.

## B. Provenance, reading marks, routes, loading, store

- [x] 5. The IIIF region and its URL
  - Test first: `src/data/provenance.test.ts`. `regionOf` on the real bundle's hero note returns `{x: 641, y: 3660, w: 2897, h: 511}` (recomputed in the test from the bundle's `verifyBox`, frame and canvas, not pasted) and `regionUrl` is `https://iiif.wellcomecollection.org/image/b18419665_MS_1810_0033.JP2/641,3660,2897,511/full/0/default.jpg`; floor/ceil containment on hand-made boxes; clipping at the canvas edge; a zero-area box gives null; `parseRegionUrl(regionUrl(...))` returns the same service and region; `parseRegionUrl` rejects a URL with non-integer, negative or missing numbers, another size or rotation segment, or a `pct:` region. Each edge is within 1 canvas px of the percentage `verifyUrl` times the canvas size, for all three notes.
  - Implement `regionOf`, `regionUrl`, `parseRegionUrl` in `src/data/provenance.ts`.
  - Files: `src/data/provenance.ts`, `src/data/provenance.test.ts`.
  - Satisfies: R21.4, R21.5, R21.6, R20.5.

- [x] 6. Resolve a note to its source
  - Test first: `resolveNote` ok on the three real notes. One failing case per rule of R22.2: manifest not https; empty canvas id; non-integer `canvasIndex`; `provenance` disagreeing with `source` in each of the six fields; licence id `cc-by-nc`; zero-area region; region outside the canvas. Each returns `ok: false` with the reason of that rule and no other. `displayableNotes` returns the ok notes in step order and lists the rest as `withheld`.
  - Implement `resolveNote`, `displayableNotes`, `LICENCES` in `src/data/provenance.ts`.
  - Files: `src/data/provenance.ts`, `src/data/provenance.test.ts`.
  - Satisfies: R22.1, R22.2, R22.4.

- [x] 7. P8 property test
  - Test first: `src/data/provenance.prop.test.ts`: generators edit the real bundle (licence id, manifest, canvas id and size, frame, `verifyBox`, each `provenance` field, field deletion). Assert P8.1 to P8.5 of `design.md` against an independent predicate written in the test. P8.6 is asserted in task 31 (where the lists exist) and noted here as a pending case. Mutation check: temporarily change the licence set, the floor to a round, and the 1 px agreement bound, and see the property fail each time; record the three failing runs in the task's commit message, then restore.
  - Implement: nothing new; fix what the property finds.
  - Files: `src/data/provenance.prop.test.ts`.
  - Satisfies: R22.3.

- [x] 8. Reading marks: parse, join, primary and plain text
  - Test first: `src/data/reading.test.ts`. `parseReading` on the real line 3 ("†[(N.26)|] take out the †[Cores|cores] and seeds, & boil the") gives two marks, the first with an empty `b`; `joinReading` inverts it; `primaryText` gives "(N.26) take out the Cores and seeds, & boil the" which equals `lines[3].primary`; `plainText` writes "(N.26) (the second reader reads nothing) …" and "Cores (the second reader reads cores)"; a lone `†` without brackets stays text; a marker with spaces inside (`†[a b|c]`) parses as one mark.
  - Implement `parseReading`, `joinReading`, `primaryText`, `plainText` in `src/data/reading.ts`.
  - Files: `src/data/reading.ts`, `src/data/reading.test.ts`.
  - Satisfies: R6.3, R6.6, R23.3.

- [x] 9. Quote segments and K2
  - Test first: `quoteSegments` on the three real notes: the hero gives "till it Looks" + " " + "red & smooth," whose `primaryText` equals `shownText` and, without the trailing comma, `span`; `full-ripe` and `when-tender` likewise. A note whose words touch a marker keeps the marker whole (use a variation of the bundle where `groups[].words` covers "Cores"). `words: 'line'` takes the whole line. `src/data/reading.prop.test.ts` (K2): lossless round trip, mark count equals `†[` count, `primaryText` equals the marker-replaced string; on the real bundle, every step without a `corrected` line has `primaryText` of its joined `corrected ?? merged` lines equal to `steps[n-1].text`.
  - Implement `quoteSegments` in `src/data/reading.ts`.
  - Files: `src/data/reading.ts`, `src/data/reading.test.ts`, `src/data/reading.prop.test.ts`.
  - Satisfies: R6.6, R9.2, R20.4.

- [x] 10. Router and K1
  - Test first: `src/app/router.test.ts`: the five routes parse; `?pace=12&note=till-it-looks-red-smooth&lead=3&fps=1` parses; `pace=7`, `pace=`, `lead=-1`, `lead=NaN`, `lead=999` and a repeated key give the defaults; unknown keys are ignored; `#/r/Quinces` (capital) and `#/r/` and `#/x` are `notFound`; a trailing slash parses. `src/app/router.prop.test.ts` (K1): round trip over generated routes; `parseRoute` never throws on any string and its result re-parses to itself.
  - Implement `src/app/router.ts`.
  - Files: `src/app/router.ts`, `src/app/router.test.ts`, `src/app/router.prop.test.ts`.
  - Satisfies: R1.1, R1.2, R1.3, R1.4, R1.7.

- [x] 11. Catalog and bundle loader
  - Test first: `src/data/catalog.test.ts` with an injected `fetch` that serves the real files and variants: the real catalog yields one recipe with three displayable notes and none withheld; an invalid bundle (a deleted required field), a `gateSha256` different from the catalog's, a `bundle.id` mismatch, a note on step 9, two notes on one step, a group on line 99, a 404 and a network error each leave the recipe out, with one `console.warn` naming the id and reason (spy); an invalid catalog gives the error result; a note with licence `cc-by-nc` leaves the recipe in and the note in `withheld`; results are cached (one fetch per id). A scan test fails if `src/` outside `*.test.*` contains the string `"Marmalade of Quinces"` or the id `quinces-marmalade` in a data position.
  - Implement `loadShelf`, `checkCookable` in `src/data/catalog.ts` with `import catalogJson from '../../content/catalog.json'`.
  - Files: `src/data/catalog.ts`, `src/data/catalog.test.ts`.
  - Satisfies: R2.1, R2.2, R2.3, R2.4, R2.5, R2.7.

- [x] 12. Device store
  - Test first: `src/data/store.test.ts` with `fake-indexeddb`: session put, get, delete; timing put, get, delete; settings; data survives re-opening the store; `persistent` is true. With `indexedDB` undefined, with an `open` that throws, and with a transaction that aborts: the store still works in memory, `persistent` is false, and nothing throws. Database name `steam`, version 1, stores `sessions`, `timing`, `settings`.
  - Implement `openStore` in `src/data/store.ts`.
  - Files: `src/data/store.ts`, `src/data/store.test.ts`.
  - Satisfies: R18.1, R18.8, R18.9.

## C. Check times, the plan and the timer

- [x] 13. Check-time labels, durations, effective check time (K8)
  - Test first: `src/cook/timing.test.ts`: `formatDuration` (30 → "30 s", 60 → "1 min", 90 → "1 min 30 s", 10800 → "180 min"); `checkLabel` of the real hero `checkAt` is "with its step"; a cited `{seconds: 600, basis: "boil ten minutes"}` is "check from 10 min · cited: boil ten minutes"; a cook override of 90 is "check from 1 min 30 s · set by you"; a cook override of 0 is "with its step · set by you"; `effectiveCheckAt` prefers the override and carries `source: "cook"` and the basis "set by you on this device"; the stepper function `stepSeconds(current, dir)` moves 30 s, clamps to 0 and 10 800. `src/cook/timing.prop.test.ts` (K8 block): override precedence, the label names its source, monotone `formatDuration`, stepper range and reset. A test reads the real bundle and expects `step-entry`, 0 s on all three notes.
  - Implement `formatDuration`, `checkLabel`, `effectiveCheckAt`, `stepSeconds`, `TIMING_STEP_S`, `TIMING_MAX_S`.
  - Files: `src/cook/timing.ts`, `src/cook/timing.test.ts`, `src/cook/timing.prop.test.ts`.
  - Satisfies: R8.1, R8.2, R8.3, R8.4, R8.5, R8.7.

- [x] 14. The plan and the pane's note
  - Test first: `src/cook/plan.test.ts`: `buildPlan` on the real bundle gives 5 steps with notes on steps 1, 4 and 5 (indices 0, 3, 4), each `checkAtMs` 0; with an override of 60 s on `when-tender` its `checkAtMs` is 60 000; withheld notes leave their step empty. `paneNoteFor`: steps 0 gives `full-ripe`; steps 1 and 2 give `when-tender` (the next note); step 3 gives `when-tender`; step 4 gives the hero; a plan with no note gives null; a plan whose only note is on step 0 gives it for every later step.
  - Implement `buildPlan`, `paneNoteFor`.
  - Files: `src/cook/plan.ts`, `src/cook/plan.test.ts`.
  - Satisfies: R8.1, R12.1, R15.5.

## D. The scheduler and P7

- [x] 15. Scheduler core: start, deep link, elapsed, scheduled reveal
  - Test first: `src/cook/scheduler.test.ts`. `start` on a plan whose step 0 has a step-entry note emits `reveal {cause: scheduled}` at the start wall time; with a note due at 60 s at pace 1, a tick at 59 999 ms emits nothing and a tick at 60 000 emits one reveal, and a second tick emits nothing. `deepLink` at step 4 with `leadMs` 10 000: a tick at 9 999 ms emits nothing, at 10 000 ms emits the reveal; with `lead` 0 it emits at once. The hold applies to the initial step only. `elapsedMs` with paces [1 then 4 then 12] equals the sum of pace × dt; a wall time lower than `lastWall` changes nothing; events before the first event, and `start`, `deepLink`, `restore` after it, change nothing but `lastWall`.
  - Implement `initialState`, `reduce` (`start`, `deepLink`, `tick`), `elapsedMs`, `noteState`.
  - Files: `src/cook/scheduler.ts`, `src/cook/scheduler.test.ts`.
  - Satisfies: R12.1, R12.2, R12.4, R12.5, R12.6, R12.8, R12.9, R12.10, R12.11.

- [x] 16. Scheduler: sleep, resume, pace, show
  - Test first: `sleep` at a wall time before the due time emits nothing; ticks, `show` and `wipe` while asleep emit nothing and change nothing but `lastWall`; `resume` after the due time emits exactly one reveal; `resume` before it emits none and the reveal comes later by tick. `setPace` 4 at 30 s of a 60 s note: elapsed 30 s, pace 4, the reveal falls at wall 37.5 s (`30 + 30/4`); a reveal due before the change is emitted before the pace changes; setting the same pace twice adds no history; two changes at one wall time keep the last. `show` on a pending note emits `reveal {cause: show}`; on a revealed note or no note, nothing; a scheduled reveal after `show` is a no-op.
  - Implement `sleep`, `resume`, `setPace`, `show`, `setPaceAt`.
  - Files: `src/cook/scheduler.ts`, `src/cook/scheduler.test.ts`.
  - Satisfies: R12.7, R12.8, R11.5, R10.4.

- [x] 17. Scheduler: wipe, advance, finish, `controlFor`, `nextDueWall`, snapshot, restore
  - Test first: `wipe` on a revealed note emits `advance` and, on arrival at a step-entry note, `reveal {scheduled}` in the same event; `wipe` on a no-note step advances; `wipe` on a pending note emits `reveal {cause: wipe}` then `advance`; `wipe` on the last step emits `finish` and the state is `finished`, after which every event changes nothing. The timer restarts at 0 on arrival and the pace carries over. `controlFor` returns each row of the Wipe table for hand-built states (named cases: "no note, not last", "pending", "revealed, not last", "last step revealed", "last step no note"). `nextDueWall` equals the wall time at which a tick first emits the reveal, for a pace history with two changes, and is null when asleep, finished, revealed or without a note. `toSnapshot` then `restore` gives the same step, history and revealed; a restore does not reveal a note in `revealed`; a restore on a step whose note is due reveals it once.
  - Implement `wipe` with `advance`, `controlFor`, `nextDueWall`, `toSnapshot`, `restore`.
  - Files: `src/cook/scheduler.ts`, `src/cook/scheduler.test.ts`.
  - Satisfies: R12.3, R12.7, R12.10, R14.1, R14.7, R18.2.

- [x] 18. P7 property test
  - Test first: `src/cook/scheduler.prop.test.ts` with the generators of R13.1 and an oracle written in the test (it replays the events against its own model: revealed set, elapsed integral, hold, sleep). Assert P7.1 to P7.11 of `design.md`, each as its own `it` or `fc.assert`, so a failure names the item. The Wipe table rows are named cases (R13.10). Include shrinking-friendly arbitraries (small walls first). Mutation check: change each of these and see P7 fail, then restore: remove the `revealed` check in `reveal`; reveal while asleep; skip the pending-note reveal in `wipe`; scale the hold by the pace; allow `restore` after the first event; let a decreasing wall time lower `lastWall`. Record the six failing runs in the commit message.
  - Implement: nothing new; fix what the property finds.
  - Files: `src/cook/scheduler.prop.test.ts`.
  - Satisfies: R13.1 to R13.11, R12.1 to R12.11, R10.3.

- [x] 19. Timer functions and K3
  - Test first: `formatElapsed` (0 → "0:00", 7 999 → "0:07", 125 000 → "2:05", 3 725 000 → "1:02:05", negative → "0:00"); `emberActive` on hand-built states: pending note due in 10 s of wall time at pace 12 → true; due in 10.001 s → false; due now → false; revealed → false; asleep → false; no note → false. `src/cook/timing.prop.test.ts` (K3 block): `elapsedMs` against the independent sum; output sequence from `reduce` under wall times with decreases is non-decreasing; `formatElapsed` monotone and re-parses to `floor(ms/1000)`; the ember rule at paces 1, 4, 12.
  - Implement `formatElapsed`, `emberActive`, `EMBER_WINDOW_S`.
  - Files: `src/cook/timing.ts`, `src/cook/timing.test.ts`, `src/cook/timing.prop.test.ts`.
  - Satisfies: R10.1, R10.2, R10.3, R10.4, R10.5.

- [x] 20. Session snapshot and K5
  - Test first: `src/cook/session.test.ts`: `Snapshot` accepts a real `toSnapshot`; `snapshotValid` rejects each malformed variant of R18.3 (wrong recipe, step out of range, history not starting at `stepStartWall`, history going backwards, unknown note id, repeated id, older than `SESSION_MAX_AGE_MS`, in the future). `src/cook/session.prop.test.ts` (K5): round trip over generated running states; elapsed unchanged at the restore wall time; no reveal of a revealed note.
  - Implement `Snapshot`, `snapshotValid`, `SESSION_MAX_AGE_MS`.
  - Files: `src/cook/session.ts`, `src/cook/session.test.ts`, `src/cook/session.prop.test.ts`.
  - Satisfies: R18.2, R18.3, R18.6, R18.7.

## E. Controls, gate, announcements, cue and audio (pure and injected)

- [x] 21. Drag recognizer and K9
  - Test first: `src/cook/drag.test.ts`: a 95 px path does not fire, 96 px of a pane at least 384 px wide fires once; a 300 px pane needs 96 px (25% is 75 px, the larger bound wins); a 1 000 px pane needs 250 px; a path that takes over 2 s does not fire; a tap (one sample) does not fire; a vertical drag of 400 px with no horizontal travel does not fire; back-and-forth movement counts its summed horizontal steps. `src/cook/drag.prop.test.ts` (K9) and the 400 ms debounce helper `dedupe(events, 400)`.
  - Implement `dragWipe`, `DRAG_MIN_PX`, `dedupe`.
  - Files: `src/cook/drag.ts`, `src/cook/drag.test.ts`, `src/cook/drag.prop.test.ts`.
  - Satisfies: R14.4, R14.6.

- [x] 22. The reveal gate and K7
  - Test first: `src/cook/revealGate.test.ts`: an effect enqueued before its pane is ready waits and applies once on `setReady`; one enqueued while blocked waits for `setBlocked(false)`; two effects apply in order; `setReady(null)` holds new effects; a second `setReady` for the same note does not re-apply. `src/cook/revealGate.prop.test.ts` (K7): at most once, in order, exactly once after readiness.
  - Implement `createRevealGate`.
  - Files: `src/cook/revealGate.ts`, `src/cook/revealGate.test.ts`, `src/cook/revealGate.prop.test.ts`.
  - Satisfies: R15.7, R12.8.

- [x] 23. Announcements
  - Test first: `src/cook/announce.test.ts`: arrival at step 3 of 5 gives "Step 3 of 5. Pareings & seeds in Spring water, strain the Liquor, & weigh your Quinces, with"; arrival at the hero step adds " The writer's note, handwritten: till it Looks red & smooth" built from `span`; a wipe prefixes "Glass wiped. "; a pace change gives "Pace ×12" and "Pace real time"; a restore gives "Resumed at step 5 of 5."; a deep link gives "Started at step 5 of 5."; plain step text turns "†[Cores|cores]" into "Cores (the second reader reads cores)". Strings come from `src/copy/strings.ts` (created here with only these strings).
  - Implement `compose` and the first strings.
  - Files: `src/cook/announce.ts`, `src/cook/announce.test.ts`, `src/copy/strings.ts`.
  - Satisfies: R9.4, R11.3, R23.3, R25.1.

- [x] 24. The cue envelope, brown noise and K6
  - Test first: `src/cook/cue.test.ts` and `src/cook/cue.prop.test.ts` (K6): bounds, endpoints, single minimum, the gain never above `SIMMER_GAIN`; `brownNoise` determinism, range, mean, seam, spectral tilt (energy below 200 Hz above energy above 2 kHz at 44 100 Hz).
  - Implement `cueEnvelope`, `brownNoise` and the constants.
  - Files: `src/cook/cue.ts`, `src/cook/cue.test.ts`, `src/cook/cue.prop.test.ts`.
  - Satisfies: R16.1, R16.2, R16.3, R16.8.

- [x] 25. Audio engine and wake lock
  - Test first: `src/cook/audio.test.ts` with a fake `AudioContext`: before `unlock()` the factory is never called; `unlock()` creates and resumes once, starts the loop at `SIMMER_GAIN`, and a second call does nothing; `setMuted(true)` ramps the gain to 0 within 100 ms of context time and `state` is `muted`; muting before unlock keeps it silent after unlock; `duck()` schedules the envelope and never exceeds `SIMMER_GAIN`; with a factory that returns null, `state` is `unavailable` and nothing throws; hiding the page suspends. The muted flag is stored through the store. `src/cook/wakelock.test.ts`: acquire with a fake `wakeLock.request`; refusal sets `refused` without a second request; `unsupported` without the API; `release` is idempotent; a visibility change re-acquires.
  - Implement `createAudio`, `createWakeLock`.
  - Files: `src/cook/audio.ts`, `src/cook/audio.test.ts`, `src/cook/wakelock.ts`, `src/cook/wakelock.test.ts`.
  - Satisfies: R16.3 to R16.7, R17.1 to R17.5.

- [x] 26. Copy strings and the words guard
  - Test first: `src/copy/strings.test.ts` reads every string literal of `src/copy/` and `src/app/` (a small source scanner in the test) and fails on "she", "her", "hers" outside the product title, "curator", "AI-powered", "Kiro-powered", "generated by", "enhanced", "restored", "chatbot", "assistant", and on any digit other than in "×4" and "×12". A second test fails on `speechSynthesis`, `SpeechSynthesisUtterance` and any `font-family` naming a handwriting face under `src/`. Move the strings of R3, R4, R6, R7, R9, R14, R15, R16, R18, R19, R20 into `src/copy/strings.ts` as they are specified in the requirements.
  - Implement the full `src/copy/strings.ts`.
  - Files: `src/copy/strings.ts`, `src/copy/strings.test.ts`.
  - Satisfies: R25.1, R25.2, R25.3, R25.6, R16.3.

## F. The renderer changes the bundle needs

- [x] 27. Pane metadata from the bundle's note files
  - Test first: change `src/steam/assets.test.ts` to read `public/recipes/quinces-marmalade/note-till-it-looks-red-smooth.json` and expect `shownText` ("till it Looks red & smooth,"), two groups with the bundle's rects, and stripped extra keys (`words`, `alignment`, `trace`). `NoteMeta` rejects a file with `text` and no `shownText`. `loadNoteAssets(stem, {noteId, size})` (new optional check argument) throws `AssetError` when the JSON `noteId` or `size` differs from the bundle's. Point `derive.test.ts` and `hero.coverage.test.ts` at the bundle's hero note, remove their `skipIf(!existsSync(...))` so a missing file fails, and re-pin any number that was pinned to the spike from a fresh run, writing the measured value and the command that produced it in a comment (never loosen a bound to pass).
  - Implement: `NoteMeta.text` → `shownText`, the cross-check, `SteamPane`'s announcement reads `shownText`.
  - Files: `src/steam/assets.ts`, `src/steam/assets.test.ts`, `src/steam/SteamPane.tsx`, `src/steam/derive.test.ts`, `src/steam/hero.coverage.test.ts`.
  - Satisfies: R15.3, R15.9.

- [x] 28. Extract `SteamGlass`
  - Test first: `src/steam/SteamGlass.test.tsx` (happy-dom, `renderToString` where the DOM is not needed): no read of `window.location` (a spy on `location` getters throws); with `params = {t: null, lead: Infinity, fps: false}` on the `StaticPane` path (the renderer needs a GPU, the clock logic does not) the controller reports `fogged` after 3 s of fake time and never starts by itself, and `startReveal()` moves it to `writing`; with `lead: −WRITE_ON_MS` the first state is `holding`; `onReady` fires once. The existing `src/steam/*.test.ts` and the renderer e2e specs stay green with no change of meaning. Add `RevealClock` cases for `Infinity` and negative `lead` to `src/steam/timeline.test.ts` or a new `StaticPane.test.ts`.
  - Implement: move the renderer lifecycle, `StaticPane` choice and load error from `SteamPane.tsx` into `SteamGlass.tsx` with the props of R15.2; `SteamPane` composes `SteamGlass` and keeps its foot. Move `usePrefersReducedMotion` to `src/steam/useReducedMotion.ts`. Parametrise `.steam-root` height with `--glass-h` (default `100dvh`).
  - Files: `src/steam/SteamGlass.tsx`, `src/steam/SteamPane.tsx`, `src/steam/useReducedMotion.ts`, `src/steam/steam.css`, `src/steam/SteamGlass.test.tsx`.
  - Satisfies: R15.1, R15.2, R15.4, R23.1.

- [x] 29. `StaticPane` images per note
  - Test first: `src/steam/StaticPane.test.tsx`: `paneImage(dir, noteId, kind, state)` returns `/recipes/<id>/panes/<noteId>-<kind>-<state>.webp`; the component renders three stacked images for a note; `fogOnly` renders the fogged image only.
  - Implement: `StaticPane` takes `paneDir` and `noteId`; `scripts/render-static-panes.ts` is changed to loop over the catalog's displayable notes and to write `public/recipes/<id>/panes/` (it opens the harness route of task 30, so it is first run in task 31).
  - Files: `src/steam/StaticPane.tsx`, `src/steam/StaticPane.test.tsx`, `scripts/render-static-panes.ts`.
  - Satisfies: R15.10.

## G. The app shell, the harness route and the end of the spike

- [x] 30. App shell, route switch, harness route
  - Test first: `src/app/App.test.tsx` (happy-dom): `#/` renders the shelf's `<h1>`; `#/r/quinces-marmalade` the edition's; `#/r/nope` "This recipe is not on the shelf" with a link to `#/`; `#/zzz` the same screen; `#/pane/quinces-marmalade/till-it-looks-red-smooth` renders `SteamPane` with `stem = /recipes/quinces-marmalade/note-till-it-looks-red-smooth` and reads `t`, `lead`, `fps` from the hash query only; a `hashchange` back to the previous hash restores the previous screen; a route change sets `document.title` and focuses the `<h1>` (not on the cook route); one live region exists in the page. The smoke test of `src/__tests__/smoke.test.tsx` keeps its title assertion (the product title, `sr-only`, stays).
  - Implement `App.tsx`, `useRoute.ts`, `NotFound.tsx`, the shared live region, and the `pane` route. Screens are stubs that render their `<h1>`, filled in by later tasks.
  - Files: `src/App.tsx`, `src/app/useRoute.ts`, `src/app/NotFound.tsx`, `src/app/App.test.tsx`, `src/__tests__/smoke.test.tsx`.
  - Satisfies: R1.1, R1.4, R1.5, R1.6, R15.8, R23.6.

- [x] 31. Migrate the renderer specs and scripts, delete `public/hero/`
  - Test first: `src/steam/nohero.test.ts` fails while `public/hero` exists or while a file under `src/`, `e2e/` or `scripts/` contains `public/hero` or `/hero/` (the test file itself excluded). Run the renderer e2e specs red against the new route to see what breaks.
  - Implement: `e2e/helpers/pane.ts` (`openPane` goes to `/#/pane/quinces-marmalade/till-it-looks-red-smooth` + the query in the hash; `HERO` becomes the bundle folder and `till-it-looks-red-smooth`); `e2e/steam-phone.spec.ts`, `e2e/steam-timing.spec.ts` (`page.goto('/…')` calls and the three `pane-groups-*.webp` URLs); `scripts/render-static-panes.ts`, `scripts/measure-steam.ts`, `scripts/capture-renderer-frames.ts`; `git rm -r public/hero`; remove `HERO_DIR`, `NOTE_STEM`. Re-run `npm run e2e` for the five renderer specs; any number pinned to the spike is re-measured and re-pinned with its source named, never loosened. Then run `npm run static-panes` (task 29's script, now that the route exists) and commit the 18 images. Add `public/recipes/panes.test.ts`: for every displayable note of the catalog the six files exist and are WebP (RIFF/WEBP header) with non-zero size (red before the images are committed).
  - Files: `e2e/helpers/pane.ts`, `e2e/steam-*.spec.ts`, `scripts/*.ts`, `src/steam/StaticPane.tsx`, `src/steam/SteamPane.tsx`, `src/steam/nohero.test.ts`, `public/recipes/panes.test.ts`, `public/recipes/quinces-marmalade/panes/*.webp`, `public/hero/` (deleted).
  - Satisfies: R15.9, R15.10, R27.9.

## H. Shelf and edition view

- [x] 32. `ArchiveSlip`, `ReadingText`, credit line
  - Test first: `src/app/components/ArchiveSlip.test.tsx`: renders institution, shelfmark, page, date "c. 1750 (IIIF manifest)", licence label as a link to the licence `url`, and the credit line "Wellcome Collection, Public Domain Mark" from the real bundle; the DM Mono class and the `--rule` hairline are present (class names asserted); an expanded slip adds work URL, manifest, canvas, image service, retrieved date; the reading line for scribe and second-reader, and for a `["fallback"]` variant with `by` "Test Reader" gives "Read by Test Reader (fallback reading, not by the Kiro readers)"; the disagreement count equals the bundle's `disagreements.length`; the review line is "Reviewed by: Claude Code builder agent (autopilot P1b), not a human, 2026-11-25" read from the bundle; ownership reviewers and `alignmentBy` appear verbatim; the strings "curator", "verified" and "approved" never appear. `ReadingText.test.tsx`: marks render as `†[a|b]` with `role="group"`, the accessible name and the shared description id; an empty reading renders `†[(N.26)|]`.
  - Implement the two components and the credit helper `creditLine(bundle)`.
  - Files: `src/app/components/ArchiveSlip.tsx`, `src/app/components/ReadingText.tsx`, `src/app/components/*.test.tsx`, `src/app/app.css`.
  - Satisfies: R3.1 to R3.9, R6.3, R6.4, R25.5.

- [x] 33. Shelf screen
  - Test first: `src/app/Shelf.test.tsx` (happy-dom, injected loader returning the real bundle read from disk): title, intro line exact, one card with the thumbnail attributes (`loading="lazy"`, width 1601, height 2052, the alt text), title link to `#/r/quinces-marmalade`, slip, buttons "Cook it" and "Watch it at ×12"; no element with text "upload" or "Add a page"; "Cook it" deletes the saved session (fake store) and navigates to `#/r/quinces-marmalade/cook`; "Watch it at ×12" navigates to `…/cook?pace=12`; after leaving, `introSeen` is true and the line is the standing muted one; an empty result shows "No recipe could be loaded."; the opening state shows "Opening the shelf…" in the live region; buttons are at least 48×48 (computed style from the class).
  - Implement `Shelf.tsx`.
  - Files: `src/app/Shelf.tsx`, `src/app/Shelf.test.tsx`, `src/app/app.css`.
  - Satisfies: R4.1 to R4.9, R2.8, R25.5.

- [x] 34. Zoom and pan reducer and K4
  - Test first: `src/app/facsimile.test.ts`: `zoomAt` ×2 at the centre keeps the centre point; zoom out below 1 stays at 1; above `MAX_ZOOM` stays; pan beyond the edge clamps; `resize` re-clamps; `reset`. `src/app/facsimile.prop.test.ts` (K4).
  - Implement `zoomPan` and `MAX_ZOOM` in `src/app/facsimile.ts`.
  - Files: `src/app/facsimile.ts`, `src/app/facsimile.test.ts`, `src/app/facsimile.prop.test.ts`.
  - Satisfies: R5.3, R5.4.

- [x] 35. Facsimile component
  - Test first: `src/app/components/Facsimile.test.tsx` (happy-dom): the image has the text alternative of R5.1 and the credit line; three buttons "Zoom in", "Zoom out", "Reset" of at least 48×48; the keys `+`, `-`, `0` and arrows act when the viewport has focus; Ctrl+wheel zooms and a plain wheel at scale 1 is not prevented; a plain wheel at scale 2 pans; two-pointer pinch zooms; no CSS `filter` on the image.
  - Implement `Facsimile.tsx` with pointer events and the reducer.
  - Files: `src/app/components/Facsimile.tsx`, `src/app/components/Facsimile.test.tsx`, `src/app/app.css`.
  - Satisfies: R5.1, R5.2, R5.6, R23.2.

- [x] 36. Edition view: transcription, gutter, notices
  - Test first: `src/app/Edition.test.tsx` (real bundle): 12 rows with numbers "00" to "11"; row 03 has two marks and row 10 one; the legend and the reading credit are present; the count text equals `disagreements.length`; rows 01, 07 and 09 and 10 carry the judgement glyph (`aria-hidden`) and the text "Judgement note on this line: <span>" (lines from `groups[].line` of the real notes: 1, 7 and 8, 9 and 10); each judgement shows "with its step"; with a variant bundle with a `corrected` line, the merged text shows beneath, labelled "as merged"; with a withheld note (licence variant) the notice "1 note withheld: the source of the note could not be checked." appears and the line stays; a "Cook it" primary button (starts fresh, as the shelf) and the link back; the layout classes switch at 1025 px (computed in a media-query test of the CSS text).
  - Implement `Edition.tsx` with `Facsimile`, the list and the notices.
  - Files: `src/app/Edition.tsx`, `src/app/Edition.test.tsx`, `src/app/app.css`.
  - Satisfies: R5.5, R6.1, R6.2, R6.5, R6.7, R6.8, R7.1, R7.2, R7.5, R7.6.

- [x] 37. Timing stepper and provenance disclosure
  - Test first: `src/app/components/TimingStepper.test.tsx` (fake store): opening from the moment label shows the value, the basis and the buttons ("Earlier", "Later", "Reset to the manuscript's", each at least 48×48); "Later" twice writes 60 s to the store and the label becomes "check from 1 min · set by you"; the live region says "<span>: check from 1 min · set by you"; "Reset" deletes the override and restores "with its step"; range ends clamp; with a non-persistent store "Not saved on this device." shows. `ProvenanceDisclosure` (in `Edition.test.tsx`): the button has `aria-expanded`, toggles the expanded slip; Space and Enter work.
  - Implement `TimingStepper.tsx`, the disclosure, and wire both into `Edition.tsx`.
  - Files: `src/app/components/TimingStepper.tsx`, `src/app/components/TimingStepper.test.tsx`, `src/app/Edition.tsx`, `src/app/Edition.test.tsx`.
  - Satisfies: R7.3, R7.4, R8.2 to R8.6, R18.8, R23.2.

## I. Cook Mode

- [x] 38. The session hook with a fake clock and store
  - Test first: `src/app/useCookSession.test.tsx` (happy-dom, fake timers, fake store, fake `visibilityState`): a plain start dispatches `start`; a `note=` route dispatches `deepLink` at the right step with `leadMs` 10 000 (default) or `lead × 1000`; a valid saved session and no `note` dispatches `restore`; an invalid or stale one starts fresh; an unknown `note` starts at step 0 with the caption of R19.5; the single timer wakes at `min(nextDueWall, now + 250)` and a tick at the due wall time yields the reveal; `visibilitychange` hidden sends `sleep`, visible sends `resume`; after a fake 3-hour freeze and `resume`, exactly one reveal is emitted; every dispatch that changes state writes the snapshot; unmount removes every timer and listener (counters from spies are zero, R26.4).
  - Implement `useCookSession` and `clock.ts`.
  - Files: `src/app/useCookSession.ts`, `src/app/useCookSession.test.tsx`, `src/cook/clock.ts`.
  - Satisfies: R12.7, R18.2, R18.4, R18.5, R19.1, R19.3, R19.5, R26.4, R9.5.

- [x] 39. Step panel and timer
  - Test first: `StepPanel.test.tsx`: shows "Step 4 of 5" and the step text built from `lines[lineIdx[]]` with marks; the text node has the class that sets at least 24 px and, under the 1025 px media rule, at least 34 px (read from the CSS text); the panel has a focusable, labelled scroll region. `CountUpTimer.test.tsx`: the display equals `formatElapsed(elapsedMs(...))` for the fake clock; after a simulated 3-hour freeze the first render shows the full time; the colour class is `--muted` except with a pending reveal due within 10 s of wall time at any pace; `role="timer"` and no live announcement.
  - Implement `StepPanel.tsx`, `CountUpTimer.tsx`.
  - Files: `src/app/components/StepPanel.tsx`, `src/app/components/CountUpTimer.tsx`, `src/app/components/*.test.tsx`, `src/app/cook.css`.
  - Satisfies: R9.2, R9.3, R10.1, R10.4, R10.5, R10.6, R10.7.

- [x] 40. Flame knob and pace badge
  - Test first: `FlameKnob.test.tsx`: `role="slider"`, `aria-valuemin` 0, `aria-valuemax` 2, `aria-valuetext` "Real time", "×4 pace", "×12 pace"; ArrowRight and ArrowLeft (and Up and Down) move between stops and clamp at the ends; click on a stop label sets it; drag snaps to the nearest stop; each target is at least 48×48; a change calls `onPace(pace)` once. `PaceBadge.test.tsx`: absent at pace 1; "×4 pace" and "×12 pace" otherwise, in the DM Mono class, at the top right of the stage (class).
  - Implement `FlameKnob.tsx`, `PaceBadge`.
  - Files: `src/app/components/FlameKnob.tsx`, `src/app/components/PaceBadge.tsx`, `src/app/components/*.test.tsx`, `src/app/cook.css`.
  - Satisfies: R11.1 to R11.4, R11.6, R23.2, R25.4.

- [x] 41. Wipe control and the drag surface
  - Test first: `WipeControl.test.tsx` drives every row of the table with real `controlFor` outputs: label, action, `aria-disabled` while `writing` with the description "The note is being written", no action when disabled, Space on the document acts unless focus is in another button, `preventDefault` on Space, a second activation within 400 ms is ignored, size at least 48×48 (class), the control is not inside the pane element, and it takes focus when `ready` becomes true. `DragSurface.test.tsx`: a pointer path that meets `dragWipe` calls the action once; a tap and a short move do not; the surface has `touch-action: none`.
  - Implement `WipeControl.tsx`, `DragSurface.tsx`.
  - Files: `src/app/components/WipeControl.tsx`, `src/app/components/DragSurface.tsx`, `src/app/components/*.test.tsx`, `src/app/cook.css`.
  - Satisfies: R14.1 to R14.6, R14.9, R14.10, R23.2, R23.4.

- [x] 42. `PaneStage`: pane choice, preparation, gate wiring, outgoing sweep, failed scan
  - Test first: `PaneStage.test.tsx` (fake `SteamGlass` that exposes its controller): the pane's note follows `paneNoteFor`; a reveal effect for a ready pane calls `startReveal()` once and sets `cook:reveal:<id>`; an effect for a pane that is not ready waits; after a wipe the outgoing pane stays until its `wiped` state plus `WIPE_MS`, then crossfades out over 600 ms (opacity only) and at most two panes exist; a restored revealed note creates the pane `initial: 'held'`; a note whose assets throw `AssetError` shows "The scan of this note could not be loaded." and its typed transcription, and the effect is dropped; preparation order: the current note first, the others in idle time, none while any pane is `writing` (spy on `derive`). The prepared cache is kept for the session.
  - Implement `PaneStage.tsx`, `prepare.ts` (`prepare(noteId)` cache).
  - Files: `src/app/components/PaneStage.tsx`, `src/app/components/PaneStage.test.tsx`, `src/steam/prepare.ts`, `src/steam/SteamGlass.tsx` (the optional `prepared` prop).
  - Satisfies: R15.4 to R15.7, R15.11, R15.12, R26.3.

- [x] 43. Cook screen assembly, captions, test hooks
  - Test first: `src/app/Cook.test.tsx` (real bundle, fake clock, fake store, fake `SteamGlass`): the DOM order is stage, caption, "Step n of N", text, timer, knob, controls (Wipe, Back, Mute); the archive slip appears under the pane only while the current step's note is revealed; a step without a note shows no slip; Back links to `#/r/quinces-marmalade` and keeps the snapshot; "Started at step 5 of 5" and "Resumed at step n of N" captions with "Start again"; the one live region receives one composed message per batch; the root carries `data-step`, `data-step-count`, `data-note-state`, `data-pace`, `data-ready`, `data-started-at-step`, `data-revealed`; `cook:ready` is marked once; a full walk through the plan (hand-driven events) goes step 1 to the end, passing every row of the Wipe table, and ends by navigating to `#/r/quinces-marmalade/quoted` and deleting the snapshot; a double activation advances one step.
  - Implement `Cook.tsx` assembling the pieces.
  - Files: `src/app/Cook.tsx`, `src/app/Cook.test.tsx`, `src/app/cook.css`.
  - Satisfies: R9.1, R9.4 to R9.8, R14.7, R14.8, R18.5, R18.6, R19.1, R19.2, R19.8, R15.7.

- [x] 44. The haunting cue: lamp dip, simmer duck, Mute control
  - Test first: `Cook.cue.test.tsx` (fake rAF, fake audio): applying a reveal runs one lamp dip and one `duck()`; a second reveal inside 3 s does not start another; the lamp overlay is a `--bg` layer with `pointer-events: none`; under `prefers-reduced-motion: reduce` the dip still runs, with no transform and no animation other than the single opacity change; with `AudioContext` unavailable the dip still runs and the Mute control is disabled with "This browser has no sound"; the Mute control reads "Unmute" before any gesture, and activating it unlocks the context and plays; it reads "Mute" while playing, `aria-pressed` follows, is at least 48×48, and the choice is stored; the first `pointerdown` anywhere unlocks once.
  - Implement the overlay, `MuteButton.tsx`, the unlock listeners in `App.tsx`, and the effect hook that calls `cueEnvelope`.
  - Files: `src/app/components/MuteButton.tsx`, `src/app/components/LampDip.tsx`, `src/App.tsx`, `src/app/Cook.tsx`, `src/app/Cook.cue.test.tsx`, `src/app/cook.css`.
  - Satisfies: R16.1, R16.2, R16.4 to R16.7, R23.8.

- [x] 45. Wake lock and persistence notices in the screen
  - Test first: `Cook.wake.test.tsx`: on mount with a fake `wakeLock` the root shows `data-wake="held"`; refusal gives `refused` and the screen is unchanged; no API gives `unsupported` and no text; visibility returns re-acquire; leaving the screen releases. With a non-persistent store the muted line "This browser will not keep your place." shows once.
  - Implement the wiring.
  - Files: `src/app/Cook.tsx`, `src/app/Cook.wake.test.tsx`.
  - Satisfies: R17.1 to R17.5, R18.8.

- [x] 46. Deep link behaviour in the screen
  - Test first: `Cook.deeplink.test.tsx` (fake clock): `#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12` starts at step 5 of 5 with the badge "×12 pace" and the caption; with no input a reveal is applied at 10 s (default) after the session start, or earlier when "Show the note" is pressed, after which the scheduled reveal is a no-op; with `lead=3` at 3 s; with a pane that becomes ready at 12 s the reveal applies at 12 s, not before and not twice; an unknown note id starts at step 1 with the caption of R19.5; no audio context is created before a gesture.
  - Implement what the tests find missing.
  - Files: `src/app/Cook.tsx`, `src/app/useCookSession.ts`, `src/app/Cook.deeplink.test.tsx`.
  - Satisfies: R19.1 to R19.8, R12.9.

## J. "The hand, quoted"

- [x] 47. Quoted screen
  - Test first: `src/app/Quoted.test.tsx` (real bundle): the `<h1>` "The hand, quoted"; three rows in step order (steps 1, 4, 5); each row has the note PNG `<img>` with alt "The writer's note, handwritten: <span>" on a `--paper` mat, the transcription with marks, "Step n", the slip, and the link; the hero link `href` equals `regionUrl` computed by the test's own copy of the arithmetic from the bundle, and is `…/b18419665_MS_1810_0033.JP2/641,3660,2897,511/full/0/default.jpg` (the integers recomputed, not pasted); `target="_blank"`, `rel="noopener noreferrer"`, the accessible name of R20.5; the approximate-region line shows because `verifyApproximate` is true; the credit line is last in the list and reads "Wellcome Collection, Public Domain Mark"; "Cook again" deletes the session and navigates to `…/cook`; no upload action; with a variant bundle with a withheld note the list has two rows; the screen opens with no session. P8.6 of the property file (task 7) is completed here: the plan, the edition's judgement marks and the quoted rows list the same ids.
  - Implement `Quoted.tsx`.
  - Files: `src/app/Quoted.tsx`, `src/app/Quoted.test.tsx`, `src/data/provenance.prop.test.ts`, `src/app/app.css`.
  - Satisfies: R20.1 to R20.9, R22.3, R3.3, R25.5.

## K. Responsive, contrast, built-site checks

- [x] 48. Responsive CSS and contrast
  - Test first: `src/app/tokens.test.ts` computes contrast from the values in `src/index.css`: `--ink` on `--bg` and `--muted` on `--bg` at least 4.5:1, `--after` on `--bg` at least 3:1, `--ghost` focus ring against `--bg` at least 3:1. `src/app/css.test.ts` reads `app.css` and `cook.css` and asserts: no hex colour literal (every colour is a custom property), the step-size custom property is 24px up to 1024px and 34px from 1025px, the timer 44px and 64px, the title 34px and 56px, the transcription 17px and 20px, the slip 11px and 12px, `:focus-visible` outline of 2px in `--ghost`, `touch-action: none` on the drag surface, no fixed pixel `width` on a screen container, and the three font families only.
  - Implement the CSS for the shelf, edition and cook screens at the three breakpoints (phone ≤ 480, tablet 481 to 1024, desktop ≥ 1025), with `--glass-h` 55dvh on phone and the 60% stage (max 1100px) on desktop.
  - Files: `src/app/app.css`, `src/app/cook.css`, `src/app/tokens.test.ts`, `src/app/css.test.ts`.
  - Satisfies: R9.3, R10.1, R23.4, R23.5, R24.1, R24.2, R24.4, R24.5.

- [ ] 49. Built-site checks
  - Test first: `scripts/check-dist.test.ts` (runs after `npm run build`; in the unit run it is skipped with a printed reason when `dist/` is absent, and CI runs it after the build step): no `speechSynthesis` in `dist/`; no file in `dist/` that is a server entry (only `index.html`, `assets/`, `recipes/`, `favicon.svg`); `dist/recipes/quinces-marmalade/panes/` holds the 18 images; `dist/hero` is absent. A source test (`src/app/hosts.test.ts`) lists every `https://` host named in non-test files of `src/` and expects an empty list, because every archive and licence host comes from bundle data.
  - Implement: nothing new.
  - Files: `scripts/check-dist.test.ts`, `src/app/hosts.test.ts`, `package.json` (`"check:dist"`).
  - Satisfies: R2.6, R15.10, R25.6, R26.1.

## L. End to end

- [ ] 50. E2E helpers and the main flow
  - Test first: `e2e/helpers/cook.ts` (`openShelf`, `markTime`, `liveText`, `regionUrlFor(noteId)` with its own arithmetic, `axe(page)`), and the main case of `e2e/cook-flow.spec.ts` (R27.1): shelf (slip, both buttons, no upload card) → edition (marker count read from the bundle, each with the description; three "with its step" labels; "Read the provenance" expands to show the review line verbatim) → the deep link → `cook:ready` → with no input, `cook:reveal:till-it-looks-red-smooth` no later than 10 s after `cook:ready` (the measured value is written to the test log with `console.log`) → the live region text → "Wipe the glass" after the write-on → press → "The hand, quoted" → press → quoted screen: three rows, the hero link equals `regionUrlFor`, shape `…/{x},{y},{w},{h}/full/0/default.jpg` with four integers, last line "Wellcome Collection, Public Domain Mark" → "Cook again" opens step 1. Axe rules of R23.7 run on each screen. Every network request of the whole flow is recorded with `page.on('request')` and the test fails on any origin other than the app's.
  - Implement what the run finds missing.
  - Files: `e2e/helpers/cook.ts`, `e2e/cook-flow.spec.ts`.
  - Satisfies: R27.1, R19.4, R23.7, R21.4, R2.6.

- [ ] 51. E2E: the ×12 walk and the Wipe table
  - Test first: in `e2e/cook-flow.spec.ts`: from the shelf, "Watch it at ×12"; the badge "×12 pace" is visible from the first frame to the quoted screen; step 1 arrives with its note (label "Show the note" or the wipe label once the reveal has applied: assert the row by `data-note-state`), then each of: "Wipe the glass" (steps 1 and 4), "Next step" (steps 2 and 3, with a fogged pane: no ink pixel of any note on the canvas, measured with the helper of `e2e/helpers/pane.ts`), "The hand, quoted" (step 5). The Wipe control is at least 48×48. Pressing "Show the note" at a pending note starts the write-on at once. A drag across the pane at a held note advances.
  - Implement what the run finds missing.
  - Files: `e2e/cook-flow.spec.ts`.
  - Satisfies: R27.2, R14.1 to R14.5, R11.4, R15.5.

- [ ] 52. E2E: reduced motion and keyboard only
  - Test first: `e2e/cook-a11y.spec.ts`: with `emulateMedia({reducedMotion: 'reduce'})`: no `canvas` in Cook Mode, the held image's computed `transition-duration` is 0.6 s with opacity as the only property, the same live-region text, the lamp overlay present and animating once. Keyboard only (no pointer calls): Tab and Enter from the shelf to the edition, Tab to "Cook it", Enter; in Cook Mode the Wipe control has focus, ←/→ on the knob changes the pace (the badge appears), Space and Enter advance through to "The hand, quoted"; every focused element shows an outline of 2 px or more in the `--ghost` colour (computed style).
  - Implement what the run finds missing.
  - Files: `e2e/cook-a11y.spec.ts`.
  - Satisfies: R27.3, R27.4, R23.1, R23.2, R23.4, R16.2.

- [ ] 53. E2E: sleep, restore, phone, bad bundles
  - Test first: `e2e/cook-session.spec.ts`: (a) sleep with `page.clock`: write a 60 s device override on `when-tender` through IndexedDB, start a session at step 4 through the shelf, fast-forward 10 minutes and fire `visibilitychange`: exactly one `cook:reveal:when-tender` mark and a timer reading of at least 10:00; (b) restore: reload at step 4 with the note held: step, pace and `data-note-state="held"` are restored with no second `cook:write-on` mark; "Cook it" from the shelf starts at step 1; (c) phone 390×844: the shelf's first card above the fold, Cook Mode with no horizontal scroll, Wipe at least 48×48, the step text at least 24 px (computed); (d) with `page.route` serving an invalid `recipe.json`, the shelf shows no card and a note with `cc-by-nc` is withheld (the step has no note, the edition notice shows).
  - Implement what the run finds missing.
  - Files: `e2e/cook-session.spec.ts`.
  - Satisfies: R27.5 to R27.8, R12.7, R18.3 to R18.7, R24.3, R2.3, R2.4, R22.4.

- [ ] 54. E2E in CI and the renderer specs
  - Test first: `.github/workflows/ci.yml` runs `npx playwright install --with-deps chromium` and `npm run e2e` after `npm run build`, and `npm run check:dist`; first run it red to see that the job fails when a spec fails (a deliberately wrong expectation, then removed).
  - Implement: the CI steps. The five renderer specs and the cook specs all pass in one `npm run e2e` run.
  - Files: `.github/workflows/ci.yml`.
  - Satisfies: R27.9, R2.6.

## M. Measurement and close

- [ ] 55. Cook Mode performance script
  - Test first: `scripts/measure-cook.test.ts` checks the script's pure part: the frame-interval statistics (mean fps, minimum fps, worst frame, count over 18.2 ms) on fixed arrays, and the shape of `bench/cook.json` with zod.
  - Implement `scripts/measure-cook.ts` (Playwright and CDP): for desktop 1280×720 and a Pixel 5 profile with `Emulation.setCPUThrottlingRate(4)`, load `#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=3&fps=1`, record every `requestAnimationFrame` interval over the lead-in, the write-on and the hold (15 s), and the times from navigation to `cook:ready` and to `cook:reveal:till-it-looks-red-smooth`; write `bench/cook.json`. The script exits non-zero when the budget fails but writes the file first. Run it, commit the file as measured, and add a row to `bench/README.md`. Whatever the numbers are is what is reported; a failing profile is not hidden or retuned here.
  - Files: `scripts/measure-cook.ts`, `scripts/measure-cook.test.ts`, `bench/cook.json`, `bench/README.md`, `package.json` (`"bench:cook"`).
  - Satisfies: R26.2, R26.3.

- [ ] 56. Final verification
  - Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run props`, `npm run build`, `npm run check:dist`, `npm run e2e`. Confirm: `content/catalog.json` was written only by `npm run catalog`; `gateSha256` of quinces is still `eb3fabc0…df10d`; `public/hero` is gone; the words guard (task 26) and the no-imitation hook pass on `src/`; every requirement R1 to R27 appears in at least one task above and one test; the number of properties green (P7, P8, K1 to K9); report the measured `bench/cook.json` values and the time-to-reveal numbers from the e2e log as measured, with any miss named.
  - Files: none (reads only), plus a result note appended under this task.
  - Satisfies: R25.1, R25.6, R26.1, R27.9.
