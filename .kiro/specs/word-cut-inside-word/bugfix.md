# Bugfix: word-cut-inside-word

Opened by the finding left open in `.kiro/specs/word-align-speck/bugfix.md` ("Found during this fix, not fixed"). On Quinces p.23 (recipe `quinces-marmalade`, `fallback` reader) every word-aligned note part is cut in the wrong place although P1 to P6 pass. A cook would see the wrong words in the writer's hand, so this must not ship.

The fix follows the property-based triplet, one commit per step, red before green, every commit titled `[kiro] word-cut-inside-word: …`: (A) exploration test on the real page, red, in `docs/kiro-evidence/word-cut-inside-word/red.txt`; (B) fix, green, in `green.txt`; (C) preservation properties. The detection rule is written into `.kiro/specs/ingest-pipeline/design.md` section 3.5 ("Plausibility of a word cut") in this spec's first commit, before the page was measured with it, and is not tuned afterwards.

Terms. "Word box": the columns between two neighbouring boundaries of an aligned line (the first runs to the extent's left edge, the last to its right edge). "Cut inside a word": a part whose word box shows letters of a neighbouring word, or lacks letters of its own word.

## Current Behavior

1. Automatic alignment takes the `k-1` widest zero-ink runs of the line as word boundaries and accepts when the last chosen run is strictly wider than the next and 1.5 times the median of the rest. In this hand a gap inside a word is often as wide as a gap between words, so the rule is confident and wrong.
2. Observed on the shipped note PNGs (looked at on white; first recorded in word-align-speck):
   - `full-ripe` (line 1, words 4 to 5, caption "full ripe,") shows the last letter of "be" and "full". It does not show "ripe,".
   - `when-tender`, line 7 word 6 (caption "when"), shows the final "n" of "when" and a blot after it. The last boundary falls inside "when".
   - `when-tender`, line 8 word 0 (caption "Tender,"), shows "Tend". The first boundary falls between "d" and "e".
3. P1 to P6 do not see it. P4 restates the mask from the same word regions that alignment produced, so a wrong but consistent region passes. P5 measures contrast, not which word. P6 scores recall against the eye-marked words of the hero note only, and the hero ships as whole lines.
4. Bug condition: `C(part) = the part is word-aligned and its word boxes are not the written words`. It cannot be read off the alignment's own regions. The proxies used here: the word-shape test, the cut-through test and, where a fixture exists, per-word recall and precision (design.md 3.5).

## Expected Behavior

1. An automatic alignment whose word boxes fail the plausibility tests is rejected: `alignment implausible: <reason>` (which word, how many columns, how many characters, the ratio). The note then falls back as the pipeline defines: curator alignment (`content/recipes/<id>/alignment.json`, method `curator`), else whole lines.
2. A curator alignment goes through the same tests. Its boundaries are indices into the code-found runs (`runs.json`), chosen by looking at each line strip PNG and the note PNGs, never hand-drawn coordinates. `by` names the author truthfully ("Kiro (agent), turn-21"). `by` is a hashed gate input and is shown as curator alignment in provenance.
3. After the fix the gate is re-run, every shipped note PNG is looked at, and the report says word by word exactly which words each note shows. A note shows exactly its quoted words. Whole lines are acceptable only for the hero note when alignment is still ambiguous, and the report then names the extra words that are visible.
4. `red.txt` shows the exploration test failing on the unfixed code, `green.txt` passing.
5. The design (`design.md` 3.5 and the constants table) states the rule and its constant.

## Unchanged Behavior

1. The hero note (`looks-red-smooth`, whole lines) is byte-identical (mask, PNG, time-of-ink, JSON) unless it becomes curator-aligned on purpose; the report says which.
2. P1 to P6 hold; the P3 review result (ownership, split shares, reviewed components) is unchanged.
3. Lines no note quotes by word keep their automatic alignment record except where the new test rejects it.
4. The `crop-overlap` and `word-align-speck` tests stay green.
5. No existing constant is edited; one is added (`WORD_SHAPE_RATIO_MAX`).

## Measured

- Detection rule (design.md 3.5, written in commit `399ac56` before any measurement): word shape with `WORD_SHAPE_RATIO_MAX = 2`, cut-through, fixture recall and precision at the fixture's 0.85.
- Red (`red.txt`, 2 of 4 fail on the unfixed code): the word shape test rejects all three word-aligned parts: `full-ripe/line 1`: "full" spans 33 of 1252 columns for 4 of 32 characters (ratio 0.21); `when-tender/line 7`: "in" 0.39, "&" 2.69; `when-tender/line 8`: "&" 7.54, "then" 0.43, "sug.r" 0.11. The cut-through test finds one real cut: `when-tender/line 8`, boundary 1496 cuts component 2551877. The fixture test judges no word-aligned note (the only eye-marked note is the hero, shipped as whole lines).
- Green (`green.txt`, 4 of 4 pass): ratios of every word of lines 1, 7, 8 lie between 0.56 and 1.47; cut-through none.
- Findings on the way: (a) the gate used the runs of the reviewed ownership for a curator's indices although the design says `runs.json` (line 7 has 26 runs there and 24 in `runs.json`); fixed. (b) a curator could not express a gap without a run: line 8's "them, &" (the comma touches the &) has none; `null` entries were added. (c) full-ripe's correct words contain a second joined stroke (component 1661441, the title's f, whose descender ends beside "ripe,"); the gate asked for a decision and it was made by looking at `ownership/flag-1661441.png` (assign to line 0).
- The hero stays whole lines: in line 9 no code-found run separates "to", "the" and "Quinces," (the Q's swash runs under "the"), so a word alignment of the hero cannot be exact. Its mask, PNG, time-of-ink map and JSON are byte-identical.

## Tasks

- [x] 1. Commit 0, `[kiro] word-cut-inside-word: bugfix spec and the detection rule (before measuring)`: this file and design.md 3.5.
- [x] 2. Commit A, `[kiro] word-cut-inside-word: exploration test on the real page (red)`: `src/ingest/plausible.ts` (the pure rule), `src/ingest/wordCut.bug.test.ts`; `red.txt`; hooks.log line.
- [x] 3. Commit B, `[kiro] word-cut-inside-word: reject implausible alignment, curator alignment from code-found runs (green)`: wire the rule into `alignAuto`/`alignCurator`/gate; curator `alignment.json`; gate re-run; `green.txt`; look at each note PNG.
- [x] 4. Commit C, `[kiro] word-cut-inside-word: preservation properties (Unchanged)`.
- [ ] 5. Final: `npm run ingest:gate`, `npm run props` (exit 0), `npm test`, `npm run typecheck`, `npm run build`; hooks.log lines; `docs/kiro-evidence/ingest/notes-after-word-cut-fix.png`; report.
