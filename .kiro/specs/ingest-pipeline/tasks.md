# Tasks: ingest-pipeline

Order follows dependencies: scaffolding, pure stages bottom-up, the gate, the CLI, then measurement. Every task writes its test first, watches it fail, then implements. Requirement numbers refer to `requirements.md` (R12.3 = requirement 12, criterion 3). Tests sit beside code as `*.test.ts`; property tests as `*.prop.test.ts` with fast-check, in `src/**/` (the one gate-level property test is under `tools/`, per `design.md` S7). Commits that change product code carry `[kiro]`. No task uses French Bread (R39.3).

- [x] 1. Scaffolding and dependencies
  - Test first: `src/ingest/purity.test.ts` fails when a non-test file in `src/ingest/` imports `node:*` or names `window`, `document`, `process`, `Buffer`, `fetch`. Add `src/ingest/smoke.test.ts` importing `constants.ts`.
  - Implement: `npm i jpeg-js`, `npm i -D tsx`; add `tools/**/*.test.ts` to `vitest.config.ts`; add `tools` to `tsconfig.node.json` includes; create `src/ingest/constants.ts` with the table in design §4 (value, reason, source) and a test that `SPLIT_SHARE_MAX === 0.02`, `RUN_MIN_PX === 4`, `RUN_RATIO === 1.5`, `CONTRAST_MIN === 40`, `PATH_COVERAGE_MIN === 0.95`, `MIN_COMPONENT_PX === 30`.
  - Files: `package.json`, `vitest.config.ts`, `tsconfig.node.json`, `src/ingest/constants.ts`, `src/ingest/purity.test.ts`.
  - Satisfies: R1.4, R38.1, R39.5, R40.2.

- [x] 2. Pure SHA-256
  - Test first: fixed vectors (empty, "abc", 1 000 000 × "a") and `sha256.prop.test.ts` (S1): for all byte arrays up to 4 KB, equals `node:crypto` (test files may import it).
  - Implement `src/ingest/sha256.ts` (`sha256Hex(bytes)`).
  - Files: `src/ingest/sha256.ts`, `src/ingest/sha256.test.ts`, `src/ingest/sha256.prop.test.ts`.
  - Satisfies: R1.5, R2.6.

- [x] 3. Image primitives
  - Test first: `toGray` formula on known pixels; `crop`; `resampleArea` (downscale 2× of a constant is constant; of a checker is mid-gray); `scaleOf`; `pixelSha256` ignores PNG encoding but changes with any pixel; `rotate` by 0° is identity.
  - Implement `src/ingest/image.ts` (`Gray`, `Rgba`, `toGray`, `crop`, `resampleArea`, `rotate`, `scaleOf`, `pixelSha256`).
  - Files: `src/ingest/image.ts`, `src/ingest/image.test.ts`.
  - Satisfies: R1.1, R2.1, R2.4, R2.5, R2.6, R7.3.

- [x] 4. Binarisation
  - Test first: uniform image has no ink; a dark stroke on a left-to-right gradient is found at both ends; adding a constant to every pixel leaves the ink unchanged; border windows are clipped; `rawInk` is a superset of `inkMap`.
  - Implement `src/ingest/threshold.ts` with integral images (`sauvola`, `inkMap`, `rawInk`).
  - Files: `src/ingest/threshold.ts`, `src/ingest/threshold.test.ts`.
  - Satisfies: R6.1, R6.2, R6.3, R6.5.

- [x] 5. Connected components
  - Test first: 8-connectivity (diagonal touch joins), ids equal `y·width + x` of the first raster pixel, ids stable under a different scan order of the implementation, sizes sum to the ink count. Property: for random binary images, every ink pixel has one component id and component count equals a reference flood fill.
  - Implement `src/ingest/components.ts` (union-find with path halving).
  - Files: `src/ingest/components.ts`, `src/ingest/components.test.ts`.
  - Satisfies: R10.1, R6.4.

- [x] 6. Zod schemas, part 1 (source, lines, readers, review, alignment)
  - Test first: `src/data/schema.test.ts` accepts valid examples and rejects: a reader with `box`, `bbox`, `x` or `y`; `uncertain` tokens containing `|` or `]`; a `decision` with neither key or both; `Review` with empty `reviewedBy`; `Alignment` with a coordinate instead of an index.
  - Implement the schemas in `src/data/schema.ts`: `SegmentRun`, `Frame`, `Source`, `Line`, `Lines`, `Reading`, `Scribe`, `Fallback`, `OwnershipReview`, `Alignment`, `Review`, `Timing`, `CheckAt`.
  - Files: `src/data/schema.ts`, `src/data/schema.test.ts`.
  - Satisfies: R4.2, R9.4, R13.1, R14.1, R14.7, R19.3, R35.3, R36.1.

- [x] 7. Licence resolution
  - Test first: `resolveLicence(fixtureWork)` → `pdm`; mutated copies refuse: `in-copyright`, location removed, `license` removed, two locations with different ids, wrong `locationType`, a top-level `license` present but no location (must still refuse).
  - Implement `src/ingest/licence.ts`.
  - Files: `src/ingest/licence.ts`, `src/ingest/licence.test.ts`.
  - Satisfies: R3.1, R3.2, R3.3, R3.4, R3.5.

- [x] 8. Row projection and line finding
  - Test first: synthetic pages with N rows of random strokes at known pitch give N lines with peaks within 3 rows of the truth; core band = rows ≥ 60% of the peak; valley row is the minimum between neighbours (lowest index on a tie); cores never overlap; `lines.prop.test.ts` (S3) for random N, pitch, row thickness.
  - Implement `rowProfile`, `findLines` in `src/ingest/lines.ts`.
  - Files: `src/ingest/lines.ts`, `src/ingest/lines.test.ts`, `src/ingest/lines.prop.test.ts`.
  - Satisfies: R8.1 to R8.6.

- [x] 9. Deskew
  - Test first: synthetic ruled text rotated by −4, −1, 0, 0.3, 0.7, 3° gives estimates within 0.2°; angles under 0.5° are recorded but not applied; applied rotation straightens the page (line count recovered); `deskew.prop.test.ts` (S2).
  - Implement `src/ingest/deskew.ts` (`estimateTilt`, `applyDeskew`).
  - Files: `src/ingest/deskew.ts`, `src/ingest/deskew.test.ts`, `src/ingest/deskew.prop.test.ts`.
  - Satisfies: R7.1 to R7.5.

- [x] 10. Separators, blocks, region and marginalia
  - Test first: synthetic pages with a full-width separator rule between two groups of lines give two blocks and select the larger; a rule joined to the last line's letters is still found by the row-sum test; a margin component separated by a gap ≥ P/2 becomes marginalia and is not in any line extent; `--block 0` selects the first block and records `selectedBy: "curator"`; the region rows extend by P/2 and clip at the rule; ink outside the region is counted, not owned. No coordinates are accepted anywhere.
  - Implement `findSeparators`, `findBlocks`, `chooseRegion`, `findMarginalia` in `src/ingest/lines.ts`.
  - Files: `src/ingest/lines.ts`, `src/ingest/region.test.ts`.
  - Satisfies: R5.1 to R5.5, R5.7, R9.4.

- [x] 11. Slant estimate and shear
  - Test first: synthetic strokes leaning right by 0.2, 0.4 and left by 0.2 give the correct sign and size within one step; vertical strokes give `s < 0.05` → 0 reported as vertical; `shear(x, y, yMid, s)` round trip.
  - Implement `src/ingest/slant.ts` (`estimateSlant`, `shear`).
  - Files: `src/ingest/slant.ts`, `src/ingest/slant.test.ts`.
  - Satisfies: R22.4, R18.2.

- [x] 12. Ownership
  - Test first: component in one band stays whole even across a valley row; component in two bands splits at the valley row (pixels `y < v` up, `y ≥ v` down); three bands split at both valleys; no-band component and sub-30 px components go to the nearest band by centroid (tie to the upper line, no discount); every ink pixel has one owner. Then `masks.prop.test.ts` (P3 a to d, f).
  - Implement `ownership(...)` in `src/ingest/masks.ts`, returning the owner map, the component table and the split log.
  - Files: `src/ingest/masks.ts`, `src/ingest/masks.test.ts`, `src/ingest/masks.prop.test.ts`.
  - Satisfies: R10.2 to R10.6, R11.1, R26.2.

- [x] 13. Split share and the frozen threshold
  - Test first: share = split pixels / mask pixels on hand-built cases; a mask at exactly 0.02 passes and at 0.02 + one pixel fails with "joined strokes: needs review"; flagged list = split components contributing mask pixels; a test fails if the threshold constant changes. Extend `masks.prop.test.ts` (P3 e).
  - Implement `splitShare`, `flagComponents`, `checkP3` (in `props.ts` skeleton).
  - Files: `src/ingest/masks.ts`, `src/ingest/props.ts`, `src/ingest/props.test.ts`.
  - Satisfies: R12.1 to R12.5, R26.1, R26.3.

- [x] 14. Ownership review
  - Test first: `assignToLine` accepted only for a touched line; `splitAtRow` only inside the interval between the touched bands; a stale `segmentRun` is ignored and the note fails "stale ownership review"; a decision changes only its own component; a reviewed note passes with status `reviewed`, detail "reviewed (n components, by <reviewer>)", and `autoPass` excludes it.
  - Implement `applyReview` in `src/ingest/masks.ts`.
  - Files: `src/ingest/masks.ts`, `src/ingest/review.test.ts`.
  - Satisfies: R13.1 to R13.7, R26.2.

- [x] 15. Ownership artifacts
  - Test first: `splits.json` entries hold id, rows, valley rows, lines, pixels; the overlay has the page size; a flag crop is written per flagged component.
  - Implement `renderOverlay`, `renderFlagCrop` (pure RGBA arrays) in `src/ingest/masks.ts`.
  - Files: `src/ingest/masks.ts`, `src/ingest/overlay.test.ts`.
  - Satisfies: R11.1 to R11.4.

- [x] 16. Zero-ink runs
  - Test first: runs of ≥ 4 empty columns inside the ink extent only (leading and trailing space excluded); sheared projection finds a gap that a vertical projection loses (synthetic slanted words); widths and left-to-right indices.
  - Implement `src/ingest/runs.ts`.
  - Files: `src/ingest/runs.ts`, `src/ingest/runs.test.ts`.
  - Satisfies: R18.2, R18.3, R19.2.

- [x] 17. Automatic alignment
  - Test first: k words with k−1 clear gaps are accepted; fewer than k−1 runs, a tie at the cut, and a (k−1)-th run under 1.5× the median of the rest are "alignment ambiguous" with the three numbers; empty unselected set uses 4 px. `align.prop.test.ts` (S5): no 8-connected piece spans two words for `|s| ≤ 1`; accepted alignments satisfy the 1.5× rule.
  - Implement `alignAuto`, `assignWords` in `src/ingest/align.ts`.
  - Files: `src/ingest/align.ts`, `src/ingest/align.test.ts`, `src/ingest/align.prop.test.ts`.
  - Satisfies: R18.1 to R18.6.

- [x] 18. Alignment fallbacks
  - Test first: curator indices select code-found runs; a wrong count, a duplicate or an out-of-range index is rejected; no `alignment.json` → whole lines with `granularity: "lines"` and `shownText` = whole lines; the note's alignment is the weakest used; the file is hashed.
  - Implement `alignCurator`, `alignLines` in `src/ingest/align.ts`.
  - Files: `src/ingest/align.ts`, `src/ingest/align.fallback.test.ts`.
  - Satisfies: R19.1 to R19.7.

- [x] 19. Merge and `transcription.md`
  - Test first: equal counts → token-wise disagreements `{line, word, a, b}`; unequal counts → LCS regions with `countMismatch`; marker form `†[a|b]`; strict header and `L<ii>:` lines; padding past 99 lines; `parse(format(x))` round trip. `merge.prop.test.ts` (S4): for random readings no disagreement disappears and the round trip holds. A reader token containing `|` or `]` is rejected.
  - Implement `src/ingest/merge.ts` (`tokenise`, `diffLine`, `mergeReadings`, `formatTranscription`, `parseTranscription`).
  - Files: `src/ingest/merge.ts`, `src/ingest/merge.test.ts`, `src/ingest/merge.prop.test.ts`.
  - Satisfies: R15.1 to R15.6, R15.8.

- [x] 20. Corrections
  - Test first: a revised line yields `{line, before, after}`; the corrected text is used from then on; a changed index set, count or a stray non-comment line fails "line structure changed"; a header with another `segmentRun` or reader hash is "stale transcription.md"; a correction that changes the token count of a quoted line fails; the disagreement entry stays with `correctedTo`.
  - Implement `applyCorrections` in `src/ingest/merge.ts`.
  - Files: `src/ingest/merge.ts`, `src/ingest/corrections.test.ts`.
  - Satisfies: R16.1 to R16.6, R15.6.

- [x] 21. Steps and notes validation
  - Test first: steps numbered 1..m with consecutive ascending `lineIdx`; step text equals the primary text joined; note quote rules (step membership, bounds, multi-line parts); `span` verbatim; the trailing punctuation of the last word may be left off (the hero span "till it Looks red & smooth" passes, amended in task 42 per addendum 2c); a quote starting inside a multi-token disagreement is "quote splits a disagreement". `notes.prop.test.ts` (S6): any one-character edit of a valid span is rejected.
  - Implement `src/ingest/notes.ts` (`primaryText`, `scribeToSlot`, `checkSteps`, `checkNotes`).
  - Files: `src/ingest/notes.ts`, `src/ingest/notes.test.ts`, `src/ingest/notes.prop.test.ts`.
  - Satisfies: R17.1 to R17.7.

- [x] 22. Skeleton and trace
  - Test first: Zhang-Suen on a bar, a ring, a cross and a dot (known skeleton sizes, one-pixel-wide result, connectivity kept); path sorted by `(group, x', y)`; times `(offset + x' − lo)/W`; nearest-skeleton transform equals brute force on random inputs; skeleton-free piece takes its centroid time.
  - Implement `zhangSuen`, `tracePath`, `timeMap` in `src/ingest/timeofink.ts`.
  - Files: `src/ingest/timeofink.ts`, `src/ingest/timeofink.test.ts`.
  - Satisfies: R22.1, R22.2, R22.3, R22.5.

- [x] 23. Time-of-ink properties
  - Test first: `timeofink.prop.test.ts` (P6 a to f), including the mirror symmetry check that fails if the shear sign is wrong.
  - Implement `checkP6` in `src/ingest/props.ts`.
  - Files: `src/ingest/props.ts`, `src/ingest/timeofink.prop.test.ts`.
  - Satisfies: R22.2, R22.6, R29.1 to R29.3.

- [x] 24. Note build: mask, shell, alpha, crop
  - Test first: mask = owned pixels of quoted lines inside the word regions; shell excludes pixels within 1 px of other lines' ink; alpha from the paper estimate; RGB under alpha 0 is the paper value; RGB under alpha > 0 equals the scan; margin 32 px clipped at the page; `pageBox` computed by code.
  - Implement `buildNote` in `src/ingest/timeofink.ts` (arrays for `note.png`, `toi.png`, `NoteJson`).
  - Files: `src/ingest/timeofink.ts`, `src/ingest/note.test.ts`.
  - Satisfies: R21.1 to R21.6, R23.1, R23.2.

- [x] 25. Verify link
  - Test first: `verifyUrl` for the hero `pageBox` in the fixture frame gives `pct:x,y,w,h` with 4 decimals; the same link results from a 1600 px and a 3200 px download of the same page; `approximate: true` when deskew is applied.
  - Implement `verifyUrl` in `src/ingest/bundle.ts`.
  - Files: `src/ingest/bundle.ts`, `src/ingest/verify-url.test.ts`.
  - Satisfies: R23.3, R23.4.

- [x] 26. P1 and P2
  - Test first: `steps.prop.test.ts` (P1) and `bounds.prop.test.ts` (P2) with the generators in design §5.
  - Implement `checkP1`, `checkP2` in `src/ingest/props.ts`, with `PROPS_VERSION = "1"`.
  - Files: `src/ingest/props.ts`, `src/ingest/steps.prop.test.ts`, `src/ingest/bounds.prop.test.ts`.
  - Satisfies: R24.1 to R24.3, R25.1 to R25.3, R30.8.

- [x] 27. P3 evaluator integration
  - Test first: `checkP3` over a real owner map, flagged lists, reviewed status; detail strings equal the requirement text.
  - Implement the remaining `checkP3` glue.
  - Files: `src/ingest/props.ts`, `src/ingest/props.test.ts`.
  - Satisfies: R26.1 to R26.3, R13.4.

- [x] 28. P4: fidelity, recall and the p0c replay
  - Test first: `fidelity.prop.test.ts` (P4 a to c); `fidelity.test.ts` replays each box of `fixtures/p0c-eyeread-boxes.json` as a note mask over `fixtures/p0033.jpg` ink and expects `checkP4` to fail for the boxes that overlap a neighbouring line; `scoreAgainstFixture` on a synthetic mask gives per-word recall and precision; `recallThreshold` is read from the fixture; fixture boxes are never used to cut pixels.
  - Implement `checkP4`, `scoreAgainstFixture` in `src/ingest/props.ts` and `src/ingest/align.ts`.
  - Files: `src/ingest/props.ts`, `src/ingest/align.ts`, `src/ingest/fidelity.prop.test.ts`, `src/ingest/fidelity.test.ts`.
  - Satisfies: R20.1 to R20.5, R27.1 to R27.5, R39.4.

- [x] 29. P5
  - Test first: `contrast.prop.test.ts` (P5), including "no background" and the exclusion ring.
  - Implement `checkP5`.
  - Files: `src/ingest/props.ts`, `src/ingest/contrast.prop.test.ts`.
  - Satisfies: R28.1 to R28.3.

- [x] 30. Zod schemas, part 2 (gate, merged, note, bundle, catalog)
  - Test first: `Gate` accepts a waiting and a pass example; rejects `pass: true` with a failing `P*`; `RecipeBundle` rejects a note without `provenance` or `checkAt`; `CheckAt` rejects negative seconds; `NoteJson` rejects an unknown key.
  - Implement `Gate`, `Merged`, `NoteJson`, `RecipeBundle`, `Catalog`.
  - Files: `src/data/schema.ts`, `src/data/schema.test.ts`.
  - Satisfies: R23.5, R30.2, R37.1, R37.2, R35.4.

- [x] 31. `runGate`
  - Test first: with synthetic bytes, `runGate` returns `waiting` for a missing or stale reader, `fail` for an invalid reader line count, wrong `titleLine`, a bad span, an over-threshold note without review, and `pass` for a clean synthetic recipe; `goldCheck` is informational only; disagreements are retained; output is deterministic.
  - Implement `src/ingest/gate.ts` (pure orchestrator over `ctx` bytes).
  - Files: `src/ingest/gate.ts`, `src/ingest/gate.test.ts`.
  - Satisfies: R14.2 to R14.6, R30.1, R30.2, R30.6, R30.7, R31.1, R31.2, R31.4, R31.5.

- [x] 32. Check times and bundle
  - Test first: default `checkAt` is `step-entry`, `seconds` 0, with the stated basis; `timing.json` with a basis that is not a substring of the step text is refused; `cook` is never written; the generated JSON never contains "she" or "her".
  - Implement `buildRecipeBundle`, `checkAt` in `src/ingest/bundle.ts`.
  - Files: `src/ingest/bundle.ts`, `src/ingest/bundle.test.ts`.
  - Satisfies: R36.1 to R36.5, R37.1 to R37.4.

- [x] 33. CLI io
  - Test first: canonical JSON writer (sorted keys, trailing newline, stable bytes); JPEG decode of `fixtures/p0033.jpg` is 1601×2052 and stable (hash recorded in the test); PNG round trip keeps `pixelSha256`; frame resampling when sizes differ.
  - Implement `tools/steam-ingest/io.ts`.
  - Files: `tools/steam-ingest/io.ts`, `tools/steam-ingest/io.test.ts`.
  - Satisfies: R2.2, R2.3, R2.4, R9.5.

- [x] 34. `hooks.log`
  - Test first: appends exactly one line in the stated format with U+00B7; `$STEAM_WHO`, `--who`, `cli`, `watch` precedence; creates the folder; never truncates; an append failure throws.
  - Implement `tools/steam-ingest/hookslog.ts`.
  - Files: `tools/steam-ingest/hookslog.ts`, `tools/steam-ingest/hookslog.test.ts`.
  - Satisfies: R33.1 to R33.5.

- [x] 35. `fetch` subcommand
  - Test first: with an injected `get` serving the recorded catalogue response: licence refusal writes nothing; success writes `page.jpg` and `source.json` with every field from its source; `--from-fixture` uses the fixture and no network; a request to any canvas other than index 32 (image `_0033.JP2`, corrected in task 42) fails the test; failures leave existing files untouched.
  - Implement `tools/steam-ingest/fetch.ts`.
  - Files: `tools/steam-ingest/fetch.ts`, `tools/steam-ingest/fetch.test.ts`.
  - Satisfies: R3.1 to R3.5, R4.1 to R4.6, R40.1.

- [x] 36. `segment` subcommand
  - Test first: run on `fixtures/p0033.jpg`; assert only structural facts (files exist, schema valid, region inside the page, canonical JSON, second run is byte-identical, `segmentRun` stable); write the measured line count, block count, marginalia count, deskew angle, slant, split count and hero split share to `docs/kiro-evidence/ingest/measurements.json`; print the region (R5.7). If the measured line count is not the 12 the design predicts, record it and stop to review before any parameter is touched.
  - Implement `tools/steam-ingest/segment.ts`; write `lines.json`, `region.json`, `runs.json`, `strips/`, `ownership/`.
  - Files: `tools/steam-ingest/segment.ts`, `tools/steam-ingest/segment.test.ts`, `docs/kiro-evidence/ingest/measurements.json`.
  - Satisfies: R5.7, R9.1 to R9.7, R11.1 to R11.4, R40.3.

- [x] 37. `merge` and `fallback` subcommands
  - Test first: `merge` writes `transcription.md` only when absent and says whether an existing file equals the fresh merge; `fallback` maps gold lines to lines (title offset), refuses a count mismatch, writes `readers: ["fallback"]` with `by` and the source hash, never touches `agent/*`.
  - Implement `tools/steam-ingest/merge.ts`, `tools/steam-ingest/fallback.ts`.
  - Files: `tools/steam-ingest/merge.ts`, `tools/steam-ingest/fallback.ts`, `tools/steam-ingest/merge.test.ts`, `tools/steam-ingest/fallback.test.ts`.
  - Satisfies: R15.7, R34.1 to R34.6.

- [x] 38. `gate` subcommand
  - Test first: end-to-end with a synthetic recipe folder and with the hero fixtures; the three hero paths (R40.4): `fail` (split share over 2%, no review) with exit 1, `reviewed` (fixture `ownership-review.json`) with the reviewed detail, `waiting` (missing and stale readers) with exit 3; written PNGs are decoded again and P4 to P6 run on them; a hand-edited PNG is caught; second run is a no-op (`gate.json` bytes and `at` unchanged); `gate.prop.test.ts` (S7).
  - Implement `tools/steam-ingest/gate.ts` (read, run, write, re-read, log).
  - Files: `tools/steam-ingest/gate.ts`, `tools/steam-ingest/gate.test.ts`, `tools/steam-ingest/gate.prop.test.ts`.
  - Satisfies: R30.1 to R30.5, R31.3, R33.1, R40.4.

- [x] 39. `--once` watch protocol
  - Test first: stdin `{cursor:null, config:{recipe}, workspacePath}` with no reader files → exactly one JSON line `{outcome:"idle", cursor:{…}}` with logs only on stderr; with both readers and a passing recipe → `terminal-state`, payload a string, exit 0; with a failing recipe → `terminal-state`, `{"pass":false,"failing":[…]}`, exit 0; invalid reader file → idle first, `fail` on the repeat of the same hash; bad stdin, bad recipe id or missing folder → exit 2; a thrown error → exit 1. Validate every output against a zod schema of the watch result; a stray `console.log` in the module fails the test.
  - Implement `tools/steam-ingest/watch.ts`.
  - Files: `tools/steam-ingest/watch.ts`, `tools/steam-ingest/watch.test.ts`.
  - Satisfies: R32.1 to R32.7, R14.6.

- [x] 40. `gate --all --verify` and npm scripts
  - Test first: `--verify` writes nothing, exits non-zero for a recipe whose committed `gate.json` differs, fails or waits, and zero when all match.
  - Implement `--all`/`--verify`, usage messages, and the npm scripts `ingest:gate`, `props`, `catalog`; add `npm run props` after `npm test` in `.github/workflows/ci.yml`.
  - Files: `tools/steam-ingest/cli.ts`, `tools/steam-ingest/gate.ts`, `package.json`, `.github/workflows/ci.yml`.
  - Satisfies: R38.1 to R38.5.

- [x] 41. `catalog` subcommand
  - Test first: refuses a recipe with a failing, stale, or hash-mismatched `gate.json`; refuses an agent-transcribed recipe without `review.json`, with an empty `reviewedBy`, or whose `gateSha256` is not the current gate's; accepts the fallback recipe without a review; writes `content/catalog.json` sorted and `recipe.json`; copies the public bundle; removes stale public files of a refused recipe; verifies everything before writing anything; a source-scan test finds no other writer of `content/catalog.json`.
  - Implement `tools/steam-ingest/catalog.ts`.
  - Files: `tools/steam-ingest/catalog.ts`, `tools/steam-ingest/catalog.test.ts`.
  - Satisfies: R35.1 to R35.6, R36.3, R37.1.

- [x] 42. First real run: fetch, segment, fallback structure
  - Test first: none new (measurement task). Run `steam-ingest fetch quinces-marmalade --from-fixture` and `segment`; read `docs/kiro-evidence/ingest/measurements.json`. Compare the measured region and line count with the design's prediction; record any difference in the file as a note, change no constant, and decide on `--block` only through the documented ordinal.
  - Write `content/recipes/quinces-marmalade/fallback-structure.json` (steps and the hero note by indices, spans verbatim) and run `fallback`.
  - Files: `content/recipes/quinces-marmalade/*`, `docs/kiro-evidence/ingest/measurements.json`.
  - Satisfies: R5.7, R34.1, R34.2, R40.3.

- [x] 43. First real gate run on the fallback reading
  - Test first: the end-to-end hero test from task 38 now runs on the committed real folder. Expected route, per the spike: the hero note fails P3 ("joined strokes: needs review") with the measured share.
  - Run `ingest:gate`; read `gate.json`, the flagged components and `ownership/flag-*.png`; report the automatic alignment score and recall against `fixtures/hero-word-bounds.json`, whatever they are.
  - Files: `content/recipes/quinces-marmalade/gate.json`, `docs/kiro-evidence/hooks.log`.
  - Satisfies: R12.3, R20.1 to R20.3, R27.4, R27.5, R33.1.

- [ ] 44. Ownership review for the hero note (curator or agent step)
  - Only when P3 failed with "joined strokes: needs review": the writer (a person, or an agent that names itself in `reviewer`) looks at each `ownership/flag-<id>.png` and writes `ownership-review.json` with a decision, reviewer and one-line rationale per flagged component. Re-run `ingest:gate`; the hero note must report `reviewed (n components, by <reviewer>)`, never an automatic pass. `review.json` stays hand-written and is not part of this task.
  - Files: `content/recipes/quinces-marmalade/ownership-review.json`.
  - Satisfies: R13.1 to R13.7.

- [ ] 45. Measurements and evidence
  - Add `scripts/measure-ingest.ts` (reproducible) that writes the per-stage figures to `docs/kiro-evidence/ingest/measurements.json`: line count, splits, split shares, alignment outcome, recall, path coverage, contrast. No figure is written by hand.
  - Add `docs/kiro-evidence/ingest/README.md` listing each figure and the command that produced it (numbers copied from the JSON only).
  - Files: `scripts/measure-ingest.ts`, `docs/kiro-evidence/ingest/`.
  - Satisfies: R39.2, R40.3.

- [ ] 46. Final check
  - Run `npm run typecheck`, `npm test`, `npm run props`, `npm run build`. Confirm `src/ingest/purity.test.ts`, the threshold-constant tests and the French-Bread guard pass. Update this file's checkboxes. Do not run the held-out page.
  - Satisfies: R1.4, R38.4, R39.3, R39.5, R40.1, R40.2.
