# hero-hold-clearance: what changed, the red-to-green tests, the blot, the moved bounds

Spec: `.kiro/specs/hero-hold-clearance/bugfix.md`. Commits: red `1d649bd`, fix `b708030`. Frames: `before/` and `after/` in this folder, the held state of `/#/r/quinces-marmalade/cook?note=when-tender` 24 s after navigation, real time, desktop 1280 x 720 and Pixel 5 (393 x 851, device scale 2.75, mobile, touch), software GL (swiftshader), service worker blocked.

## R1. What the measurement showed

- The pane (`.steam-canvas`) is 724 x 209.1 CSS px at 1280 x 720. The dark band at its bottom is the 16 CSS px gradient `.rail--bottom::before` (and the same at the top, `.rail--meeting::after`), both in `src/steam/steam.css`. On the before frame the luminance of the empty glass, averaged over x 300 to 480, is 106 at 16 px above the pane bottom and 54 at 2 px above it.
- Before: scale 1.028, inked rects y 16 to 193.1 of 209.1. The lower group's bottom edge sat exactly at the top of the bottom band (209.1 - 16 = 193.1): zero clearance. The upper group started at the lower edge of the top band.
- After: scale 0.863, inked rects y 28 to 181.1: 28 px from each edge of the pane, which is 12 px of clear glass beyond each 16 px band. The block's middle is 104.555, the middle of the glass 104.555 (the layout is exact; the e2e allows 1.5 px for ink pixels). Core bands 19.0 and 17.3 CSS px (floor 16). Frames show "Tender," whole and above the band, and the block centred.

## What changed

- `src/steam/layout.ts`: constants `SHADE_CSS` 16, `CLEAR_CSS` 12, `V_INSET` 28. In the desktop (`'page'`) branch the height term of the scale is `(paneH - 2 * V_INSET - gaps) / stackH` instead of `(paneH - 2 * PAD_PX - gaps) / stackH`, and `fits` uses `V_INSET` for the vertical inset. The stack stays centred at `paneH / 2`, which is the middle of the clear glass because the two bands are equal. The phone branch is not touched.

## Red to green

- `src/steam/layout.clearance.test.ts` (11 tests; 4 red on the skeleton, with the failure messages "inked bottom 193.109375: expected 193.109375 to be less than or equal to 181.109375001" and "inked top 16: expected 16 to be greater than or equal to 27.999999999"): the real `when-tender` boxes at 724 x 209.109375: lower group at least 12 px above the bottom band, upper group at least 12 px below the top band, block centred to 0.5 px, one scale, `GROUP_GAP_CSS`, core band at least `MIN_CORE_CSS_PX`; `fits` true and false at a 60 px pane; the two `steam.css` rules are `SHADE_CSS` high and run into the pane; `CLEAR_CSS` equals the constant in `e2e/steam-phone-fit.spec.ts`; two fast-check properties (any pane where `fits`: inset and centring hold; any pane at least 400 px high fits).
- `e2e/hero-hold-clearance.spec.ts`, desktop test: red on the unfixed build with "clear glass between the lowest ink and the bottom of the pane … Expected: >= 28, Received: 17.54"; green after. It reads the layout the page reports and the note's own alpha (above 50, so the faint ends of strokes count; the first version used the phone-fit helper's alpha above 200, which is only the core of the strokes and put the block 9.9 px off centre by that measure; the test was corrected, not the code). The Pixel 5 test (phone layout is `groups`, core bands at least 16) passes before and after.
- The "fits is true, and false for a pane too short" test first assumed a 120 px pane; the layout shrinks the hand instead of failing there, so the test uses 60 px.

## Preservation

- Unit: 169 files, 1544 passed, 5 expected fail, before and after except the 11 new tests; no existing test file was edited (`layout.test.ts` untouched; its R20.1 assertions for the 1236 x 345 pane pass).
- e2e after the fix: `steam-phone-fit cook-layout-p1d steam-look3 cook-flow cook-a11y hero-hold-clearance` 41 passed (9.6 min); the other 12 specs (`cook-phone cook-qa-r1 cook-session cook-timing cook-verify shelf-retry steam-hold steam-night steam-phone steam-timing steam-visual tab-order`) 77 passed.
- Pinned bounds moved by the fix: none. No existing assertion needed a different number.
- Measured values that did move (not bounds): the desktop scale of this note at the real pane, 1.0283 to 0.8628; its inked rects, y 16/104.4 and 132.4/193.1 (before) to 28/102.2 and 130.2/181.1 (after); the group's core bands, 22.6 and 20.6 to 19.0 and 17.3 CSS px.
- Static panes (`npm run static-panes`, 1280 x 800): re-rendered; the `fogged` and `held` webp files of the three notes are byte-identical, so they were not stale. The `wiped` files differ on every render (live clock) and were restored from git; nothing in `public/` changed.
- Phone: `computeLayout('groups', …)` is unchanged by construction. On this note at 393 x 851 the page already reports `fits: false` before and after (inked top 13.27 CSS px, under the 16 px pad): a finding left open, outside this spec.

## R2. The copper shape right of "when"

Result: it is the writer's ink on line 7, three separate connected components, not the same component as the last letter and not owned by another word or line. Nothing was changed.

Measured with `tools/steam-ingest/partition.ts` (`partitionCmd(dir, {line: 7})`) and the page's labels after `ownership-review.json` (script not kept; the numbers can be reproduced with `steam-ingest partition quinces-marmalade --line 7`). Group 0 of the note is line 7, word 6 ("when"), rect 1003,32,1255,118 in note px (page px = note px + (282, 1473)), 2479 ink px. The components that make it up, all `owner = 7`, none split:

| Component id | Pixels | Note-px box | What it is |
|---|---|---|---|
| 2454034 | 416 | 1003,59 to 1053,82 | w |
| 2410890 | 504 | 1058,32 to 1106,81 | h |
| 2454135 | 201 | 1102,59 to 1125,79 | e |
| 2454162 | 327 | 1129,59 to 1176,80 | n |
| 2486214 | 91 | 1180,79 to 1226,81 | the exit hairline after the n |
| 2425424 | 546 | 1217,41 to 1251,79 | the blot (34 x 38 px), the shape in question |
| 2494262 | 353 | 1198,84 to 1241,117 | a stroke under the blot, touches no core band, owner 7 by nearest band |
| 2492686 | 32 | 1247,83 to 1254,88 | a speck beside it |

Sum 2470, plus a 9 px speck group-wide = 2479, the note's `inkPx`. So:

- (a) does not apply as written: the earlier remark "when (+ exit hairline/blot, same component)" in the word-cut spec is not what the current segmentation shows. The blot is its own component, 546 px, bigger than any letter but the w and the h.
- (b) does not apply either: the component is owned by line 7, the note's own line, and lies in the last word's box, which by the alignment rule runs to the line's extent (hi 1550 in order space). Neither reader (`agent/scribe.json`, `agent/second.json`) transcribed anything after "when". It is unread ink of the quoted line, kept by the existing rule.
- Changing it would need a new ingestion rule ("trailing ink no reader read is not part of the last word"), a new gate input and a review of `alignment.json`. That is not an application of the existing rules, so it is left as an open decision for the project owner. Open: whether a note should show ink after its last quoted word that no reader transcribed.

Emphasis (the renderer making one blot read brighter): measured on the held frames, warm pixels (R - B > 15) inside each component's box, mapped through the layout the page reports:

| Component | warm px | mean luminance | p90 | max |
|---|---|---|---|---|
| w | 410 | 109.0 | 145.1 | 187.2 |
| h | 502 | 107.5 | 147.9 | 201.3 |
| e | 202 | 121.9 | 179.8 | 197.1 |
| n | 296 | 118.1 | 159.3 | 190.3 |
| blot | 584 | 123.9 | 169.3 | 191.1 |

(before frame; the after frame, scale 0.863: blot 126.1 / 172.1 / 190.5, letters w 110.2, h 122.3, e 113.5, n 110.6.) The blot's mean is within 2 to 16 units of the letters' means and its maximum within the letters' range (187 to 201 before). It reads larger because it is a dense mass, 546 px in a 34 x 38 box, against thin strokes, not because it is brighter per pixel. No renderer change was made.

## By hand

- Open `/#/r/quinces-marmalade/cook?note=when-tender` at 1280 x 720 and wait for "The hand is writing…" to end: "Tender," stands clear of the dark strip above the bottom rail and the two words sit in the middle of the glass. Compare `before/held-desktop-1280x720.png` with `after/held-desktop-1280x720.png`.
- `npx playwright test hero-hold-clearance` and `npx vitest run src/steam/layout.clearance.test.ts`.
