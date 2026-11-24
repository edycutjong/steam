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
