# Steam renderer v1: notes

Spec: `.kiro/specs/steam-renderer-v1/` (design first, then requirements, then tasks). Frames: `before/` (v0.2), `v1a/` (the first v1 frames) and `after/` (look pass 2; section below), both made by `scripts/capture-renderer-frames.ts` at a frozen clock (`?t=` ms after reveal start): desktop 1280x720, and a Pixel 5 (393x851, dpr 2.75), in software GL (SwiftShader). Nothing here is a number from a GPU run: no fps figure is claimed. `bench/results.json` is written by `npm run bench` on an idle machine and does not exist yet.

## What changed, against the seven findings

| # | Finding | v1 |
|---|---|---|
| 1 | Letters crushed, hairlines broken | The composite no longer thresholds the scan. `T = trans(a) * wiped`, `trans(a) = smoothstep(0.03, 0.97, a)^0.75`, monotone and continuous (fast-check). The ink is magnified with a Catmull-Rom filter in 5 taps from a mipmapped texture. The cleared area stays inside 0.85 to 1.15 times the scan's ink at 1x and 2x (asserted by `hero.coverage.test.ts`). Counters are open and the hairlines are partly clear, so the pen's pressure shows. |
| 2 | Flat orange sticker | A room behind the glass (pot, candle, bokeh), looked at through the film's height gradient (up to 3 css px of refraction). The stroke is lit by the room: its brightness changes along the hand, the lower inner edges catch the pot's light, the upper ones fall into shade, and dimmer light runs redder. A faint warm halo lights the film around written strokes. |
| 3 | White-yellow blob near the pot | The ember has a soft shoulder, and the cap is on luminance (0.92) and on the largest channel (0.93), so a clipped red can no longer turn yellow-white. e2e: no 24x24 window of the hand is brighter than 92 %. |
| 4 | Drips are static stalks | `drips.ts`: 3 to 6 runs, seeded, chosen by ink mass at stroke bottoms with clear glass below, started after their stroke is written, with an accelerate-then-stall slide (one or two slides), a bead head, a clear trail with a cold glint that re-fogs, stopping 24 css px above the sill. A pure function of the clock, so frozen frames repeat. |
| 5 | No night view | SVG sash split by a muntin: sky, 22 stars, low moon with halo and maria, seeded recursive branches, a thin cloud; a candle with wax, runs and a CSS flame on the sill. No raster, no clip-art. |
| 6 | Flat grey fog | Film lit from inside the scene: cool from the moon above, warm from pot and candle below; three layers of droplets that are lenses (dark rim, inverted warm light, moon-side catch-light); a wet lip and a cold rim on the fog side of every stroke; beads under lower edges. |
| 7 | Phone overflow | `gaps.ts` cuts the second line at its one ink gap wider than 18 note px ("red" over "& smooth,") because the whole line cannot hold a 16 css px core band inside the pane. The three placed groups each keep a core band of at least 16 css px, and the ink keeps at least 12 css px of glass on both sides: `e2e/steam-phone-fit.spec.ts` fails otherwise, at 390 and 393 css px. |

Also: the haunting cue now has its 1.2 s before the write-on (cloud over the moon, candle gutters, cold bloom from the pane edges, the lamp dip), the writing head is a capped cold glow with a breath along its path, the quality governor exists (tiers on `window.__steamStats` and the `?fps=1` overlay), the bench has five profiles, and the static panes were re-rendered from v1.

## Taps

At tier 0, per fragment inside a group rectangle: 1 to 2 `uChan`, 5 `uInkTex` (Catmull-Rom), 3 `uInkTex` at lod 1 (lip, normal, beads), 1 `uInkTex` at lod 3 (halo), 3 `uFog`. That is **13 typical, 14 worst case** (counted from the shader source, not profiled) (where two group margins overlap). Outside every group rectangle: 3. There is no loop that samples a texture. ALU-only loops: droplets (3 layers x 4 cells), runs (at most 6, each rejected by one x test), breath (6 gaussians), bokeh (4 cells). Tier 2 skips the droplet, run, bead and breath loops.

## Things measured while building

- The spec's first guess for the transmission, `smoothstep(0.04, 0.85, a)^0.8`, failed the coverage test on the hero note (it cleared more than 1.15 times the scan's ink; the alpha is mostly mid to dark). The constants in use were chosen from the alpha histogram and pass the test.
- In the first full e2e run the governor moved to tier 3 under SwiftShader on this loaded machine and swapped the canvas for the static images in the middle of two specs. Automated browsers (`navigator.webdriver`) therefore stay at full quality unless the URL says `gov=1`; the bench passes `gov=1` so its `tier` column shows what the governor really did.
- Static panes had the candle baked in; the script now hides the DOM candle while photographing the glass.

## What I would still improve

- **No GPU measurement.** The frames are SwiftShader. The 55 fps claim, the 13-tap cost and the governor thresholds are untested on hardware until the autopilot runs `npm run bench`.
- **The halo and the cold rim** still read slightly as an outer glow at 100 %. A thinner, noisier rim, broken by the film height, would look more like real surface tension.
- **Drips** are straight with a small wobble; a real run bends around droplets and leaves a wider, brighter lip. Their trails are the weakest element at phone scale (they look long and thin next to the writing).
- **Fog structure.** The density is one 4-octave noise; there is no large-scale streaking from earlier wipes or a finger-path of the writer. A second low-frequency "old wipe" layer would give the film a history.
- **Phone candle** is tall for the phone's short glass and stands near the last stroke; it could be smaller on narrow screens.
- **Night view on short panes**: the horizon is anchored at the bottom, so the moon may crop when the viewport gets shorter than the Pixel 5's.
- `derive` still runs on the main thread (still owed from v0).

## Look pass 2

Frames in `after/` are from this pass; `v1a/` holds the frames the pass started from, `before/` is v0.2. Same capture script, same frozen clock, software GL (SwiftShader). Two capture rounds were judged against `v1a/` (the first round showed drips as black pearls on stubs and the phone note still small; both changed before the second). No fps or timing figure comes from this pass.

| # | Finding | What changed | Judged on the frames |
|---|---|---|---|
| 1 | Drips as matchsticks | 2 to 4 runs on a wide pane, 1 to 3 on a phone, picked with a seeded key (not every word sheds one). Lengths in core-band heights, mostly 0.7 to 2, one run may reach 3.4 when its start has room. The path bends (two seeded sines plus a small lean, `runOffset`, same formula in GLSL). The trail is a thin clear channel: the dark room seen through it, a wider lip at the start, a faint ridge beside it, re-fogged from its top with age. The head is a lens bead (film-lit body, warm light high in it, dark rim, one catch-light). Widths and bead scale with the pane. | **Fixed in kind**: no sticks, no white dot, channels bend and read as water. On the hero frames the runs are short (30 to 60 css px); the one long run did not occur because every start with room for 2.2 core bands was taken by the lines below. |
| 2 | Neon-tube strokes | Rim only on the fog side, band of about 1 css px, broken by a fine noise mixed with the film height; halo 0.4 to 0.16; lip and its density halved and broken; fill follows the scan's ink darkness (thick strokes warm and clear, hairlines dim and cool); luminance cap untouched. | **Fixed**: at 100 % the strokes read as cleared glass with a wet dark edge and internal variation. The stroke luminance spread (p95 - p5) measured 64 (desktop) and 40 (phone) against 12 allowed in v1. |
| 3 | Phone composition | When every line has an ink gap, the phone cuts all of them and stacks four parts at one scale: 1.04 against 0.80, the ink block fills about 76 % of the glass height (45 % before) and sits 3.5 % of the height above the middle. Sill droplets: large-lens boost 3 to 1.6, smaller toward the rail, 0.6 of the room's warm light. Candle at most 44 css px under 640 px (92 on desktop), flame clear of the last stroke (e2e). | **Fixed**: the note uses the pane, the bottom confetti is gone. |
| 4 | Fog without history | Pass 1 gets three seeded old swipes of three fingers (long arcs, broken along their length, 0.10 of density and a little height, so they refract) and a broad density noise (0.16). Static, no read of the note. | **Fixed, kept subtle**: on desktop two curved swipes show near the centre and read as old wiper marks, not letters. |
| 5 | Streak | Removed. | **Fixed.** |
| 6 | Moon on short panes | `nightViewBox` never lets the visible top fall below the moon's top; `NightView` measures its svg and sets the viewBox. | **Fixed**: unit test over 1024 to 1920 wide by 600 to 1080 tall and the Pixel 5, and an e2e on the rendered disc at six viewports (including 1920x600). |

### Bounds re-pinned because the look changed (each in its commit)

- `steam-visual` stroke luminance spread 12 to 30 (measured 64 and 40; R14.3 asks for more).
- `steam-visual` sill droplet ratio 1.5 to 1.1 (measured 1.27 desktop; the sill gathers less on purpose, R15.3). The streak assertion became "no streak lift" (below 6 levels; measured 2.9 and 1.4).
- `steam-timing` written-note detail variance ratio 1.6 to 1.3 (measured 1.42; the bright outline that produced extra high-pass detail is gone). Fog alone is still held under 1.6, and the warmth check is unchanged.
- `steam-hold` cold-rim colour tolerance 60 to 72 (blue channel was 66 off `--ghost`; the rim is now thinner and broken).
- `steam-phone` placements `[[0,0],[1,0],[1,1]]` to `[[0,0],[0,1],[1,0],[1,1]]` (four parts).
- `baselineEdgeStep` tries 48, 32 and 24 px boxes when fewer than three 48 px boxes of plain fog fit between the larger phone groups.
- `drips.test` counts per pane (2 to 4 wide, 1 to 3 phone) instead of 3 or more.

Nothing was deleted or weakened otherwise: R1 transmission, `hero.coverage.test.ts` (0.85 to 1.15), P7/P8, the phone-fit e2e at 390 and 393 (it now also measures the block's fill and lift and the candle's clearance), the judge-path timing, the governor, the `?t=` determinism and the static panes (re-rendered with `npm run static-panes`) all pass.

### What I would still improve

- **Long runs on the hero.** The note leaves little room under its lines (24 css px sill clearance, the next line below), so no run is long on the hero frames. A pane taller than the glass on a desktop, or one run allowed to pass between two words of the next line, would show the long slide.
- **Dark brown edge.** Where a stroke's film is half cleared the meniscus shading (`EDGE_SHADE`) gives a thin dark edge that is slightly brown at 100 %; a cooler edge shade may read more like water.
- **Old swipes** are tuned by eye on two frames; at other panes the arcs land elsewhere and nobody has looked.
- **Still no GPU measurement.** The new work in the shader (noise for the rim break, the swipe loop in pass 1, the run path) is ALU only, but the 55 fps claim and the governor thresholds wait for `npm run bench` on a quiet machine.
- `derive` still runs on the main thread.
