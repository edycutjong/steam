# Bugfix: hero-hold-clearance

Observed on the live hero deep link `/#/r/quinces-marmalade/cook?note=when-tender` at 1280 x 720, real time, held state about 24 s after navigation (frames: `docs/kiro-evidence/hero-hold-clearance/before/`). The note is two gap groups, "when" (line 7, upper) and "Tender," (line 8, lower). The lower group's letters sit on the bottom edge of the clear glass, inside the dark band above the bottom rail, so the lower strokes of "Tender" and its descenders sink into the shade and the T's crossbar reads weak. The upper group sits high with empty glass below it. The transcription line under the pane ("when Tender,") is fine.

Each item is fixed with a test written first and committed red (`[kiro] hero-hold-clearance: red …`), then the fix (`[kiro] hero-hold-clearance: fix …`), then a preservation check. Nothing is pushed or deployed by this spec.

Terms. "Pane": the `.steam-canvas` box, the clear sash between the meeting rail above and the bottom rail below (724 x 209.1 CSS px at 1280 x 720). "Shade band": the 16 CSS px strip at the top of the pane (`.rail--meeting::after`) and the 16 CSS px strip at its bottom (`.rail--bottom::before`), each a gradient of the page background at 62 % opacity into transparent (`src/steam/steam.css`). "Clear glass": the pane without its two shade bands. "Inked rect": the ink's bounding rectangle of a group, in CSS px, from `computeLayout` (`inked`). "Held state": `data-note-state="held"` on `main.cook`.

## Current Behavior

1. **R1.** The desktop (`kind: 'page'`) layout stacks the two groups at one scale and centres the stack in the pane, with only `PAD_PX` (16) kept free above and below. At 724 x 209.1 the scale is 1.028 (the width allows more, the height decides: `(paneH - 2 * 16 - 28) / 145`), the inked rects run from y 16 to y 193.1, so the lower group's bottom edge is exactly at the top of the bottom shade band (209.1 - 16 = 193.1) and its descenders and baseline lie inside it. The upper group starts at the lower edge of the top shade band. Measured on the held frame: luminance of the empty glass falls from 107 at 16 px above the pane bottom to 54 at 2 px above it.
2. **R2.** At the hold a large bright copper shape hangs off the right end of "when". It is not a letter of "when".

## Expected Behavior

1. **R1.** In the desktop layout every group's inked rect lies inside the clear glass with at least `CLEAR_CSS` = 12 CSS px to spare on both sides, which is the clearance the phone-fit e2e asserts (`CLEAR_CSS` in `e2e/steam-phone-fit.spec.ts`), measured from the edge of the shade band: inked top >= `SHADE_CSS` + `CLEAR_CSS` = 28 and inked bottom <= `paneH` - 28. The block of groups (top of the first inked rect to bottom of the last) is centred vertically in the clear glass, whose middle is `paneH / 2`: tolerance 0.5 CSS px. The scale is the largest that satisfies this, the width rule and `S_MAX_DESKTOP`; the gap between the groups stays `GROUP_GAP_CSS`. Every group keeps its core band at 16 CSS px or more (`MIN_CORE_CSS_PX`). `fits` is true only when the inked rects satisfy the rule. `SHADE_CSS` is a constant in `src/steam/layout.ts` tied by a test to the two 16 px rules of `steam.css`. A frame assertion (e2e, desktop 1280 x 720, held state of the deep link) reads the layout the page reports and the ink pixels of the note's own alpha, and asserts the same two numbers on the pixels. Moved bounds are listed with old and new measured values in NOTES.md.
2. **R2.** Find out from the alignment and the ownership of the note what the shape is. (a) The writer's own ink in the same connected component as the last letter: it stays; NOTES.md states the component id and pixel counts, and nothing changes. (b) Ink owned by another word or line, or a component outside the note's alignment span: a mask defect, with a red test and a fix through the existing alignment and ownership rules, never by erasing, retouching or adding ink and never by cutting inside a component unless the existing rules allow that cut. Either way: if the renderer's emphasis (glow, ember tint, edge brightening) makes one blot read brighter than the letters next to it, the luminance of the blot and of the letters is reported, and the renderer is changed only by a rule that applies to all ink equally.

## Unchanged Behavior

1. The phone layout (`kind: 'groups'`, pane width up to 640): every placement, scale and `fits` value. (R1)
2. The write-on timing: `t` ranges of the groups, `WRITE_ON_MS`, the reveal scheduler. (R1)
3. The 16 CSS px core band floor `MIN_CORE_CSS_PX`; `GROUP_GAP_CSS`, `DESKTOP_FILL`, `S_MAX_DESKTOP`, `PAD_PX`. (R1)
4. The spike page's hero pane (1236 x 345): its layout already satisfies the new rule (its existing R20.1 assertions stay). (R1)
5. Shaders, design tokens, copy strings and the pinned visual bounds of the look e2e, except a bound the fix must move, which is listed in NOTES.md. The static panes are rendered at 1280 x 800 and are checked, not assumed, to be unchanged. (R1)
6. The note masks, `alignment.json`, the gate results and every recipe file. No ink is erased, retouched or added. (R2)

## Test changes made deliberately

Recorded in `docs/kiro-evidence/hero-hold-clearance/NOTES.md` as each lands.
