# Bugfix: renderer v0 frames (D1 to D5)

Evidence: frames in `docs/kiro-evidence/renderer-v0/before/` (`desktop-t-600`, `desktop-t2000`, `desktop-t4000`, `desktop-t6500`, `mobile-t2000`, `mobile-t6500`), captured with the clock frozen via `?t=<ms after reveal start>`. The time-of-ink data (`public/hero/note-looks-red-smooth.toi.png`) is correct: group "till it Looks" has G 1-123, group "red & smooth," has G 125-255.

## Current Behavior

- D1. In `desktop-t2000.png` and `mobile-t2000.png` (u = 0.4) only the first group should be written. The second group "red & smooth," shows its letters as hollow cold-blue outlines. Cause: `derive.ts` writes toi (G) only within `DILATE_PX` of ink, but the channel alpha (R) is blurred `SOFT_PX` further. In that halo G = 0, so `wiped` is 1 as soon as u >= 0, and the rim shader draws an edge around ink that is not yet wiped. Bilinear sampling also mixes G toward 0 at the stroke edge.
- D2. In `desktop-t4000.png` and `desktop-t6500.png` wiped strokes read as hollow outlines with a dim brown fill. The ember gain behind the channel (`CH_GAIN` 0.55 times a 0.55 base) is low and the rim band is several px wide, so the rim dominates the letterform.
- D3. The specular streak is a wide bright bar across the top of the pane (every frame).
- D4. Beads on the bottom rail read as dark grey dots: they are dense, and their interior is not lit.
- D5. The moon is a flat disc.

## Expected Behavior

- D1. A stroke whose time-of-ink has not been reached is completely invisible in the fog. Every pixel with channel alpha > 0 carries the toi of its nearest ink pixel, so `wiped` is 0 there until that toi is reached. A rim exists only around ink already wiped.
- D2. The channel interior reads as clear glass with the pot's ember (`--after`) glowing through it, bright enough that the letterforms read at a glance. The `--ghost` rim is about 1 to 1.5 CSS px wide and subtle, on the outer edge only.
- D3. The streak is faint (barely there) and narrower.
- D4. Beads read as small transparent water beads: darker rim, a light catch-light, ember showing through, and sparser.
- D5. The moon has a soft cold halo, in CSS.

## Unchanged Behavior

- Concealment before the reveal: `desktop-t-600.png` stays free of any note pixel (`u = -1`).
- Timing constants in `timeline.ts` (`LEAD_MS`, `THICKEN_MS`, `WRITE_ON_MS`, `WIPE_MS`, `REFOG_MS`, `HEAD_FADE_MS`, `TOI_SOFT`).
- Layout of the sash, rails, footer and group destination rects, including the phone gap groups.
- The no-hotspot clamp of every output channel to `--ink`.
- The hull feather (A channel) and the writing head.
- Channel alpha (R) values and the pressure channel at ink pixels.
- Colours come only from design tokens.

## Tasks

- [x] B1. Bugfix spec (this file).
- [x] B2. D1: propagate toi over the whole alpha halo in `derive.ts`; add a test that fails before the fix (every pixel with alpha > 0 has the toi of its stroke).
- [x] B3. D2: stronger ember through the channel, thin outer-edge rim in `shaders.ts`.
- [x] B4. D3 and D4: fainter, narrower streak; sparser transparent beads.
- [x] B5. D5: moon halo in `steam.css`.
- [x] B6. Capture after-frames into `docs/kiro-evidence/renderer-v0/after/` and compare.

## Round 2 (D6 to D11)

Evidence: `docs/kiro-evidence/renderer-v0/after/desktop-t6500.png` and `mobile-t6500.png`. Reviewer verdict: phone BETTER (5/10 vs 3/10), desktop SAME (5/10 vs 6/10); the handwriting itself is lost.

### Current Behavior

- D6 (high). Letterforms are over-thickened and over-blurred (`DILATE_PX` 2, `SOFT_PX` 2, then a hard `smoothstep(0.12, 0.62)`). Counters of a, e, o, l fill in, hairline upstrokes vanish, "till it Looks" reads "lilG il~Looks", "&" reads as "Q".
- D7 (high). Strokes read as a flat opaque orange sticker with a uniform grey-blue outline: flat ember gain, no fog left inside, no bloom, symmetric rim.
- D8 (high). On desktop the groups sit where they are on the page (group 1 right of centre, group 2 lower left), so the writing head jumps right to left; the note is small, about 60% of the pane is empty.
- D9 (medium). Dark smudges inside strokes (the "L" and "ks" of "Looks").
- D10 (medium). The specular streak is a wide hard band (about 40 px at about 30%).
- D11 (medium). The pot is not visible; the ember light has no visible source.

### Expected Behavior

- D6. The channel follows the scan's own alpha: `DILATE_PX` 0, `SOFT_PX` 1 (at most about 15% growth), linear sampling at device resolution, a low clear threshold so hairlines and open loops survive.
- D7. Clear glass: ember gradient anchored to the pot (brightest low), 15% residual fog grain inside the channel, a warm bloom 7 to 11 px outside, a thin `--ghost` rim (1 to 1.5 CSS px) brighter on the lower edge and fainter on the upper, slight fog pile-up just outside the edge.
- D8. Desktop uses the phone's stacked layout: group 1 above group 2, left-aligned, stack centred, one scale for both, the wider group about 67.5% of the pane width, scale at most 1.6. Time-of-ink order unchanged.
- D9. The cause is found and removed. Found: the scan's ink is faint in places (in "ks" only 15% of ink pixels have alpha 255, against 26% for the group), and the ember behind the glass was scaled by the partial clear, so faint ink let the dark room through and read darker than the fog. The ember now lights every written ink pixel at full strength (`emberM`). Also fixed: where the stacked groups' margin rects overlap, the sample with the larger alpha wins, so one group's empty margin never masks the other's ink.
- D10. Streak 8 to 12 px wide with soft falloff, opacity at most 0.12.
- D11. A warm rising plume from the bottom edge, brightest at the bottom; a few short run-off drips under written stroke ends.

### Unchanged Behavior

Concealment before the reveal, timing constants, the no-hotspot clamp to `--ink`, hull feather, the hold, the wipe, phone core band at least 16 CSS px, colours only from design tokens, all existing tests (the desktop layout tests are replaced by stacked-layout tests).

### Tasks

- [x] B7. D8: stacked desktop layout in `layout.ts`, tests updated.
- [x] B8. D6: `derive.ts` constants and test.
- [x] B9. D7, D9, D10, D11: `shaders.ts`.
- [x] B11. e2e concealment check made layout-independent: detail (high-pass) variance, rows above the bead zone and plume reach, `WARMTH_MAX` 6 to 16 (pot glow under the centred lower group measured at 7 to 8; a written note asserted above 48).
- [x] B10. Capture into `docs/kiro-evidence/renderer-v0/after-v01/` and read.
