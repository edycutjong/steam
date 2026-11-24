# Bugfix: word-align-speck

Found by the ingest-pipeline run at turn-18 on Quinces p.23 (recipe `quinces-marmalade`, `fallback` reader): after the ownership review was written and the gate re-run, line 8's automatic word alignment was accepted, but a speck in the left margin became word 0. The note "when Tender" quoted a 1x10 px speck as "Tender," and P5 failed with `when-tender/line 8: no background`. P4 could not see it, because P4 trusts the word regions that alignment hands it.

The fix follows the property-based triplet, one commit per step so the history shows red before green: (A) exploration test on the real page, red, output in `docs/kiro-evidence/word-align-speck/red.txt`; (B) the fix from the root cause, green, in `green.txt`; (C) preservation properties. No threshold is tuned to make a result pass.

Terms. "Speck": an ink component of fewer than `MIN_COMPONENT_PX` (30) pixels. The pipeline already says such a component "does not create lines or count as pieces" (`constants.ts`). "Text extent" of a line: the first and last sheared column of its owned pixels that belong to components of at least 30 px. "Word box": the columns between two neighbouring boundaries of an aligned line (the first runs to the line's left edge, the last to its right edge). "Ink floor": the least number of owned ink pixels a word box must hold for an alignment to be believed.

## Current Behavior

1. Ownership gives every ink pixel of the region to a line, including specks (`masks.ts`: a component under 30 px goes to the nearest band). `zeroRuns` (`runs.ts`) then takes the line's first and last inked column over all owned pixels, so a speck far outside the writing stretches the extent, and the empty gap between the speck and the writing becomes a "run".
2. On line 8 ("Tender, mash them, & then put your sug.r", 8 words, needs 7 boundaries) the owned pixels at x = 126, rows 1610 to 1619, are three specks of 1, 1 and 2 pixels (4 owned pixels, sheared columns 127, 131, 133, 134). The writing starts at sheared column 301. The run 135 to 300 is 166 columns wide, by far the widest on the line, so `alignAuto` ranks it first and takes it as a word boundary at column 217. The acceptance test (7th widest run strictly wider than the next, and at least 1.5 times the median of the rest) looks at run widths only, so it accepts. Word 0 is then the speck, "Tender," is word 1, and every later word shifts by one. The speck's gap takes one of the 7 boundary slots, so one real gap is left without a boundary.
3. The note "when Tender" quotes line 7 word 6 and line 8 word 0. Its line 8 part therefore shows 4 pixels at the page's margin. P5 finds no ink to measure against a background there: `when-tender/line 8: no background`. The gate stays failed (`props` exits 1).
4. P4 passes for the same note. It restates the mask from the owner map and the word regions it is given, so a wrong region that is internally consistent is invisible to it. Nothing downstream of alignment asks whether a word holds any writing.
5. Bug condition, stated for a line and its automatic alignment: `C(line) = some word box of the accepted boundaries holds fewer than the ink floor of owned pixels inside the text extent`, or the extent itself is stretched by a speck (some owned ink lies outside the extent computed from components of at least 30 px).

## Expected Behavior

1. The line's ink extent and its column runs ignore specks outside the writing: the extent is taken from the owned pixels of components of at least `MIN_COMPONENT_PX` (30) pixels. Runs exist only between the first and last column of that extent. Specks inside the extent still occupy their columns, as before: they are part of the writing (dots, tails, abbreviation marks). Marginalia of the page (large components outside the chosen region) are not owned by any line and stay out, as before.
2. The ink floor, `WORD_INK_MIN_PX`, is 30, the value of `MIN_COMPONENT_PX`: a word holds at least as much ink as the smallest thing the pipeline counts as a piece of writing. It is not a new tuned number and it was fixed before the measurement, in this spec's first commit. Both the automatic and the curator method reject a candidate whose any word box holds fewer than that many owned ink pixels inside the text extent; the next method in the chain (curator, then whole lines) is used and `autoDetail` says which word and how many pixels ("word 0 holds 4 ink px, under the floor 30").
3. The word regions of an aligned part are clipped to the text extent, so ink outside it (a speck in the margin) is not quoted as part of the first or the last word. P4's independent statement of the mask takes the same extent, so P4 judges the same regions.
4. `docs/kiro-evidence/word-align-speck/red.txt` shows the exploration test failing on the unfixed code and `green.txt` shows it passing. After the fix `steam-ingest gate quinces-marmalade` is re-run and every P1 to P6 line is reported as it is. If the gate passes, `npm run props` exits 0.
5. If a note still needs a curator alignment, `alignment.json` is written from the code-found run indices only (method `curator`, labelled with who and why), never from hand-drawn coordinates.
6. The pipeline design (`.kiro/specs/ingest-pipeline/design.md` section 3.5 and the constants table) states the extent rule and the ink floor.

## Unchanged Behavior

1. Every other line's automatic alignment (boundaries, method, `autoDetail`) is unchanged, on the real page and on random synthetic lines without specks outside the writing.
2. The P3 review result is unchanged: same ownership, same split shares, same reviewed components.
3. The hero note's (looks-red-smooth) whole-line mask, time-of-ink map and PNGs are unchanged, byte for byte.
4. Step grouping and note spans (`merged.json`) are unchanged.
5. `runs.json` changes only for lines whose extent held a speck outside the writing.
6. No constant is edited; one is added (`WORD_INK_MIN_PX`, equal to `MIN_COMPONENT_PX`).

## Tasks

- [ ] 1. Commit A, `[kiro] word-align-speck: exploration test reproducing it on the real page (red)`
  - `src/ingest/alignSpeck.bug.test.ts` on the real Quinces page: line 8's accepted alignment must give every word at least the floor of ink, and the gate must pass P5 for `when-tender`. Both fail on the unfixed code and name the line, the word and the pixel count.
  - Save the failing output to `docs/kiro-evidence/word-align-speck/red.txt` and append a line to `hooks.log`.
- [ ] 2. Commit B, `[kiro] word-align-speck: fix from the root cause (green)`
  - Extent from components of at least 30 px in `zeroRuns`; the ink floor in `alignAuto` and `alignCurator`; word regions clipped to the extent in `noteMask` and P4's independent mask; design.md and the constants table updated.
  - The same test now passes; save `green.txt`; append a line to `hooks.log`.
- [ ] 3. Commit C, `[kiro] word-align-speck: preservation properties (Unchanged)`
  - `src/ingest/alignSpeck.prop.test.ts`: other lines' alignment, the P3 review result and the hero note's whole-line mask are unchanged; random lines with a speck added outside the writing align exactly as the line without it; a candidate with an inkless word is always rejected.
- [ ] 4. Re-run the gate on the real recipe
  - `npm run ingest:gate`, report every P1 to P6 line; `npm run props` exits 0 if the gate passes. Re-write the recipe's artifacts the gate produces and commit them. A curator `alignment.json` only from code-found runs, if still needed.
- [ ] 5. Evidence and ticks; final check: `npm test`, `npm run typecheck`, `npm run build` pass.
