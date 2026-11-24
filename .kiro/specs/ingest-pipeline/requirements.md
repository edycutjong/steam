# Requirements: ingest-pipeline

Requirements-first spec. `design.md` follows from this file and `tasks.md` from the design.

"The system" is the deterministic half of ingestion: the pure functions in `src/ingest/`, the zod schemas in `src/data/schema.ts`, and the Node CLI `tools/steam-ingest/`. Agents (the scribe and the second reader, built in a later turn) supply only text and line or word indices. Code computes every pixel. Nothing in this spec runs in the judged web app; the browser upload worker will import the same pure functions later.

Terms:

- **Page frame**: the pixel grid every coordinate is expressed in. For `quinces-marmalade` it is the 1601×2052 frame of `fixtures/p0033.jpg`.
- **Region**: the part of the page that holds one recipe (R5).
- **Line**: one manuscript line. `lines.json` indexes lines from 0.
- **Core band**: the rows of a line at or above 60% of that line's projection peak.
- **Valley row**: the row of minimum projection between two adjacent lines.
- **Piece**: the part of an ink component that one line owns after ownership (R10).
- **Quote**: a note's words, given as `{line, fromWord, toWord}` ranges.
- **Segment run**: the pair `{id, stripsHash}` that identifies one output of `segment`.
- **Reviewed**: a note whose over-threshold components all carry a decision in `ownership-review.json` (R13). A reviewed note is never counted as an automatic pass.

Numbers in this file that come from the spike (`spikes/ingest-spike/README.md`) are marked "spike". They are starting parameters, frozen before the first TypeScript measurement, and never changed to make `p0033` pass. Where a number is a threshold of the gate (2%, 40/255, 0.85, 95%, 1.5×) it is frozen by the product constitution and by the fixtures.

Pixel-size constants are stated for a page frame 1600 px wide and scale linearly with frame width (R2.5).

---

## R1. Pure, deterministic core

**User story:** As a builder, I want one ingest implementation that runs in Node, vitest and a browser worker, so that the upload path and the build path cannot disagree.

1. THE SYSTEM SHALL implement every stage in `src/ingest/*.ts` as a function of typed arrays and plain objects, with no import of `node:*`, no DOM global, no `fetch`, no clock and no randomness.
2. WHEN a stage is run twice on identical inputs, THE SYSTEM SHALL return identical outputs, byte for byte for typed arrays and structurally for objects.
3. THE SYSTEM SHALL keep file reading and writing, PNG and JPEG encoding, network access and the clock inside `tools/steam-ingest/`.
4. A test (`src/ingest/purity.test.ts`) SHALL fail if any non-test file in `src/ingest/` imports a `node:` module or references `window`, `document`, `process`, `Buffer` or `fetch`.
5. THE SYSTEM SHALL provide `src/ingest/sha256.ts`, a pure SHA-256, so that hashes can be computed in the worker; a test SHALL compare it with `node:crypto` on fixed vectors and on random inputs.

## R2. Images, grayscale and the working frame

**User story:** As a builder, I want one grayscale definition and one frame, so that every coordinate in every file means the same pixel.

1. THE SYSTEM SHALL convert RGB to 8-bit luminance with the integer formula `(299·R + 587·G + 114·B + 500) / 1000`, rounded down.
2. THE CLI SHALL decode JPEG with `jpeg-js` and read and write PNG with `pngjs`, with no native dependency.
3. WHEN `page.jpg` has the same size as `fixtures/p0033.jpg`, THE SYSTEM SHALL use the page's own pixel grid as the page frame.
4. WHEN `page.jpg` differs in size from `fixtures/p0033.jpg` (only for a recipe that has fixtures), THE SYSTEM SHALL resample it by area averaging to 1601×2052 for all analysis, and SHALL record `frame: {width, height, scaleX, scaleY}` in `source.json`. Every coordinate in every output file stays in the fixture frame.
5. THE SYSTEM SHALL scale pixel-size constants by `frameWidth / 1600` through one function `scaleOf(frame)`; a test SHALL show that a page and its 2× nearest-neighbour enlargement give the same lines.
6. THE SYSTEM SHALL compare PNG-valued files by `pixelSha256` (SHA-256 over width, height and the RGBA bytes), never by the encoded PNG bytes, because zlib output may differ between Node versions.

## R3. Licence resolved by code

**User story:** As a rights holder and as a judge, I want the licence read from the archive's record and checked before any pixel is downloaded, so that only open material is ingested.

1. WHEN `steam-ingest fetch <workId>` runs, THE SYSTEM SHALL request `/catalogue/v2/works/<workId>?include=items`, take `items[].locations[]` whose `locationType.id` is `iiif-presentation`, and read `license.id` from that location. It SHALL NOT read a top-level `license` of the Work.
2. IF the licence id is not in `{pdm, cc0, cc-by}`, THEN THE SYSTEM SHALL exit non-zero before any image request and SHALL write no `page.jpg`.
3. IF the catalogue request fails, returns a non-JSON body, has no `iiif-presentation` location, has more than one with different licences, or has no `license.id`, THEN THE SYSTEM SHALL refuse (fail closed) with a message that names the failure.
4. THE SYSTEM SHALL implement the decision as a pure function `resolveLicence(work)`; a test SHALL run it on `fixtures/wellcome-work-zgtk6n7e.json` (expect `pdm`) and on mutated copies (licence `in-copyright`, location removed, licence removed, two locations disagreeing, wrong location type).
5. THE tests SHALL read the recorded fixture and SHALL NOT use the network.

## R4. Page download and `source.json`

**User story:** As a cook, I want every reveal to say exactly where the page comes from.

1. WHEN the licence check passes, THE SYSTEM SHALL fetch the manifest `https://iiif.wellcomecollection.org/presentation/v2/b18419665`, take canvas index 32 (0-based; its image is `b18419665_MS_1810_0033.JP2`, the page of `fixtures/p0033.jpg`. Corrected in task 42: the first wording said index 33, which is the next page, `_0034.JP2`, 1600×1865; the live download of index 32 is byte-identical to the fixture), and download `<canvas image service>/full/1600,/0/default.jpg` to `content/recipes/<id>/page.jpg`.
2. THE SYSTEM SHALL write `source.json` validated by zod with: `institution`, `shelfmark` ("MS.1810"), `workUrl` ("https://wellcomecollection.org/works/zgtk6n7e"), `manifest`, `canvasIndex`, `imageService`, `page` ("p.23"), `date` ("c. 1750 (IIIF manifest)"), `licence` ({id, label, url} from the record), `credit` ("Wellcome Collection"), `retrieved` (ISO date) and, per R2.4, `frame` when it applies.
3. THE SYSTEM SHALL take every `source.json` field from the catalogue response, the manifest or the command line, and from no other place; the date SHALL be copied from the manifest.
4. IF the manifest, the canvas or the image request fails, THEN THE SYSTEM SHALL exit non-zero and leave any existing `page.jpg` and `source.json` untouched.
5. WHEN `steam-ingest fetch` is given `--from-fixture`, THE SYSTEM SHALL copy `fixtures/p0033.jpg` and the recorded catalogue response instead of using the network, so that CI and tests never depend on the archive.
6. THE SYSTEM SHALL NOT fetch French Bread (canvas 27, counted from 1 like "canvas 33" for p.23; the CLI refuses 0-based indices 26 and 27) in any command, test or script (R39.3).

## R5. Region chosen by code

**User story:** As a builder, I want the recipe's rows and columns found by code from the page, so that no hand-typed pixel numbers decide what is ingested.

1. WHEN `segment` runs, THE SYSTEM SHALL binarise the whole page (R6), remove components that touch the page border or exceed 25% of the page height or 60% of its width (binding, shadow, stains), and find page lines over what remains with the line finder (R8).
2. THE SYSTEM SHALL find separator rules: components, or runs inside a band of at most one median line pitch ÷ 4 rows, whose width is at least 30% of the text column width and whose height is at most 25% of their width. THE SYSTEM SHALL cut the page into blocks at separator rules, and SHALL list the blocks (lines, bounds, line count) in `region.json`.
3. THE SYSTEM SHALL select the block with the most lines by default. WHERE `--block <n>` is given, THE SYSTEM SHALL select the n-th block (0-based, top to bottom) and record `blockIndex` and `selectedBy: "default" | "curator"` in `lines.json`. A curator may choose among the code-found blocks and SHALL NOT supply pixel coordinates.
4. THE SYSTEM SHALL set the region's rows from the first and last line of the block, extended by half the median line pitch and clipped at the neighbouring separator rule. Ink outside the region is not owned and SHALL be counted in `lines.json` as `outsideRegionInkPx`.
5. THE SYSTEM SHALL set the region's columns from the text column: columns of block ink split at gaps of at least half the median line pitch, keeping the group with the most ink pixels. Ink groups left or right of it are marginalia and SHALL be listed in `lines.json` as `marginalia: [{box, inkPx}]`, not owned, and not part of any line extent.
6. WHEN the first line of the block is the recipe's title, THE SYSTEM SHALL index it as line 0; the system does not decide that. The scribe declares it (`titleLine`, R14.3) and P1 excludes it from steps (R24).
7. THE SYSTEM SHALL print the region it chose (rows, columns, line count, block count, marginalia count) to stdout and into `lines.json`. On `p0033` it SHALL report these numbers as measured, with no expected value written into code.

## R6. Binarisation

**User story:** As a builder, I want one documented threshold, so that "ink" means the same thing in the segmenter, the masks and the recall check.

1. THE SYSTEM SHALL compute a Sauvola threshold map with window 41, `k = 0.2`, `R = 128`, from integral images, with the window clipped to the image at borders.
2. THE SYSTEM SHALL mark a pixel as ink when `gray < T_sauvola` and `gray < median(region gray) − 25` (spike). The median guard keeps paper texture out of the ink map.
3. THE SYSTEM SHALL expose the raw map `gray < T_sauvola` separately as `rawInk`, because the frozen recall definition in `fixtures/hero-word-bounds.json` is stated on it (R27.4).
4. THE SYSTEM SHALL NOT drop small components when building the ownership ink map; it SHALL use only components of at least 30 px for line finding (R8.1), so that specks do not create lines.
5. A test SHALL show that a uniform image has no ink, a dark stroke on a gradient background is found at both ends of the gradient, and the result is unchanged when every pixel is shifted by a constant.

## R7. Deskew

**User story:** As a builder, I want page tilt measured and reported, so that line cores are not smeared.

1. THE SYSTEM SHALL estimate the page tilt in degrees as the angle in [−5°, +5°] (steps of 0.1°) that maximises the variance of the row projection of the ink, and SHALL report it in `lines.json` as `deskewDeg`.
2. WHEN `|deskewDeg| < 0.5`, THE SYSTEM SHALL keep the original frame, and SHALL record `deskewApplied: false` with the measured angle.
3. WHEN `|deskewDeg| ≥ 0.5`, THE SYSTEM SHALL rotate the grayscale page about its centre (bilinear) and work in the rotated frame, SHALL record `deskewApplied: true`, and SHALL label every note PNG built from it `resampled: true` in its JSON.
4. THE SYSTEM SHALL NOT claim a tilt correction that it did not apply. A test SHALL generate synthetic ruled text rotated by known angles and expect an estimate within 0.2° of the truth.
5. THE 0.5° rule and the ±5° range are frozen before the first measurement on `p0033`.

## R8. Line finding

**User story:** As a builder, I want lines found from the ink's row projection, with core bands and valley rows, so that ownership has a stable skeleton.

1. THE SYSTEM SHALL compute the row projection of the ink (components of at least 30 px), smooth it with a Gaussian of σ = 6 rows, take local maxima above 25% of the global maximum, and keep the higher of two maxima closer than 40 rows (spike).
2. FOR each kept peak, THE SYSTEM SHALL set the core band to the contiguous rows around it whose smoothed projection is at least 60% of that peak.
3. FOR each pair of adjacent peaks, THE SYSTEM SHALL set the valley row to the row of minimum smoothed projection between them (lowest index on ties).
4. THE SYSTEM SHALL return lines in top-to-bottom order with core bands that never overlap and valley rows that lie between the two core bands.
5. THE SYSTEM SHALL write for each line: `i`, `box` (the ink extent of the line's rows within the region columns), `coreBand` `[top, bottom]` and `peakRow`.
6. A test SHALL build synthetic pages of N text-like rows with known pitch and expect exactly N lines whose peaks are within 3 rows of the truth.

## R9. Segment outputs and the segment run

**User story:** As a reader agent, I want line strips to read and a stamp that tells me which segmentation they came from.

1. WHEN `steam-ingest segment <id>` runs on a folder with `page.jpg` and `source.json`, THE SYSTEM SHALL write `lines.json`, `region.json`, `runs.json` (R19.2), `ownership/splits.json` (R11.1), `ownership/overlay.png` and `strips/line-<i>.png`.
2. THE SYSTEM SHALL crop each strip from the scan in colour at native resolution, from the line's upper valley row to its lower valley row (the region's top or bottom for the first and last line), across the region columns. It SHALL NOT scale, binarise or annotate the strip.
3. THE SYSTEM SHALL set `segmentRun.stripsHash` to the SHA-256 of the concatenation of `pixelSha256` of `strips/line-0.png`, `line-1.png`, … in order, and `segmentRun.id` to `"sr-"` plus the first 12 hex characters of SHA-256 of `stripsHash` and the canonical JSON of the lines without `segmentRun`.
4. THE SYSTEM SHALL write `lines.json` as `{segmentRun, frame, region, selectedBy, blockIndex, deskewDeg, deskewApplied, slant, marginalia, outsideRegionInkPx, lines:[{i, box, coreBand, peakRow}]}`, validated by zod.
5. THE SYSTEM SHALL write JSON in canonical form: sorted keys, two-space indent, trailing newline, no timestamps in files other than `source.json` and `gate.json`.
6. WHEN `segment` runs again on unchanged inputs, THE SYSTEM SHALL produce byte-identical `lines.json` and the same `segmentRun`.
7. IF the segment run changes, THEN THE SYSTEM SHALL leave the existing reader files in place; they become stale by R14.4, and the gate waits.

## R10. Ink ownership

**User story:** As a cook, I want a note to show only the writer's ink that belongs to its own lines, so that a neighbouring line's descender never appears in it.

1. THE SYSTEM SHALL label 8-connected components of the ink map by union-find, and SHALL give each component the id `y·width + x` of its first pixel in row-major order. Ids are stable for a segment run.
2. WHEN a component of at least 30 px has rows inside exactly one core band, THE SYSTEM SHALL give all its pixels to that line, even when it crosses valley rows (ascenders and descenders stay whole).
3. WHEN a component has rows inside two or more core bands, THE SYSTEM SHALL split it at each valley row between the touched bands: pixels above the first valley row belong to the upper line, pixels between valley rows to the line between them, pixels at or below the last to the lowest touched line. The upper line owns the valley row's pixels strictly above it (`y < valleyRow`).
4. WHEN a component of at least 30 px touches no core band, THE SYSTEM SHALL give it to the line whose core band is nearest to the component's centroid row (distance 0 inside a band, ties to the upper line), with no distance discount.
5. WHEN a component is smaller than 30 px (i-dots, stops, commas), THE SYSTEM SHALL give it by the same centroid rule. It SHALL NOT drop it.
6. THE SYSTEM SHALL return an owner map in which every ink pixel in the region has exactly one owner and every other pixel has none.

## R11. Split log and overlay

**User story:** As a reviewer, I want every split visible, so that I can see where the writer's strokes were cut.

1. WHEN a component is split, THE SYSTEM SHALL append `{componentId, rows: [top, bottom], valleyRows, lines, pixelsPerLine, totalPixels}` to `ownership/splits.json`.
2. THE SYSTEM SHALL write `ownership/overlay.png`: the scan with each line's owned ink in its own tint and split rows marked.
3. WHEN a component is flagged for review (R12.3), THE SYSTEM SHALL write `ownership/flag-<componentId>.png`, a crop of the scan around the component with the valley rows and core bands drawn, to be named in `ownership-review.json`.
4. THE SYSTEM SHALL log the total number of splits per segment run to stdout.

## R12. Split share and the P3 threshold

**User story:** As a cook, I want the system to say when a note's ink was cut from joined strokes, and to refuse to call it clean.

1. THE SYSTEM SHALL define the split share of a note as `splitPixels / noteInkPixels`, where `noteInkPixels` is the note's mask pixel count and `splitPixels` is the count of mask pixels whose component was split.
2. THE SYSTEM SHALL freeze the threshold at 0.02. THE SYSTEM SHALL NOT raise it, scale it or special-case a page to make a note pass; a test SHALL fail if the constant differs from 0.02.
3. WHEN a note's split share exceeds 0.02, THE SYSTEM SHALL mark every split component that contributes pixels to the note as flagged, and SHALL fail P3 for the note with the message "joined strokes: needs review", unless R13 applies.
4. THE SYSTEM SHALL NOT replace the split rule by a majority or minority-overlap rule after measuring a page. The spike measured 0.178 for a 25% minority rule on the hero note and did not apply it.
5. THE SYSTEM SHALL report the split share of every note in `gate.json`, with the status `auto` (share ≤ 0.02 with no review), `reviewed` or `failed`.

## R13. Ownership review

**User story:** As a curator, I want a documented way to decide a joined stroke, so that a note with real joined strokes can ship without hiding the fact.

1. THE SYSTEM SHALL read `content/recipes/<id>/ownership-review.json` validated by zod as `{segmentRun, decisions:[{componentId, overlay, decision, reviewer, rationale}]}`, with `decision` equal to `{assignToLine: i}` or `{splitAtRow: y}`, and non-empty `reviewer` and `rationale`.
2. THE SYSTEM SHALL accept `assignToLine: i` only when line `i` has a core band touched by the component, and `splitAtRow: y` only when `y` lies in the interval from the upper touched band's last row to the lower touched band's first row. Any other value SHALL fail the gate with the component id.
3. THE SYSTEM SHALL apply decisions to the owner map before masks are built: `assignToLine` gives the whole component to line `i`; `splitAtRow` replaces the valley row for that component only.
4. WHEN every flagged component of a note has a decision, THE SYSTEM SHALL pass P3 for that note with status `reviewed`, and SHALL record `reviewed: [{note, components: n, reviewer}]` in `gate.json`. The detail text SHALL read "reviewed (n components, by <reviewer>)".
5. THE SYSTEM SHALL NOT count a reviewed note as an automatic pass in any figure, count, log line or bundle field, and SHALL report `autoPass` and `reviewedPass` as separate numbers.
6. IF `ownership-review.json` echoes a `segmentRun` other than the current one, THEN THE SYSTEM SHALL ignore its decisions, fail P3 for flagged notes and say "stale ownership review".
7. THE SYSTEM SHALL include the file's SHA-256 in `gate.json.inputs.ownershipReview` when the file exists.
8. A person or an agent MAY write `ownership-review.json`. Its `reviewer` SHALL name the writer truthfully (an agent names itself as an agent). A review written by an agent is an agent save: it is re-gated like any input, and the note it unlocks is reported as `reviewed` with that reviewer, never as an automatic pass. `review.json` (R35.3) is not covered by this clause and stays hand-written.

## R14. Reader files and staleness

**User story:** As a builder, I want two readers' files that say which segmentation they read, so that a stale reading is never merged.

1. THE SYSTEM SHALL validate `agent/scribe.json` and `agent/second.json` with zod. Both: `{segmentRun, lines:[{i, text, uncertain?:[{token, alt[]}]}]}`. `scribe.json` also has `title`, `titleLine` (index or null), `steps:[{n, lineIdx[], text}]` and `notes:[{id, step, span, quote:[{line, fromWord, toWord}]}]`.
2. THE SYSTEM SHALL require `lines` to hold exactly one entry per line of `lines.json`, with `i` equal to the position, and non-empty `text`.
3. WHERE `titleLine` is not null, THE SYSTEM SHALL require `title` to equal that line's text verbatim.
4. WHEN a reader file's `segmentRun` differs from `lines.json`'s in `id` or `stripsHash`, THE SYSTEM SHALL report the gate state `waiting` with the detail "stale reading: <file>".
5. WHEN a reader file is missing, THE SYSTEM SHALL report `waiting` with "missing: <file>".
6. IF a reader file fails zod validation, THEN `steam-ingest gate` SHALL fail with the first issues; in `--once` mode THE SYSTEM SHALL first wait one poll for the same file hash to repeat (R32.5), because an agent may still be writing.
7. THE SYSTEM SHALL NOT use `second.json` for steps or notes, and SHALL NOT accept pixel coordinates in any reader file; a test SHALL reject a reader file with a `box`, `bbox`, `x` or `y` key.

## R15. Merge, disagreements and `transcription.md`

**User story:** As a cook, I want to see both readings wherever two independent readers differ.

1. THE SYSTEM SHALL split each reading's line text into tokens on whitespace.
2. WHEN both readings of a line have the same token count, THE SYSTEM SHALL compare token by token, and SHALL record each difference as `{line, word, a, b}` (`a` the scribe's, `b` the second reader's).
3. WHEN the token counts differ, THE SYSTEM SHALL diff the tokens by longest common subsequence, SHALL record each differing region as `{line, word, a, b, countMismatch: true}` with `a` and `b` the joined tokens of the region (`word` is the index of the scribe's first token in it), and SHALL mark the line as having no known word count (R18.1).
4. THE SYSTEM SHALL write `transcription.md` in this strict form:
   - first line `<!-- segmentRun: <id> readers: <sha256 scribe>:<sha256 second> -->`;
   - then exactly one line per manuscript line, `L<ii>: <text>` with the index zero-padded to two digits (more if needed), and the text with each disagreement written `†[a|b]`;
   - no other non-blank line except comment lines starting with `<!--`.
5. THE SYSTEM SHALL carry each reader's own `uncertain` entries into `merged.json` as `readerUncertain`, and SHALL NOT use them to resolve a disagreement.
6. THE SYSTEM SHALL list every disagreement in `gate.json`-linked `merged.json` and in `recipe.json`; no step of the pipeline SHALL remove a disagreement. A correction (R16) adds `correctedTo` to the entry and keeps the entry.
7. WHEN `steam-ingest merge <id>` runs and `transcription.md` does not exist, THE SYSTEM SHALL write it. WHEN it exists and is current or revised (R16.7), THE SYSTEM SHALL leave it unchanged and print whether it equals the fresh merge. WHEN it is stale and carries no revision, THE SYSTEM SHALL regenerate it (turn 24, R16.2).
8. A property test SHALL show that parsing a merged `transcription.md` returns the same lines and disagreements that produced it.

## R16. Revised transcription and corrections

**User story:** As a reviewer, I want a Markdown review pass to be able to fix a reading, with every change on record.

1. WHEN `transcription.md` exists, THE SYSTEM SHALL parse its `L`-lines. IF the count or the indices differ from `lines.json`, or any non-comment line is not an `L`-line, THEN THE SYSTEM SHALL fail the gate with "transcription.md: line structure changed".
2. IF the header's `segmentRun` or reader hashes differ from the current ones, THEN THE SYSTEM SHALL NOT report `waiting` (turn 24: a stale `transcription.md` kept the workflow's watch idle until it timed out). WHEN the file carries no agent revision (criterion 7) THE SYSTEM SHALL regenerate it from the current readings and go on with the regenerated text. WHEN it does carry a revision, THE SYSTEM SHALL keep the revision authoritative as corrections, SHALL NOT overwrite it, and SHALL fail the gate with "transcription.md was revised against an older reading: re-review".
3. THE SYSTEM SHALL compare each parsed line with the fresh merged line. FOR each difference it SHALL record `{line, before, after}` in `gate.json.corrections` and SHALL use `after` as the line's text from then on.
4. WHEN a correction changes the token count of a line that a note quotes, THE SYSTEM SHALL fail the gate with "correction changes the word count of a quoted line".
5. THE SYSTEM SHALL hash `transcription.md` into `gate.json.inputs.transcription`.
6. THE SYSTEM SHALL show a corrected line, in `recipe.json`, with both its merged and corrected text.
7. THE SYSTEM SHALL record in `transcription.md`, as a second comment line `<!-- merge: <sha256 of the L-lines as generated> -->` after the header, what the generator wrote. A file **carries an agent revision** when its L-lines hash to something else than that value; a file without the line (written before turn 24) carries no revision only when its header names the current readers and its L-lines equal the fresh merge, otherwise it is treated as revised (never overwritten). The header's `readers: <sha256 scribe>:<sha256 second-reader>` already names the two reader files it was generated from (R15.4).
8. WHEN `transcription.md` is missing, THE SYSTEM SHALL (the gate, not only `steam-ingest merge`) write it from the current readings. `steam-ingest merge` and the gate SHALL share one rule: write when missing, rewrite when stale and unrevised, leave a revised file alone and say so.

## R17. Steps and notes

**User story:** As a cook, I want each step and each note to quote the page exactly, so that nothing is paraphrased.

1. THE SYSTEM SHALL require `steps` to be numbered `1..m` in order, with each `lineIdx` a non-empty ascending run of consecutive line indices.
2. THE SYSTEM SHALL require each step's `text` to equal the primary text (R17.4) of its lines joined by one space.
3. THE SYSTEM SHALL require each note's `step` to exist, each `quote.line` to belong to that step's `lineIdx`, `0 ≤ fromWord ≤ toWord < tokenCount(line)`, quote entries in increasing line order, and, when a note quotes more than one line, every part except the last to end at the line's last word and every part except the first to start at word 0.
4. THE SYSTEM SHALL define the primary text of a line as the corrected merged text with each `†[a|b]` replaced by `a` (the scribe's reading).
5. THE SYSTEM SHALL require a note's `span` to equal, character for character, the primary text of its quoted words joined by one space; the only allowed difference is that the span may leave off the trailing punctuation (`, . ; :`) of its last quoted word, so the hero span is "till it Looks red & smooth". The note's `shownText` stays the quoted words with their punctuation, because the word region of "smooth," includes the comma's ink. Any other `span` SHALL be rejected as "span is not a quotation". (Amended in task 42 per addendum 2c.)
6. THE SYSTEM SHALL index quote words in the scribe's tokens and map them to the merged tokens with the diff of R15. IF a quote starts or ends inside a disagreement region that spans several tokens, THEN THE SYSTEM SHALL reject the note with "quote splits a disagreement".
7. THE SYSTEM SHALL accept no step or note field named like a pixel coordinate, and SHALL NOT take a mask, box or time from the scribe.

## R18. Automatic word alignment

**User story:** As a cook, I want a note that quotes three words to show those three words, found by code from gaps in the ink.

1. THE SYSTEM SHALL attempt alignment on a line only when the line has a known word count `k` (both readers have the same count, R15.2) and the note quotes only part of the line.
2. THE SYSTEM SHALL work inside the line's ink extent, using the line's owned pixels only, in sheared coordinates `x' = x − s·(yMid − y)`, with `yMid` the core band's middle and `s` the page slant estimated by code (R22.4). WHEN `|s| < 0.05` it SHALL use `s = 0` and say so. It SHALL record `projection: "sheared" | "vertical"` and `s` in the alignment output.
3. THE SYSTEM SHALL list every run of zero-ink columns of at least 4 px between the first and last inked column, rank the runs by width (ties by position, left first), and take the widest `k − 1` as word boundaries, each at the run's centre column.
4. THE SYSTEM SHALL accept the alignment only when at least `k − 1` runs exist, the `(k−1)`-th widest run is strictly wider than the next one, and its width is at least 1.5 × the median width of the unselected runs (4 px when there are none). Otherwise it SHALL report "alignment ambiguous" with the three numbers.
5. THE SYSTEM SHALL assign each owned pixel of the line to word `j` by its `x'` between boundaries `j−1` and `j`. THE SYSTEM SHALL prove by test that, for `|s| ≤ 1`, no 8-connected piece spans two words.
6. THE SYSTEM SHALL NOT use a word box from any file as an alignment input; `hero-word-bounds.json` is used only to score (R20).

## R19. Alignment fallbacks

**User story:** As a curator, I want a labelled way out when gaps are ambiguous, without ever drawing a box.

1. WHEN automatic alignment is ambiguous for a line, THE SYSTEM SHALL look for `alignment.json` (fallback 1).
2. THE SYSTEM SHALL write `runs.json` at segment time: for every line, the code-found runs in left-to-right order with `{index, x0, x1, width}` in sheared coordinates.
3. THE SYSTEM SHALL read `alignment.json` validated as `{segmentRun, method: "curator", by, rationale, lines:[{line, boundaryRuns:[index…]}]}`. Boundaries are indices into the code-found runs of `runs.json`, never coordinates. THE SYSTEM SHALL require exactly `k − 1` distinct valid indices per line.
4. THE SYSTEM SHALL record `method: "curator"` and `by` in the note's provenance and show it in `recipe.json`.
5. WHEN neither alignment is available for a line, THE SYSTEM SHALL use whole lines (fallback 2): the note's mask is the owned pixels of every quoted line, `granularity: "lines"`, and `shownText` is the primary text of those whole lines.
6. FOR every note THE SYSTEM SHALL record `granularity: "words" | "lines"`, `alignment: "auto" | "curator" | "lines"` and `shownText`, so that the caption equals the ink shown.
7. THE SYSTEM SHALL hash `alignment.json` into `gate.json.inputs.alignment` when it exists.
8. (Component-partition boundary, turn 24.) THE SYSTEM SHALL offer the curator a second kind of boundary, built by code from ink components, for a gap where no code-found run separates two words (the hero: "it" and "till" overlap in the slanted projection). For one line it SHALL order the line's **owned components** (R10; the components that have at least one pixel owned by the line, whatever their size, whose centroid column lies inside the line's text extent, R18.2) by the **slant-corrected centroid column** `x'` of their owned pixels, `x' = x − s·(yMid − y)` (unrounded mean, the `s` the pipeline measured, R18.2); ties go to the smaller component id. A boundary is an index into that order: every component up to and including the named one belongs to the left word group, every component after it to the right.
9. THE SYSTEM SHALL compute the **candidates** of a line: the gaps between consecutive components in that order, each as `{after, before, gap, rank}` where `after` and `before` are the ids of the two components, `gap = (first column of the right group) − (last column of the left group) − 1` over the owned pixels of all components on each side (the number of empty columns between the two groups when it is zero or more; minus the number of shared columns when the groups overlap), and `rank` orders the candidates by `gap`, largest first, ties left first. THE SYSTEM SHALL list the candidates in a command (`steam-ingest partition <id> --line <n>`) and in an overlay PNG that draws the components and the candidates; no candidate is a coordinate.
10. THE SYSTEM SHALL read, in `alignment.json`, a boundary of this kind as the object `{kind: "component", after: <componentId>}` in the position of a gap in `boundaryRuns` (R19.3; run indices and `null` stay as they were). THE SYSTEM SHALL require `after` to be the `after` of one of the line's candidates; otherwise the part falls to whole lines with the reason. Entries of the two kinds SHALL NOT be mixed in one line. A `null` entry of a line with component boundaries means that the words either side of the gap stay together (they share one group).
11. THE SYSTEM SHALL accept a component boundary only at an **edge of the note**: the gap just before the quote's first word, or just after its last word. A component boundary inside the quote (the words inside a note stay together) makes the part fall to whole lines with the reason. A quote that starts or ends in a group that joins words through a `null` falls to whole lines, as for run boundaries.
12. THE SYSTEM SHALL assign every owned component to exactly one word group by its place in the order and shall never split a component: all pixels of a component owned by the line belong to the group of the component. **Tie rule:** a component whose centroid column falls inside the neighbouring word (a long t-cross, a flourish) goes with the neighbour, because the group of a component is decided by its centroid and by nothing else; equal centroids are ordered by component id. The curator sees such a component in the overlay and either chooses the candidate that puts it on the right side of the order or leaves the part on whole lines. THE SYSTEM SHALL prove the rule by test.
13. THE SYSTEM SHALL reject a component partition (the part then falls to whole lines, with the reason recorded in `reason` and `autoDetail`) when (a) a group of the quote holds fewer than `WORD_INK_MIN_PX` ink pixels (R18's ink floor), or (b) the **ink share** of the quoted groups (owned pixels of components of at least `MIN_COMPONENT_PX` pixels inside the extent, over the same count for the whole line) differs from the **character share** of the quoted words (the characters of design 3.5, over the line's) by more than a factor `WORD_SHAPE_RATIO_MAX` (2) either way. No component is cut by a component boundary, so the cut-through test of design 3.5 holds by construction.
14. THE SYSTEM SHALL build the note mask of a part with a component partition from the owned pixels of the line that belong to the components of the quoted groups, and from nothing else; the components outside the quoted groups are excluded. P4 SHALL keep its meaning: no lit pixel is ink owned by any other line or by a component outside the quoted groups of the quoted lines (the check states the mask from the owner map and the component labels alone, R27).
15. THE SYSTEM SHALL record in `gate.json.alignment[].parts[]` `boundary: "component"` and `components: [<after id>…]` for such a part (and `boundary: "runs"` for a part cut by runs), SHALL name the alignment `curator` and carry `alignmentBy` into the note and the bundle's provenance. `alignment.json` MAY carry `by` on a line entry, which overrides the file's `by` for that line, so that `by` names who chose each boundary truthfully.

## R20. Alignment score against the hero fixture

**User story:** As a judge, I want to see how the automatic alignment compares with the words the builder marked by eye, before the code existed.

1. WHEN a note's `shownText` words match, in order and ignoring case and trailing punctuation, the `words[].word` list of `fixtures/hero-word-bounds.json`, THE SYSTEM SHALL score the note against that fixture.
2. THE SYSTEM SHALL report, per fixture word, `recall` (rawInk pixels inside the box that the shipped mask keeps) and `precision` (shipped mask pixels inside the box ÷ mask pixels of that word), and the overall recall of R27.4.
3. THE SYSTEM SHALL report the score for the automatic alignment even when the shipped alignment is a fallback, with the reason the automatic alignment was not used.
4. THE SYSTEM SHALL read `recallThreshold` from the fixture file at run time and SHALL NOT copy the number into code.
5. THE SYSTEM SHALL NOT use the fixture boxes to cut, clip or select any pixel.

## R21. Note masks and PNG outputs

**User story:** As the renderer, I want a note image whose alpha is the writer's ink and nothing else.

1. THE SYSTEM SHALL build the note mask from the owned pixels of the note's words (or whole lines, R19.5) and from no other source.
2. THE SYSTEM SHALL write `notes/note-<id>.png` (RGBA) at the scan's full resolution: RGB from the scan; alpha the continuous ink darkness `clip((paper − gray) / D, 0, 1)` against a local paper estimate (median of the crop's non-ink pixels in a 31 px window), where `D = max(90, paper median − 1st percentile of the mask's gray)`; non-zero only on the mask and on non-ink pixels within 2 px of the mask (the shell), so that faint hairline joins that the binariser dropped survive; RGB under alpha 0 set to a flat paper value; a transparent margin of 32 px, clipped at the page edge. The alpha is never a binary mask.
3. THE SYSTEM SHALL exclude from the shell any pixel within 1 px of ink that is not in the mask (ink owned by a line the note does not quote, and the unquoted words of a quoted line).
4. THE SYSTEM SHALL write `notes/note-<id>.toi.png` (RGB, same size): R = the ink alpha, G = reveal time 0..255 (R22), B = local ink density, a Gaussian σ = 2 of the alpha, normalised by the note's maximum.
5. THE SYSTEM SHALL NOT synthesise, redraw, trace into vectors, smooth into a new outline, or re-typeset any stroke; RGB under alpha > 0 is the scan's own value.
6. THE SYSTEM SHALL write each note's files only from the mask, the scan and the trace, never from reader text, never from an agent-supplied number.

## R22. Time of ink

**User story:** As a viewer, I want the writing to come back left to right along the ink, and I want it never to be called the writer's real stroke order.

1. THE SYSTEM SHALL thin each group (a note's owned pixels in one line) with Zhang-Suen to a skeleton.
2. THE SYSTEM SHALL order skeleton pixels along a traced path by `(group order, x', y)` with `x'` sheared by the slant (R22.4), and SHALL assign reveal time `t = (offset_g + x' − lo_g) / W`, where `lo_g` is the group's least `x'`, `offset_g` the summed widths of earlier groups and `W` the summed widths of all groups. Groups are ordered by line index.
3. THE SYSTEM SHALL give every mask pixel, and every shell pixel with alpha > 0, the time of its nearest skeleton pixel in the same group (ties to the lower `x'`, then lower `y`). A mask piece that has no skeleton pixel SHALL take the time of its own centroid's `x'`.
4. THE SYSTEM SHALL estimate the page slant `s` once as the shear in [−0.5, 0.8] (steps of 0.05) that maximises the sum of squared column-projection counts of the owned ink, and SHALL record it in `lines.json` as `slant`. A synthetic test SHALL check the sign and size for strokes leaning right and left. (The spike added the shear with the opposite sign; the test, not the spike, decides.)
5. THE SYSTEM SHALL describe the path in every output as "a path traced from the ink, left to right"; no field, file or message SHALL call it the writer's pen order or stroke order.
6. THE SYSTEM SHALL store, per group, `t: [t0, t1]` in the note JSON, with `0 ≤ t0 ≤ t1 ≤ t0' ≤ 1` for consecutive groups.

## R23. Note JSON, bounding box and groups

**User story:** As the phone layout, I want each note's pieces and their time ranges.

1. THE SYSTEM SHALL write `notes/note-<id>.json` with `noteId`, `step`, `span`, `shownText`, `granularity`, `alignment`, `source` (credit string from `source.json`), `pageBox` `[x0, y0, x1, y1]` computed by code (mask bounding box plus the 32 px margin, clipped to the page frame), `size`, `resampled`, `groups`, `splitShare`, `splitStatus`, and `verifyUrl`.
2. EACH group SHALL have `line`, `rect` (in crop coordinates), `coreBand` (crop rows), `t`, `inkPx` and `words: {from, to}` (or the whole line).
3. THE SYSTEM SHALL compute `verifyUrl` as `<imageService>/pct:x,y,w,h/full/0/default.jpg`, with the percentages from `pageBox` over the page frame, rounded to 4 decimals, so that the link names the same pixels on the archive's server for any download size.
4. WHERE `deskewApplied` is true, THE SYSTEM SHALL compute `verifyUrl` from the bounding box of the mapped-back rectangle and label it `approximate: true`.
5. THE SYSTEM SHALL validate the file with zod and SHALL NOT write a number that it did not compute.

## R24. P1: structure

**User story:** As a cook, I want every line of the page in exactly one step, and every note backed by exactly one mask.

1. THE SYSTEM SHALL implement `checkP1` in `src/ingest/props.ts` over `{lines, titleLine, steps, notes, masks}`.
2. P1 SHALL pass only when every non-title line index lies in exactly one step's `lineIdx`, no step names a title or unknown line, and every note has exactly one mask, and the mask's granularity matches `alignment`.
3. WHEN P1 fails, THE SYSTEM SHALL name the offending line, step or note in `results.P1.detail`.

## R25. P2: inside the page

1. THE SYSTEM SHALL implement `checkP2` over the page size and, per note, the mask bounding box, the `pageBox` and the crop size.
2. P2 SHALL pass only when every mask pixel and every `pageBox` lies inside `[0,width) × [0,height)`, the mask lies inside the `pageBox`, and the `pageBox` size equals the PNG size.
3. WHEN P2 fails, THE SYSTEM SHALL name the note and the coordinate.

## R26. P3: ownership

1. THE SYSTEM SHALL implement `checkP3` over the ink map, the owner map, the components and the split share per note.
2. P3 SHALL pass only when every ink pixel in the region has exactly one owner, every component of at least 30 px is owned wholly by one line or split only at valley rows (or at a reviewed row), and every note's split share is at most 0.02 or reviewed per R13.
3. WHEN P3 fails, THE SYSTEM SHALL report the note, its split share, the component ids and the message "joined strokes: needs review".

## R27. P4: note fidelity and recall

1. THE SYSTEM SHALL implement `checkP4` over the decoded `note-<id>.png`, the owner map and the alignment.
2. P4 SHALL pass only when every pixel with alpha > 0 is either an ink pixel owned by one of the note's quoted lines, or a non-ink shell pixel as defined in R21.2 and R21.3; and, when the alignment is `auto` or `curator`, every such ink pixel lies in its word's region.
3. P4 SHALL fail on any pixel owned by a line the note does not quote. A test SHALL replay `fixtures/p0c-eyeread-boxes.json` as note masks (the box rectangles over the page's ink) and expect P4 to fail for every box that overlaps a neighbouring line.
4. FOR a note scored per R20, P4 SHALL also require `recall ≥ recallThreshold`. Recall is `|rawInk ∩ boxes ∩ shippedAlpha>0| / |rawInk ∩ boxes|` over the union of that note's fixture boxes, the definition frozen in the fixture.
5. THE SYSTEM SHALL report recall per scored note in `gate.json.recall`, whatever the result.

## R28. P5: contrast

1. THE SYSTEM SHALL implement `checkP5` over the scan and each note's crop and each group's crop.
2. P5 SHALL pass only when, in every crop, `median(gray of non-ink pixels beyond 2 px of rawInk) − median(gray of mask pixels) ≥ 40`.
3. WHEN P5 fails, THE SYSTEM SHALL report the crop and the measured contrast.

## R29. P6: reveal time and traced path

1. THE SYSTEM SHALL implement `checkP6` over the trace (path pixels in order, their times, the skeleton) and the decoded `toi.png`.
2. P6 SHALL pass only when every pixel with R > 0 in the `toi.png` has a G that equals the quantised time from the trace, `round(255·t)`, with `0 ≤ t ≤ 1`; times along the path never decrease; and the path covers at least 95% of the skeleton pixels of the note.
3. WHEN P6 fails, THE SYSTEM SHALL report which of the three conditions failed.

## R30. The gate and `gate.json`

**User story:** As a cook, I want a recipe to reach Cook Mode only when P1 to P6 pass, and I want to be able to check that without trusting anyone.

1. WHEN `steam-ingest gate <id>` runs, THE SYSTEM SHALL read the inputs, build the masks and artifacts from the scan and the ownership (never from agent pixels), re-read the written PNGs, run `checkP1` to `checkP6` on what was written, and write `gate.json`.
2. THE SYSTEM SHALL write `gate.json` as `{recipeId, propsVersion, segmentRun, inputs, outputs, pass, waiting?, results:{P1..P6:{pass, detail}}, recall?, alignment?, corrections?, splits, reviewed?, goldCheck?, at}`.
3. `inputs` SHALL hold the SHA-256 of: `scribe`, `second`, `alignment?`, `transcription?`, `ownershipReview?`, and, in this spec's extension, `page` and `lines`. `outputs` SHALL hold the `pixelSha256` of each file under `notes/`.
4. WHEN `gate.json` exists with the same `propsVersion`, `segmentRun`, `inputs` and `outputs` as a fresh computation, THE SYSTEM SHALL do nothing: it SHALL NOT rewrite `gate.json` and SHALL NOT change `at`.
5. WHEN any input hash differs, THE SYSTEM SHALL recompute everything and rewrite `gate.json` and the artifacts.
6. THE SYSTEM SHALL set `pass` true only when P1 to P6 all pass, no gate state is waiting, and every disagreement is retained.
7. THE SYSTEM SHALL write `goldCheck` (informational, never gating): the number of lines whose primary text equals `fixtures/gold-readings.json` after the title offset, and the differing line indices. The gold file SHALL NOT be merged into any agent reading.
8. THE SYSTEM SHALL bump `propsVersion` whenever a property's definition changes, and a test SHALL fail if `props.ts` changes without the bump.
9. `gate.json.readers`, `merged.json.readers` and the reader labels of `readerUncertain` SHALL name the readers by their agent names, `scribe` and `second-reader` (turn 24; they had said `second`). The file is still `agent/second.json` and `inputs.second` still hashes it.

## R31. Gate states and exit codes

1. THE SYSTEM SHALL end every gate run in one of three states: `pass`, `fail`, `waiting`.
2. `waiting` SHALL mean only that a reader file is missing or stale (R14.4, R14.5). A stale `transcription.md` is never `waiting` (R16.2, turn 24). It SHALL NOT be used for a property failure.
3. `steam-ingest gate` SHALL exit 0 for `pass`, 1 for `fail`, 3 for `waiting`, 2 for bad usage or bad configuration.
4. THE SYSTEM SHALL list every failing property and structural error in `gate.json.results` and on stderr, with the first failing item in the exit message.
5. WHERE `gate.json` is written for a `waiting` run, THE SYSTEM SHALL set `pass: false` and `waiting: [reasons]`.

## R32. The `--once` watch command

**User story:** As the Kiro workflow, I want a `watch` node that waits for both readers and then reports the verdict.

1. WHEN `steam-ingest gate --once` is run, THE SYSTEM SHALL read one JSON object `{cursor, config, workspacePath}` from stdin, use `config.recipe` as the recipe id and `workspacePath` as the working directory, and write exactly one JSON object `{outcome, cursor, payload}` to stdout followed by a newline.
2. THE SYSTEM SHALL write all logs and diagnostics to stderr, and nothing else to stdout.
3. FOR `waiting` THE SYSTEM SHALL answer `outcome: "idle"`. FOR `pass` THE SYSTEM SHALL answer `terminal-state` with `payload` the JSON string `{"pass":true,"gateSha256":…,"reviewed":[…]}`. FOR `fail` THE SYSTEM SHALL answer `terminal-state` with `{"pass":false,"failing":[…]}`. `cursor` SHALL always be present (`null` allowed) and `payload` SHALL always be a string on a terminal outcome.
4. THE SYSTEM SHALL exit 0 for `pass`, `fail` and `waiting`. It SHALL exit 2 only when stdin is not a JSON object, `config.recipe` is missing or not `[a-z0-9][a-z0-9-]*`, or the recipe folder does not exist.
5. THE SYSTEM SHALL carry in `cursor` `{v: 1, polls, invalid: {<file>: <sha256>}}`. WHEN a reader file fails validation, THE SYSTEM SHALL answer `idle` and store its hash; WHEN the same hash is seen on the next poll, THE SYSTEM SHALL treat it as a `fail`.
6. THE SYSTEM SHALL answer an unexpected exception with a non-zero exit other than 2, so that Kiro counts an idle poll, and SHALL write the stack to stderr.
7. A test SHALL replay `docs/kiro-evidence/probe-3.5.0/workspace/tools/gate.mjs` semantics (cursor present on idle, payload string on terminal) against the real output shape with a schema.
8. (Timeout safety, turn 24.) WHEN both reader files exist, validate and echo the current `segmentRun`, THE SYSTEM SHALL answer `terminal-state` on the first poll that sees them, whatever state `transcription.md`, `alignment.json` and `ownership-review.json` are in; `idle` remains possible only for a missing or stale reader file, or a reader file that fails validation for the first time (criterion 5). A property test SHALL run every state of `transcription.md` (missing, current, stale and unrevised, stale and revised, legacy without the merge line, malformed) against current readers and require a state other than `waiting`.

## R33. `hooks.log`

1. WHEN a gate run ends (every run, including no-ops and `waiting`), THE SYSTEM SHALL append one line to `docs/kiro-evidence/hooks.log`: `<ISO time> · <who> · <recipe> · pass|fail|waiting <detail>`, with U+00B7 and single spaces as separators.
2. `<who>` SHALL be `$STEAM_WHO`, or `--who <name>`, or `cli`, or `watch` in `--once` mode, in that order of precedence.
3. `<detail>` SHALL be one line, without newline characters, naming the failing properties, the waiting reasons, or the result (for example "P1-P6 ok · recall 0.9 · looks-red-smooth reviewed (4 components by <reviewer>)").
4. THE SYSTEM SHALL create the file and its folder when absent and SHALL never rewrite or truncate it.
5. WHEN the append fails, THE SYSTEM SHALL fail the run (an unlogged gate run does not count).

## R34. Fallback reader

**User story:** As a builder, I want the pipeline to finish with a labelled frozen reading if the agent run fails, so that masks and P1 to P6 still run.

1. WHEN `steam-ingest fallback <id> --structure <file>` runs, THE SYSTEM SHALL read `fixtures/gold-readings.json` for the recipe, map its lines onto `lines.json` (the body lines, after the title line when the title is in the region), and write `content/recipes/<id>/fallback/reading.json` with `{segmentRun, readers: ["fallback"], by, source, sourceSha256, title, titleLine, lines, steps, notes}`.
2. THE SYSTEM SHALL take `steps` and `notes` from the structure file (indices and quoted words, written by the curator); every R17 rule applies to them.
3. THE SYSTEM SHALL refuse when the gold line count does not equal the body line count.
4. WHEN `agent/scribe.json` and `agent/second.json` are both absent and `fallback/reading.json` is present and current, THE SYSTEM SHALL use the fallback: single reader, no disagreements, the gold file's `uncertain` entries as `readerUncertain`, and `gate.json.inputs.fallback` in place of `scribe` and `second`.
5. THE SYSTEM SHALL set `recipe.json` `transcription.readers = ["fallback"]` and `transcription.by` to the gold file's `by`, and SHALL NOT show it as two independent readers.
6. THE SYSTEM SHALL NOT merge the gold reading into an agent reading (R30.7).

## R35. Catalog and review

**User story:** As a judge, I want only recipes that passed the gate, and had a person's review, to be cookable.

1. WHEN `steam-ingest catalog` runs, THE SYSTEM SHALL, for each folder in `content/recipes/`, verify that `gate.json` exists with `pass: true`, that the current `propsVersion` is its version, that every hash in `inputs` and `outputs` equals the hash of the file on disk, and that no flagged note lacks a review decision.
2. THE SYSTEM SHALL refuse a recipe that fails any check of R35.1, with the reason, and SHALL write no catalog entry or public file for it.
3. WHERE a recipe is agent-transcribed (`readers` is not `["fallback"]`), THE SYSTEM SHALL also require `content/recipes/<id>/review.json` validated as `{reviewedBy, reviewedAt, gateSha256, notes?}`, with a non-empty `reviewedBy` and `gateSha256` equal to the SHA-256 of the current `gate.json`.
4. THE SYSTEM SHALL write `content/catalog.json` as `[{id, title, gateSha256}]` (sorted by id) and `content/recipes/<id>/recipe.json` (R37), and SHALL copy `recipe.json`, `page.jpg` and `notes/*` to `public/recipes/<id>/`.
5. THE SYSTEM SHALL be the only writer of `content/catalog.json`; a test SHALL fail if any other module writes it.
6. WHEN a refused recipe was cookable before, THE SYSTEM SHALL remove its stale `public/recipes/<id>/` files and say so.

## R36. Check times

**User story:** As a cook, I never want a cooking time that the page did not give.

1. THE SYSTEM SHALL write `checkAt` for every note as `{seconds, source, basis}` with `source` one of `cited`, `step-entry`, `cook`.
2. THE SYSTEM SHALL default to `{seconds: 0, source: "step-entry", basis: "the manuscript gives no time; the note arrives with its step"}`.
3. WHERE the curator supplies `content/recipes/<id>/timing.json` with `{noteId, seconds, source: "cited", basis}`, THE SYSTEM SHALL accept it only when `basis` is a substring of the primary text of the note's step and `seconds` is a finite non-negative number; otherwise it SHALL refuse the recipe at catalog time.
4. THE SYSTEM SHALL NOT write `source: "cook"` into a bundle (the cook sets it in the app) and SHALL NOT compute a time from any other source.
5. A test SHALL expect `quinces-marmalade` to carry `step-entry` on every note.

## R37. `recipe.json` and provenance

1. THE SYSTEM SHALL build `recipe.json` with the zod `RecipeBundle` schema in `src/data/schema.ts`: `{id, title, source, transcription:{readers, by, disagreements, corrections, goldCheck?}, lines:[{i, merged, corrected?, primary}], steps, notes, gateSha256, ownership:{autoPass, reviewedPass, reviewed[]}}`.
2. EACH note SHALL carry `step`, `span`, `shownText`, `granularity`, `alignment`, `checkAt`, `pageBox`, `size`, `files`, `groups`, `splitShare`, `splitStatus`, `verifyUrl` and `provenance: {institution, shelfmark, page, date, licence, credit}` from `source.json`.
3. THE SYSTEM SHALL never write the words "she", "her" or a persona into any copy; transcription records speak of "the writer" (a test greps the generated files).
4. THE SYSTEM SHALL write the path as "traced left to right from the ink" wherever it describes the reveal.

## R38. CLI and scripts

1. THE SYSTEM SHALL provide `tools/steam-ingest/cli.ts`, run with `tsx`, with subcommands `fetch`, `segment`, `merge`, `fallback`, `partition` (R19.9), `gate`, `catalog`.
2. THE SYSTEM SHALL add npm scripts `ingest:gate` (`tsx tools/steam-ingest/cli.ts gate quinces-marmalade`), `props` (`tsx tools/steam-ingest/cli.ts gate --all --verify`) and `catalog` (`tsx tools/steam-ingest/cli.ts catalog`).
3. `gate --all --verify` SHALL recompute the gate for every recipe without writing any file, SHALL compare the result with the committed `gate.json` (ignoring `at`), and SHALL exit non-zero on any difference, any failing property or any waiting recipe.
4. THE SYSTEM SHALL add `npm run props` to the CI job in `.github/workflows/ci.yml`, after `npm test`.
5. EACH subcommand SHALL print a one-line usage on bad arguments and exit 2.

## R39. Non-negotiables

1. THE SYSTEM SHALL NOT generate, synthesise, trace into vectors, re-typeset or imitate handwriting; every pixel with alpha > 0 in a note comes from the scan.
2. THE SYSTEM SHALL NOT write any number the code did not compute or the page did not give; no cooking time is invented.
3. THE SYSTEM SHALL NOT use the French Bread page (p.17, canvas 27) in development, tests, fixtures or defaults. One held-out run happens later, with the code frozen, and its result is reported whatever it is.
4. THE SYSTEM SHALL NOT take a mask, box, boundary, time or pixel from an agent.
5. THE SYSTEM SHALL NOT change a frozen threshold (0.02, 40/255, 0.85, 95%, 1.5×, 4 px, 30 px) after measuring a page, and SHALL list each in `src/ingest/constants.ts` with the reason and the commit that froze it.

## R40. Tests and fixtures

1. THE tests SHALL use only `fixtures/` and synthetic images; none SHALL use the network or French Bread.
2. FOR each pure stage, a `*.test.ts` file SHALL sit beside it; each universally quantified property SHALL have a `*.prop.test.ts` using fast-check, with a fixed seed recorded on failure.
3. A test SHALL read `fixtures/p0033.jpg` through the real decoder and run `segment` and ownership, and SHALL record (never assert against a hand number) the measured line count, split count and hero split share in `docs/kiro-evidence/ingest/measurements.json`.
4. THE SYSTEM SHALL test the three failure paths of the hero note end to end: `fail` (split share 0.1908 class, no review), `reviewed` (with a fixture review), and `waiting` (reader files missing or stale).
