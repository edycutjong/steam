# Ingest pipeline: measured figures

Every number on this page is copied from [`measurements.json`](measurements.json), which these commands write:

| Section of `measurements.json` | Command |
|---|---|
| `segment` | `npx vitest run tools/steam-ingest/segment.test.ts` (segments `fixtures/p0033.jpg` with `--block 1`) |
| `firstRun` | the first real run: `steam-ingest fetch quinces-marmalade --fallback-to-fixture` (the live API answered), `steam-ingest segment quinces-marmalade`, then `--block 1` |
| `gate` | `npm run measure:ingest` (the pure gate in memory on `content/recipes/quinces-marmalade`, without and with its `ownership-review.json`) |

The reading is the labelled fallback (`readers: ["fallback"]`, by "Claude Code builder agent (Opus 5.5)", `fixtures/gold-readings.json`). The Kiro reader agents have not run yet.

## Page and lines (`segment`, `firstRun`)

- Lines in the region: 12 (the title and 11 body lines).
- Blocks cut at separator rules: 2, with 13 and 12 lines. The default rule (most lines) picks block 0, the previous recipe; the recipe was chosen with the curator ordinal `--block 1`.
- Deskew: 1.6 degrees, applied. Slant: 0.8 (the upper end of the search range).
- Marginalia found: 0. "(No. 26)" is closer to the text column than half a line pitch, so its ink is owned by the lines beside it.
- Joined components split at valley rows in the region: 16.

## Gate on the automatic ownership (`gate.automaticOwnership`)

State `fail`: P1, P2, P4, P5, P6 pass; P3 fails with "joined strokes: needs review".

| Note | Split share | Flagged components | Alignment |
|---|---|---|---|
| full-ripe | 0.2201 (340 of 1545 px) | 1794062 | auto, words |
| when-tender | 0.0496 (1036 of 20887 px) | 2287181, 2324313, 2551877 | whole lines (line 7 ambiguous) |
| looks-red-smooth | 0.1093 (2276 of 20819 px) | 2551877, 2658036, 2765987 | whole lines (lines 9 and 10 ambiguous) |

Hero note "till it Looks red & smooth" against `fixtures/hero-word-bounds.json` (threshold 0.85, read from the fixture):

- Shipped mask (whole lines 9 and 10): recall 0.9802. Per word: till 0.981, it 0.6052, Looks 0.9974, red 1, & 0.9929, smooth 1. Precision is not defined for a mask that is not cut by words.
- Automatic word alignment: not used. Line 9: "8th widest run 12, next 12, 1.5 x median of the rest 8 = 12". Line 10: "6th widest run 15, next 15, 1.5 x median of the rest 11 = 16.5".
- The rejected candidate (the widest k−1 runs taken without the acceptance test, scored for the record only): recall 0.8177. Per word recall and precision: till 0 and 0, it 0.6052 and 0.15, Looks 0.9298 and 0.9853, red 1 and 0.807, & 0.9929 and 0.3934, smooth 1 and 0.8584.

## Gate with `ownership-review.json` (`gate.reviewedOwnership`)

The review was written by Kiro (agent), turn-18: one decision per flagged component (three `assignToLine`, three `splitAtRow`), each with a one-line rationale.

State `fail`: P1, P2, P3, P4, P6 pass; P5 fails.

- P3 passes as reviewed, never as automatic: `autoPass` 1, `reviewedPass` 2. full-ripe and looks-red-smooth are `reviewed`. when-tender is `auto` (split share 0): after the review, line 7's automatic alignment was accepted, and the words "when" and "Tender," hold no split ink.
- P5 fails on the crop "when-tender/line 8": 1 × 10 px, "no background". The automatic alignment of line 8 accepted 7 boundaries, but the line's ink starts with a speck in the left margin, which became word 0. The note's "Tender," is that speck. P4 passes because P4 trusts the word regions; P5 is the check that caught it. This note is wrong and is reported as it is.
- Hero recall unchanged: 0.9802 on whole lines.
- Path coverage: 1.000 for every note (path pixels equal skeleton pixels).
- `goldCheck` (informational): 11 of 11 body lines equal the gold reading, as expected for the fallback reader.

## Hero note after the component partition (turn 24)

`npx tsx scripts/hero-after-partition.ts` writes `hero-after-component-partition.png` (the note on whole lines 9 and 10 above, the note cut by components below) and `hero-after-component-partition.json` (every number below). The red run of the tests that came first is `component-partition-red.txt`.

- Boundaries (alignment.json, by "Kiro (agent), turn-24", chosen from `steam-ingest partition quinces-marmalade --line 9|10`): line 9 after component 2652341 (between "it" and "till"), line 10 after component 2776920, the comma after "smooth," (kept: the caption says "smooth,").
- The note shows "till it Looks" and "red. & smooth," and none of "to the Quinces, & boil it" or "keeping it stirred all" (looked at word by word on the PNG).
- Note recall 0.9572 against 0.85 (whole lines: 0.9802). Per word recall: till 0.981, it 0.605, Looks 0.930, red 1, & 0.993, smooth 1. Per-word precision is not defined for a note cut by components (no pixel carries a word number); the note-level precision, the share of the mask inside the fixture boxes, is 0.8745.
- Not kept inside the fixture boxes: "it" 116 px of line 8 and 6 of no line; "Looks" 169 px of line 10 (the strokes of "keeping" under it) and 17 of no line; "till" 21 px of line 8. These are other lines' ink in loose boxes: P4 forbids them.
