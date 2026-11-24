# Design: ingest-pipeline

Status: requirements-first spec, step 2 of 3 (requirements, then design, then tasks). Requirement numbers (R12.3 = requirement 12, criterion 3) refer to `requirements.md`.

## 0. Inputs, constraints and what this spec does not claim

Inputs already in the repo (read before this design was written):

| File | Use here |
|---|---|
| `fixtures/p0033.jpg` | The page, 1601×2052. The frame of every fixture coordinate. |
| `fixtures/wellcome-work-zgtk6n7e.json` | Recorded catalogue response. Licence `pdm` under `items[1].locations[0].license.id`; `locationType.id` is `iiif-presentation`. The Work has no top-level `license`. |
| `fixtures/hero-word-bounds.json` | Six eye-marked word boxes and `recallThreshold` 0.85. Scoring only (R20). |
| `fixtures/gold-readings.json` | 11 body lines plus a separate `title`. Fallback reading and informational check (R30.7, R34). |
| `fixtures/p0c-eyeread-boxes.json` | Six boxes that overlap neighbouring lines. Replayed as masks, P4 must fail (R27.3). |
| `spikes/ingest-spike/` | Python spike. Behaviour and numbers only; nothing is ported line by line. |
| `docs/kiro-evidence/probe-3.5.0/workspace/tools/gate.mjs` | A `watch`/`command` handler that reached `terminal-state` on kiro-cli 3.5.0. |
| `_docs/kiro/workflows__authoring.md` lines 90-110, 255-400 | Watch node contract (R32). |

What a look at `p0033.jpg` shows, and what it changes against the spike:

- The recipe is "No. 26": title "To make Marmalade of Quinces" at the top, 11 body lines, a long separator rule under the previous recipe's last line and a flourish under "The time it Boils". The title is in the same block as the body. The spike's hand-typed region started below it and found 11 lines. The real region (R5) starts at the separator rule, so it should contain the title as line 0 and 11 body lines: 12 lines. This is a prediction to measure, not a number in code.
- "(No. 26)" stands in the left margin, separated from the text column by a gap. Without a column rule its ink would be owned by a line and would show up in whole-line notes. R5.5 removes it as marginalia.
- A page number ("16") stands below the last line. R5.4 keeps it out of the region.
- The gold reading has 11 lines and a title. With the title as line 0, gold line `j` maps to `lines.json` line `j + 1` (R34.1).

Limits stated so the build does not overclaim:

1. Block detection by separator rules is a design for this kind of page (rules between recipes). It is measured on `p0033` and reported, not tuned. If it finds the wrong block, `--block <n>` lets a curator pick among the code-found blocks (R5.3); it never takes coordinates.
2. Spike measurement on the hero note: split share 0.1908 from 4 joined components. Under the frozen 2% threshold P3 fails automatically on this note. The design therefore treats the ownership-review path (R13) as the expected route for the hero note, and reports it as `reviewed`, never as an automatic pass.
3. Word alignment by zero-ink columns may be ambiguous on this hand ("it" and "till" overlap in a vertical projection). The sheared projection (R18.2) is the first remedy; the curator fallback and whole lines are labelled alternatives.
4. Timings of the CLI are not claimed. No performance number appears in this spec.

## 1. Module layout and data flow

```
src/ingest/                       (pure; no node:, no DOM; R1)
  constants.ts      frozen numbers + reason + freezing commit (R39.5)
  sha256.ts         pure SHA-256
  image.ts          Gray/Rgba types, toGray, crop, resampleArea, rotate, scaleOf, pixelSha256
  threshold.ts      sauvola, inkMap, rawInk
  components.ts     union-find labelling, component ids
  deskew.ts         estimateTilt, rotate application rule
  lines.ts          rowProfile, findLines (cores, valleys), findSeparators, findBlocks, chooseRegion, findMarginalia
  slant.ts          estimateSlant, shear
  masks.ts          ownership, splits, splitShare, review application
  runs.ts           zero-ink runs in sheared coordinates (shared by align and runs.json)
  align.ts          automatic alignment, curator alignment, scoring against fixture
  merge.ts          tokenise, diff, disagreements, transcription.md format/parse, corrections
  notes.ts          steps/notes validation, quote -> token mapping, primary text
  timeofink.ts      Zhang-Suen, trace, times, note PNG/toi/json arrays
  props.ts          PROPS_VERSION, checkP1..checkP6
  gate.ts           runGate(ctx) -> {state, results, artifacts}   (pure; ctx holds bytes already read)
  bundle.ts         buildRecipeBundle, verifyUrl, checkAt
  licence.ts        resolveLicence(work)
src/data/schema.ts  zod schemas for every file below
tools/steam-ingest/
  cli.ts            dispatch + usage
  io.ts             read/write canonical JSON, decode JPEG (jpeg-js), PNG (pngjs), file hashes
  fetch.ts  segment.ts  merge.ts  fallback.ts  gate.ts  catalog.ts
  watch.ts          --once protocol
  hookslog.ts       append-only log
```

Stage flow for one recipe (`content/recipes/quinces-marmalade/`):

```
fetch    -> page.jpg, source.json
segment  -> lines.json, region.json, runs.json, strips/line-i.png, ownership/{splits.json,overlay.png}
   (agents later) -> agent/scribe.json, agent/second.json   (text + indices only)
merge    -> transcription.md (only if absent)
(optional, human) -> ownership-review.json, alignment.json, review.json, timing.json
gate     -> merged.json, notes/note-<id>.{png,toi.png,json}, ownership/flag-*.png, gate.json
catalog  -> recipe.json, content/catalog.json, public/recipes/<id>/*
```

`gate` runs the pure `runGate` on bytes that the CLI has read. The CLI writes what `runGate` returns, then decodes the written PNGs again and calls `checkP4`, `checkP5`, `checkP6` on those decoded files, so that the properties judge what ships (R30.1).

## 2. File formats (zod in `src/data/schema.ts`)

Types are written in TypeScript shorthand. Every file is written in canonical JSON (R9.5).

```ts
SegmentRun   = { id: string /* "sr-" + 12 hex */, stripsHash: string }
Frame        = { width: number, height: number, scaleX: number, scaleY: number }
Source       = { institution, shelfmark, workUrl, manifest, canvasIndex, imageService, page, date,
                 licence: { id, label, url }, credit, retrieved: string, frame?: Frame }
Line         = { i: number, box: [x0,y0,x1,y1], coreBand: [top,bottom], peakRow: number }
Lines        = { segmentRun, frame: {width,height}, region: {x0,y0,x1,y1}, selectedBy: "default"|"curator",
                 blockIndex: number, deskewDeg: number, deskewApplied: boolean, slant: number,
                 marginalia: {box, inkPx}[], outsideRegionInkPx: number, lines: Line[] }
Reading      = { segmentRun, lines: { i, text, uncertain?: { token, alt: string[] }[] }[] }
Scribe       = Reading & { title: string, titleLine: number | null,
                           steps: { n, lineIdx: number[], text }[],
                           notes: { id, step, span, quote: { line, fromWord, toWord }[] }[] }
Fallback     = Scribe & { readers: ["fallback"], by, source, sourceSha256 }
OwnershipReview = { segmentRun, decisions: { componentId, overlay, rationale, reviewer,
                    decision: { assignToLine: number } | { splitAtRow: number } }[] }
Alignment    = { segmentRun, method: "curator", by, rationale, lines: { line, boundaryRuns: number[] }[] }
Merged       = { segmentRun, readers, disagreements: { line, word, a, b, countMismatch?, correctedTo? }[],
                 readerUncertain, lines: { i, merged, corrected?, primary, wordCount: number | null }[] }
NoteJson     = (R23)
Gate         = (R30.2)
Review       = { reviewedBy: string(min 1), reviewedAt, gateSha256, notes?: string }
Timing       = { noteId, seconds, source: "cited", basis }[]
CheckAt      = { seconds: number >= 0, source: "cited"|"step-entry"|"cook", basis: string }
RecipeBundle = (R37)
Catalog      = { id, title, gateSha256 }[]
```

Reader schemas are `.strict()` so a stray `box` or `x` key is a validation error (R14.7). `Fallback` and `Scribe` share the step and note schema, so the same rules (R17) govern both.

## 3. Stage design

### 3.1 fetch (R3, R4)

`resolveLicence(work)` is pure. It filters `work.items[].locations[]` by `locationType.id === "iiif-presentation"`, collects their `license.id`, and returns `{ok, id, label, url}` or `{ok: false, reason}`. Zero locations, no id, or two different ids are refusals. The allow-list is `["pdm", "cc0", "cc-by"]` in `constants.ts`. The CLI calls it before any image request. `fetch` takes an injectable `get(url)`; tests pass a function that serves the recorded fixture and fails the test on any other URL, which also guards French Bread (R4.6).

The image URL is `${imageService}/full/1600,/0/default.jpg`. The `imageService` comes from `manifest.sequences[0].canvases[33].images[0].resource.service["@id"]`. The CLI decodes the download, compares its size with the fixture, and records the frame (R2.4).

### 3.2 Page, region and lines (R5 to R9)

Steps, all in the page frame, constants scaled by `scaleOf(frame)`:

1. `toGray`, then `inkMap` (R6). `rawInk` is kept.
2. Components by union-find (`components.ts`): a flat `Int32Array` parent array, scan with the four causal neighbours for 8-connectivity, path halving, then relabel by first pixel in raster order. Component id is `y·width + x` of that pixel, so ids are stable and independent of the labelling order.
3. `pageInk` = components of 30 px or more that do not touch the page border and are smaller than 25% of the page height and 60% of its width.
4. `findLines(pageInk)` gives page lines (R8). The median peak distance is the median line pitch `P`.
5. `findSeparators`: a separator is a component of the binarised page (including those removed in step 3) whose width ≥ 30% of the text column width and height ≤ 25% of its width, or a horizontal run of ink in a band of ≤ P/4 rows with the same width test. Because the flourish under "Boils" is probably joined to the letters, the run test works on row sums: a band of rows whose ink consists of one run longer than 30% of the column width and whose peak is not a line peak. Both tests are implemented; the one that fires is named in `region.json`.
6. `findBlocks`: page lines between consecutive separators (and the page's first/last line) form blocks. Block with most lines is chosen (R5.3).
7. Region rows: block's first line top − P/2 to last line bottom + P/2, clipped at the separator. Region columns: the group with most ink in the block's column projection split at gaps ≥ P/2. Other groups are marginalia.
8. Deskew (R7) is estimated on the block's ink before the final line finding. When it is applied the whole page is rotated first and steps 1 to 7 run on the rotated gray. When not applied (expected for `p0033`) the measured angle is only recorded.
9. Final `findLines` on the region ink gives `lines.json` lines. Strips are cropped from the scan (R9.2). `stripsHash` and `segmentRun.id` follow R9.3.

Why separators and not pitch jumps: on `p0033` the pitch between the title and the line above (about 69-75 px) is almost the same as between body lines. Pitch does not mark the recipe boundary; the ruled lines do.

### 3.3 Ownership (R10 to R13)

`ownership(ink, lines, review?) -> {owner: Int16Array, components: Map<id, {lines, split, rows, px}>, splits}`.

For each component:

- `touched` = indices of lines whose core band contains at least one of the component's rows (via a row histogram of the component, tested against each band).
- `|touched| = 1`: all pixels to that line. This is the case "ascenders and descenders stay whole".
- `|touched| ≥ 2` (sorted): valley rows `v_a … v_{b-1}` between consecutive touched lines. A pixel at row `y` goes to the first touched line `l_m` such that `y < v_m` (and to the last when no `v` exceeds `y`). The split is logged.
- `|touched| = 0`, or size < 30 px: nearest core band to the component's centroid row. Distance is 0 inside a band, else the gap to the nearest edge. Ties go to the upper line. No upward discount (the spike used 0.6; the requirement removes it).

A review decision (R13.3) overrides one component: `assignToLine` sets every pixel to `i`; `splitAtRow` splits at `y` between the two touched lines (valid only for two touched lines; for three or more the reviewer must use `assignToLine` or two entries, one per valley, which the schema allows by repeating the `componentId` with different rows).

`splitShare(note)` (R12.1): mask pixels whose component has `split = true` and `review` absent, over mask pixels. After a review decision a component no longer counts as split (its fate is on record), but the note's status is `reviewed` and is reported separately (R13.5). The flagged list for a note over 2% is the set of split components contributing mask pixels.

The four joined components in the hero note will be named in `gate.json` and each will have an `ownership/flag-<id>.png` for the reviewer.

### 3.4 Readings and merge (R14 to R17)

Merge input per line: scribe tokens `A`, second tokens `B`.

- `|A| = |B|`: slot `j` is a disagreement when `A[j] !== B[j]` (exact string compare; case and punctuation matter, because the cook sees both). `wordCount = |A|`.
- `|A| ≠ |B|`: LCS on exact strings; maximal runs of non-matching tokens between matches become one region; `wordCount = null`.

Merged marked text writes each region as `†[a|b]` (`a`, `b` joined by one space). Parsing `transcription.md` uses a tokenizer that treats `†[…]` as one atom, so the L-line round trip is exact when `a` and `b` contain no `|` or `]` (a reader file containing them is rejected by zod, R14.1, with the reason in `detail`).

Token index mapping: `scribeToSlot(line)` returns for each scribe token index its merged slot index. For equal counts it is the identity. For a mismatch line, it is the region index for tokens inside a region. A quote whose boundary lies strictly inside a multi-token region is rejected (R17.6). The *primary text* (R17.4) is the merged line with each region replaced by `a`, so it equals the scribe's own text when no correction exists. With corrections, the corrected line text replaces it, and the token count must be unchanged for lines that a note quotes (R16.4).

`span` check: `span === join(primaryTokens(line, from..to), " ")` across the note's parts.

### 3.5 Word alignment (R18 to R20)

`runs(line, owner, s)`:

1. Collect the line's owned pixels; compute `x' = round(x − s·(yMid − y))` for each.
2. Column occupancy over `[min x', max x']`.
3. Zero runs of width ≥ 4 are runs. Their `{index (left to right), x0, x1, width}` are what `runs.json` stores and what the curator indexes.

`alignAuto(runs, k)`: sort by `(−width, x0)`; take first `k−1`; accept if `widths[k−2] > widths[k−1]` (strictly wider than the next, unselected) and `widths[k−2] ≥ 1.5·median(unselected)`, with 4 as the median when nothing is unselected. Returns boundaries sorted by `x0`, each at `⌊(x0+x1)/2⌋`.

Why a single piece cannot straddle two words (R18.5): in sheared coordinates two 8-neighbour pixels differ by at most `1 + |s|` columns in `x'` before rounding, so at most `⌈1+|s|⌉ ≤ 2` after it for `|s| ≤ 1`. A run of ≥ 4 empty columns cannot be crossed. The property test builds random owned-pixel sets, shears them, and checks that every 8-connected piece falls in one word.

Scoring (R20): `scoreAgainstFixture(maskAlpha, rawInk, fixtureWords)` returns per-word recall/precision and overall recall `|rawInk ∩ ∪boxes ∩ alpha>0| / |rawInk ∩ ∪boxes|`. The fixture words are matched to `shownText` words by text, in order.

Method order per line: auto → curator → whole lines. A note with several quoted lines can use different methods per line; the note's `alignment` is the weakest used (`lines` < `curator` < `auto`), and each line's method is in `gate.json.alignment`.

### 3.6 Masks, time of ink and PNGs (R21 to R23)

For a note: `mask[p] = owner[p] ∈ quotedLines && p is ink && p in the word region of its line` (word regions only when aligned). The crop is `mask bbox ± 32 px`, clipped to the page.

Shell: `dilate(mask, 1) \ ink \ dilate(inkOwnedByOtherLines, 1)`, where "other lines" means every line the note does not quote.

Alpha: `a = clip((paper − gray) / 90, 0, 1)` where `paper` is a 31×31 median of the crop's non-ink gray (spike used a median filter of the whole gray; the non-ink median avoids ink bias), applied on mask ∪ shell; 0 elsewhere. RGB is the scan's, and `paper`-coloured where `a = 0`.

Trace:

```
for group g in order of line index:
  skeleton_g = zhangSuen(mask_g)               // mask_g = note mask pixels owned by line g
  key(q) = (g, x'(q), y(q))                     // sheared by the page slant s
  path = sort(all skeleton pixels by key)
  t(q) = (offset_g + x'(q) − lo_g) / W          // non-decreasing along path
timeMap[p] = t(nearest skeleton pixel of p within group(p))   // Meijster nearest-index transform
```

The path is a sort, which makes P6's monotonicity hold by construction, and the coverage check (95%) guards against skeletons that lose pixels because of bugs in the thinning or the sheared sort. It is expected to be 100%; the 95% is the frozen guard and is not tuned.

Why `x'` and not arc length: arc length follows loops and flourishes in writing order and would pretend a pen order. The spec claims only a left-to-right trace (R22.5).

PNG channels as in R21. `toi.png` G channel is `round(255·t)`; B is the normalised Gaussian of the alpha.

### 3.7 Gate (R30 to R33)

`runGate(ctx)` order of work (pure, over bytes in `ctx`):

1. Parse and validate `lines.json`, readers (or the fallback), optional review/alignment/transcription.
2. Staleness and missing checks → `waiting` (R14.4, R14.5, R16.2).
3. Structural checks (line counts, titleLine, R17) → fail with messages.
4. Merge, corrections, `merged.json`.
5. Ownership (with review).
6. Per note: alignment, mask, shell, trace, PNG arrays, `NoteJson`.
7. Results from the arrays: P1, P2, P3 (pure from owner map and masks). P4, P5, P6 are re-run by the CLI on decoded written PNGs; `runGate` also computes them on its in-memory arrays and the CLI asserts equality of the verdicts (a mismatch is a bug and fails the gate with "written files differ from computed arrays").
8. `gate.json` content with hashes; the CLI adds `at` only when the rest differs from the committed file (R30.4).

Idempotency key: `propsVersion + segmentRun.id + sorted inputs + sorted outputs`. A deleted or edited note PNG changes `outputs` and forces a recompute.

The `--once` handler is a thin wrapper:

```ts
const input = JSON.parse(await readStdin())                // exit 2 if not an object
const id = input?.config?.recipe                           // exit 2 if invalid
const cursor = input.cursor ?? { v: 1, polls: 0, invalid: {} }
const r = await gate(id, { who: "watch", cursor })         // all logs to stderr
if (r.state === "waiting") out({ outcome: "idle", cursor: next })
else out({ outcome: "terminal-state", cursor: next, payload: JSON.stringify(r.payload) })
```

Output is built with `JSON.stringify` of an object written once with a trailing newline. `console.log` is replaced by `console.error` in the module scope of `watch.ts`, so a library that logs cannot corrupt stdout.

A recipe's `watch` node should set `commandTimeoutSec` long enough for one gate run on this page. The number is measured in the task that adds the node, not claimed here. The spawn is `npx tsx tools/steam-ingest/cli.ts gate --once`.

### 3.8 Catalog, bundle, check times (R35 to R37)

`buildRecipeBundle(gate, merged, source, notes, timing?)` is pure. `checkAt` default per R36.2. The verify link per R23.3. The catalog refuses before it writes anything (all recipes are verified first, then written), so a failure never leaves a half-written catalog.

## 4. Frozen constants (`src/ingest/constants.ts`)

| Constant | Value | Source |
|---|---|---|
| `SAUVOLA_WINDOW`, `SAUVOLA_K`, `SAUVOLA_R` | 41, 0.2, 128 | request, spike |
| `INK_MEDIAN_GUARD` | 25 | spike |
| `MIN_COMPONENT_PX` | 30 | request |
| `CORE_FRACTION` | 0.6 | request |
| `PROFILE_SIGMA`, `PEAK_MIN_FRACTION`, `PEAK_MIN_DISTANCE` | 6, 0.25, 40 | spike |
| `SPLIT_SHARE_MAX` | 0.02 | product constitution |
| `RUN_MIN_PX`, `RUN_RATIO` | 4, 1.5 | request |
| `CONTRAST_MIN` | 40 | request |
| `PATH_COVERAGE_MIN` | 0.95 | request |
| `NOTE_MARGIN_PX` | 32 | spike; renderer needs at least 24 |
| `ALPHA_DARKNESS_RANGE`, `PAPER_WINDOW` | 90, 31 | spike |
| `DESKEW_RANGE_DEG`, `DESKEW_STEP`, `DESKEW_APPLY_MIN` | 5, 0.1, 0.5 | this spec |
| `SLANT_RANGE`, `SLANT_STEP`, `SLANT_ZERO_BELOW` | [−0.5, 0.8], 0.05, 0.05 | this spec |
| `LICENCE_ALLOW` | pdm, cc0, cc-by | request |

"This spec" constants are set here, before any measurement on `p0033`, and recorded with the freezing commit.

## 5. Correctness Properties

Properties P1 to P6 are the six the gate enforces. Each is stated for all inputs of its kind, with the requirements it validates and the property-test file that checks it with fast-check. `checkPn` in `src/ingest/props.ts` is the one implementation used by the gate, CI and, later, the browser; the property test generates inputs and asserts that `checkPn` agrees with an independent statement of the property written directly in the test.

### P1. Structure

For all line counts `n`, title indices `t ∈ {null} ∪ [0, n)`, step lists `S` and note lists `N` with mask sets `M`:
`checkP1 = pass` if and only if (a) every `i ∈ [0, n) \ {t}` lies in exactly one `S[j].lineIdx`, (b) no `lineIdx` contains `t` or an index ≥ `n`, and (c) every note in `N` has exactly one mask in `M`, whose granularity matches its alignment.
Generators: random partitions of `[0, n)` (must pass), then one line moved into two steps, one line dropped, the title added to a step, a note with zero or two masks (each must fail with the right message).
Validates: R17.1, R17.2, R24.1 to R24.3, R21.1.
File: `src/ingest/steps.prop.test.ts`.

### P2. Inside the page

For all page sizes `(W, H)` and all masks `m ⊆ ℤ²` with box `b = bbox(m)` and `pageBox ⊇ b`:
`checkP2 = pass` if and only if `m ⊆ [0,W)×[0,H)`, `pageBox ⊆ [0,W]×[0,H]`, `b ⊆ pageBox`, and `size(PNG) = size(pageBox)`.
Also: for every mask built by `buildNote` from a random page and owner map, `pageBox = clip(bbox ± 32)` and P2 passes (the margin never leaves the page).
Generators: masks near the edges (including empty and single pixel), boxes shifted by ±1 outside.
Validates: R21.2, R23.1, R25.1 to R25.3.
File: `src/ingest/bounds.prop.test.ts`.

### P3. Ownership and split share

For all binary ink maps `I` on a frame, all line sets `L` (disjoint core bands, one valley row between neighbours), and all review sets `D` valid per R13.2:
(a) `owner` is total on `I` and empty off `I`; every ink pixel has exactly one owner.
(b) A component touching exactly one core band has one owner for all pixels.
(c) A component touching ≥ 2 bands is split only at valley rows: its pixels at rows `< v` go to a line above `v`, at rows `≥ v` to a line below.
(d) A component with no band touched, or under 30 px, goes to the line with the nearest core band by centroid row; no ink is dropped.
(e) For every note mask `m` built from owned pixels, `splitShare(m) = |m ∩ splitComponents| / |m|`, and `checkP3(m) = pass` if and only if `splitShare ≤ 0.02` or every flagged component has a decision in `D`. A reviewed pass is reported with status `reviewed` and is never counted by `autoPass`.
(f) A review decision changes only the ownership of its own component.
Generators: random strokes (line segments and blobs) across and between synthetic bands; components crossing zero, one, two, three bands; a note constructed to have share exactly at 0.02 and at 0.02 plus one pixel.
Validates: R10.1 to R10.6, R11.1, R12.1 to R12.5, R13.1 to R13.5, R26.1 to R26.3.
File: `src/ingest/masks.prop.test.ts`.

### P4. Note fidelity and recall

For all pages, owner maps and note definitions (quoted lines `Q`, optional word regions `R`), and `a` the alpha of the note built from them:
(a) every pixel with `a > 0` is either an ink pixel with `owner ∈ Q` (and in `R` of its line when aligned), or a non-ink pixel within 1 px of the mask and not within 1 px of ink owned by a line outside `Q`;
(b) no pixel of a line outside `Q` has `a > 0`;
(c) the mask is the same when the text of the readings changes but the indices stay (agents never change pixels);
(d) `checkP4` fails for every note whose `a` contains a pixel owned by a line outside `Q`, including each box of `fixtures/p0c-eyeread-boxes.json` that overlaps a neighbouring line;
(e) for the hero note, `recall ≥ recallThreshold` read from `fixtures/hero-word-bounds.json`; the recall is measured on `rawInk` inside the fixture boxes against `a > 0`.
Generators: random owner maps with 2 to 5 lines; random quoted subsets; random word boundaries from random runs; for (d) the six p0c boxes over the real page's ink (a unit test that uses `fixtures/p0033.jpg`, in `fidelity.test.ts`); for (e) the real hero note, whose measured recall is reported, never asserted against a hand number other than the fixture's threshold.
Validates: R17.7, R18.5, R18.6, R20.1 to R20.5, R21.1 to R21.6, R27.1 to R27.5, R39.1, R39.4.
File: `src/ingest/fidelity.prop.test.ts`.

### P5. Contrast

For all gray crops `G`, ink masks `K ⊆ G` and widths of exclusion ring 2:
`contrast(G, K) = median(G[¬dilate(rawInk,2)]) − median(G[K])`, and `checkP5 = pass` if and only if `contrast ≥ 40`.
Monotone: lowering the ink's gray values (darker ink) never turns a pass into a fail; raising the background never turns a pass into a fail. The result is invariant under a permutation of pixel order and under translation of the crop.
Generators: two-level images with random levels and noise; ring-thin masks; masks with no background pixels (must fail with "no background", not throw).
Validates: R28.1 to R28.3.
File: `src/ingest/contrast.prop.test.ts`.

### P6. Reveal time and trace

For all note masks `m` (random strokes, loops, dots and multi-line groups) and slants `s ∈ [−0.5, 0.8]`:
(a) every pixel with alpha > 0 has a time `t ∈ [0, 1]`, finite, equal to the time of its nearest skeleton pixel in the same group;
(b) along the traced path, `t` is non-decreasing;
(c) `|path ∩ skeleton| / |skeleton| ≥ 0.95`;
(d) groups' time ranges satisfy `0 ≤ t0_g ≤ t1_g ≤ t0_{g+1} ≤ 1`;
(e) `G = round(255·t)` for every pixel with `R > 0` in the written `toi.png` (the quantisation is monotone, so (b) survives it);
(f) a horizontally mirrored mask with mirrored slant gives the time `1 − t` reversed within a group (symmetry check, up to one quantum), which fails if the sheared sort uses the wrong sign.
Generators: random strokes drawn into small rasters, thinned with the real Zhang-Suen; isolated dots (skeleton-free pieces take their centroid time); degenerate one-pixel-wide lines.
Validates: R22.1 to R22.6, R29.1 to R29.3, R21.4.
File: `src/ingest/timeofink.prop.test.ts`.

### Supporting properties

| # | Statement | Requirements | File |
|---|---|---|---|
| S1 | For all inputs, `sha256` equals `node:crypto` | R1.5 | `src/ingest/sha256.prop.test.ts` |
| S2 | For all page images and rotations by `θ ∈ ±3°` (below the apply threshold), the line count is unchanged; for `|θ| ≥ 0.5°` the estimate is within 0.2° | R7.1 to R7.4 | `src/ingest/deskew.prop.test.ts` |
| S3 | For all N-row synthetic pages, `findLines` returns N lines, core bands disjoint, valley rows strictly between them | R8.1 to R8.4 | `src/ingest/lines.prop.test.ts` |
| S4 | For all pairs of readings, `parse(format(merge(a, b)))` equals `merge(a, b)`; no disagreement disappears; a correction keeps its entry | R15.1 to R15.8, R16.3 | `src/ingest/merge.prop.test.ts` |
| S5 | For all owned-pixel sets and slants `|s| ≤ 1`, no 8-connected piece spans two words of an accepted alignment; accepted alignments always satisfy the 1.5× rule | R18.3 to R18.5 | `src/ingest/align.prop.test.ts` |
| S6 | For all notes, `span` is accepted iff it equals the primary text of its quote; any one-character edit is rejected | R17.2 to R17.6 | `src/ingest/notes.prop.test.ts` |
| S7 | For all gate inputs, running the gate twice yields the same `gate.json` bytes ignoring `at` and does not rewrite the file | R30.4, R30.5 | `tools/steam-ingest/gate.prop.test.ts` |

`vitest.config.ts` currently includes `src/**/*.test.{ts,tsx}`; task 1 adds `tools/**/*.test.ts`.

## 6. Failure and error handling

| Situation | Result | Requirement |
|---|---|---|
| Licence not in the allow-list, or any lookup error | `fetch` exits non-zero, no `page.jpg` | R3.2, R3.3 |
| Reader file missing or stale | `waiting`, exit 3 (`idle` in watch) | R14.4, R14.5, R31 |
| Reader file invalid | `fail`; in watch, `idle` once, then `fail` | R14.6, R32.5 |
| Note over 2% split, no review | `fail`, "joined strokes: needs review" | R12.3 |
| Review decision names an impossible line or row | `fail` with the component id | R13.2 |
| Alignment ambiguous | curator, then whole lines, labelled | R19 |
| Span not a quotation | `fail` P1 note rejected | R17.5 |
| Hook log cannot be appended | run fails | R33.5 |
| Catalog check fails | recipe refused, nothing written | R35.2 |
| Unexpected exception in watch | exit 1, idle poll | R32.6 |

## 7. Deferred (not in this spec)

- The scribe and second-reader agents, the Kiro workflow and its `watch` node. The `--once` handler is built here; the recipe that uses it is a later turn.
- The browser upload worker (it will import `src/ingest/`).
- The MCP server `tools/iiif-mcp/`.
- UI strings and the "verify at source" UI. This spec writes the data (`verifyUrl`, provenance).
- The held-out French Bread run (R39.3).
- The curator's own `ownership-review.json` and `review.json` for `quinces-marmalade`: they are written by a person after the first gate run shows what needs review.

## 8. Decisions made where the request was open

1. The region is the block between separator rules, with a curator ordinal override (R5). The request required "code, not hand numbers".
2. Quote words index the scribe's tokens and map to merged slots (R17.6); a `span` must equal the primary text exactly, trailing punctuation included (so the hero note's span is "till it Looks red & smooth,", with the comma; the UI may display it without if the caption policy says so, but the ink shown includes it).
3. `gate.json.inputs` also carries `page` and `lines`, and `outputs` carries the note files. Without them a changed scan or a deleted PNG under a passing gate would go unnoticed (R30.3).
4. `review.json` must carry the `gateSha256` that was reviewed (R35.3). A review of an older gate does not count.
5. `props` is `gate --all --verify` (R38.3). CI runs the same code path as `ingest:gate`.
6. Steps must quote their lines verbatim (R17.2). The scribe supplies grouping and indices, not rewording.
7. Hashes of PNG files are pixel hashes (R2.6).
