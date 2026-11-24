# Bugfix: crop-overlap

A note's crop must show only ink owned by the lines the note quotes. The kill-test prototype cut notes with rectangles somebody read by eye, and those rectangles run into the neighbouring lines. This spec fixes that in the crop source the bundle uses, with the property-based triplet (bug condition exploration, fix checking, preservation) and one commit per step so the history shows red before green.

Terms. "P4" is the note-fidelity property of `ingest-pipeline/design.md` section 5: no lit pixel of a note is ink owned by a line the note does not quote. "Quoted lines" of a box are the lines whose peak row, carried to the fixture frame, lies inside the box (the convention of the task 28 replay in `fidelity.test.ts`). "Replay" means: take each box of `fixtures/p0c-eyeread-boxes.json` (the prototype's own output) as a note on the segmented Quinces page (p.23, block 1, `fixtures/p0033.jpg`).

Evidence of the defect: the prototype's own overlay, `specs/killtest/kiro/overlay.jpg` (outside this repo, read, not copied) shows six coloured step rectangles that are each about one line taller than the text they frame. Consecutive rectangles overlap one another and cut through the handwriting of the line above and the line below. The recorded run of this spec's exploration test is `docs/kiro-evidence/crop-overlap/red.txt`.

## Current Behavior

1. The prototype took a note's crop as a rectangle: every scan pixel inside the box whose ink alpha is above zero, whoever owns it. Replayed as note masks on the segmented page, five of the six boxes (steps 1 to 5) light ink that a line outside the box's own lines owns. Step 6 holds only its own line 11.
   Measured on the unfixed code (`docs/kiro-evidence/crop-overlap/red.txt`, 5 failed, 1 passed): step 1's crop contains 81 px owned by line 0; step 2's, 5 px owned by line 1 and 29 px owned by line 6; step 3's, 3787 px owned by line 4 and 492 px owned by line 8; step 4's, 1280 px owned by line 6 and 1555 px owned by line 10; step 5's, 474 px owned by line 8. Step 6 passes.
2. Where the bug shows: a note whose crop source is an eye-read box. The bug condition is `C(note) = note.box is present AND the crop source is "eyeread-box" AND some lit pixel has owner(p) not in note.lines`.
3. The ingest pipeline itself (`gate.ts`, `timeofink.ts` `noteMask`) already builds notes from ownership masks and never reads a box (`NoteDef` is a strict object, a `box` key is rejected). What is missing is a single named crop source that the bundle asks for a note, with a default that cannot silently fall back to a box. Until it exists the box behaviour is only demonstrable in a test, and nothing stops a note that arrives with a box from being cropped by it.
4. P4 sees the defect: `checkP4` fails each box that overlaps. It does not see the defect when the crop is never offered to it, so the note has to be built through the crop source that P4 then judges.

## Expected Behavior

1. `src/ingest/cropSource.ts` exposes `cropSource(page, note, opts?)`. The default source for every note, with or without a box, is `"ownership"`: the ink components owned by the note's quoted lines, cut to its word regions when it is word-aligned. The bundle never takes a box as a crop.
2. The mode `"eyeread-box"` remains, selectable only by passing `{ mode: 'eyeread-box' }`. It exists as the documented reproduction of this bug and is used by tests alone.
3. Fix checking, for every P0c box taken as a note by its quoted lines: the default crop passes P4 (no lit pixel owned by another line, none of the ink no line owns).
4. The bug stays demonstrable: with `{ mode: 'eyeread-box' }` the same notes fail P4 for steps 1 to 5 and the failure message names the step, the foreign line and the pixel count ("step 5's crop contains N px owned by line 8").
5. `gate.ts` takes its note masks from `cropSource`, so the code path the gate judges is the code path the bundle uses.

Measured on the fixed code (`green.txt`): 9 passed, 5 expected fail (the eye-read assertions of steps 1 to 5 under `it.fails`). The preservation run is `preservation.txt`.

## Unchanged Behavior

1. P2 (inside the page) and P5 (contrast) hold for every note of every recipe exactly as before.
2. Step grouping and note spans in `merged.json` and the gate's `alignment` block are byte-identical before and after.
3. The hero note's time-of-ink map is unchanged when its mask is unchanged (the map is a function of the mask alone).
4. The gate result for a recipe with no eye-read boxes is identical: same `gate.json` content (apart from `at`), same note PNGs and time-of-ink PNGs, byte for byte. Frozen from the unfixed tree in `docs/kiro-evidence/crop-overlap/before-fix.json` (the two synthetic recipes in full; the real recipe's merged.json, verdicts and the full-ripe and looks-red-smooth notes. when-tender is left out of the freeze because the word-align-speck spec changes its alignment on purpose). After word-align-speck, S4 no longer compares the overall gate state (it follows P5, which that fix turns to pass) or the hero's rejected candidate, which is never shipped and is cut from line 9's runs, which that fix changes.
5. `checkP4`, `noteMask` and the ownership masks are not edited.
6. Nothing is tuned: no threshold, constant or tolerance changes.

## Tasks

- [x] 1. Commit A, `[kiro] crop-overlap: bug condition exploration test (red)`
  - Add `src/ingest/cropSource.ts` with the `"eyeread-box"` mode (every scan pixel in the rectangle whose ink alpha is above zero) as the current default for a note that comes with a box, and `"ownership"` for all others.
  - Add `src/ingest/cropOverlap.bug.test.ts` (P4 on the default crop of every P0c box) and the pure helper `src/ingest/cropOverlap.fixture.ts`.
  - Run it. It must fail; the message names the step, the foreign line and the pixel count. Save the output to `docs/kiro-evidence/crop-overlap/red.txt` and append the red line to `docs/kiro-evidence/hooks.log`.
  - The test is committed failing, no `it.fails` in this commit.
- [x] 2. Commit B, `[kiro] crop-overlap: fix, notes take code-built ownership masks`
  - The default becomes `"ownership"`. `"eyeread-box"` only by explicit option.
  - The exploration test asserts the fixed behaviour (default source passes P4 for all six boxes). A second group documents that the eye-read source still fails P4: the original assertion under `it.fails` for steps 1 to 5 (only now that `red.txt` is recorded), and a plain test that the failing steps are exactly 1 to 5 with the foreign line and pixel count named.
  - `gate.ts` builds its note masks with `cropSource`.
  - Save the green run to `docs/kiro-evidence/crop-overlap/green.txt` and append the green line to `hooks.log`.
- [x] 3. Commit C, `[kiro] crop-overlap: preservation properties (Unchanged)`
  - `src/ingest/cropOverlap.prop.test.ts`: fast-check properties that the fix changes nothing else (P2 and P5 for every note, step grouping and note spans identical, the hero note's time-of-ink map a function of its mask, gate result identical for a recipe with no boxes).
- [x] 4. Evidence and ticks
  - `hooks.log` holds the red line then the green line; tick these tasks; fill the measured figures into this spec from `red.txt` and `green.txt`.
- [x] 5. Final check: `npm test`, `npm run typecheck`, `npm run build` pass.
