# Requirements: steam-renderer-v1

Derived from `design.md`. "The system" is the steam pane (`SteamGlass`, `SteamRenderer`, `NightView`, `Candle`, `StaticPane`).
Section references (§) point to `design.md`. Each acceptance criterion names the check: **unit** (vitest), **prop** (fast-check),
**e2e** (Playwright on the production build, software GL), **frame** (a captured PNG in `docs/kiro-evidence/renderer-v1/after/`
judged against `before/`).

## R1. Ink-darkness transmission

**User story:** As a viewer, I want the writer's pen pressure to show in the glass, so that the hand reads as handwriting, not a sticker.

1. THE SYSTEM SHALL compute how clear the glass is as `T = trans(a) * wiped`, with `trans(a) = smoothstep(0.04, 0.85, a)^0.8` over the scan's continuous alpha `a` (§3). **unit**
2. FOR ALL `a1 <= a2` in [0, 1], THE SYSTEM SHALL return `trans(a1) <= trans(a2)`, with `trans(0) = 0` and `trans(1) = 1`. **prop**
3. FOR ALL `a` and `e` in [0, 0.05], THE SYSTEM SHALL satisfy `|trans(a + e) - trans(a)| <= 2.5 e` (no narrow threshold band). **prop**
4. THE SYSTEM SHALL sample the ink alpha with a bicubic (Catmull-Rom) filter from a mipmapped `R8` texture, and SHALL NOT threshold the alpha anywhere in the composite. **unit** (GLSL contains no `smoothstep(CLEAR_MID`), **frame**
5. WHEN the hero note is magnified 2x (desktop 1.6x, phone 0.84x at dpr 2), THE SYSTEM SHALL keep `sum(T) / sum(a)` between 0.85 and 1.15, so counters stay open and hairlines stay present. **unit**
6. WHEN a frame is captured at `t = 6500` at desktop and phone size, THE SYSTEM SHALL show "till it Looks / red & smooth," with open counters, visible hairlines and no stair-stepped edge at 100 % zoom. **frame**

## R2. View through the glass

**User story:** As a viewer, I want to look through the glass into the room, so that the writing glows instead of being painted on.

1. WHERE the glass is clear, THE SYSTEM SHALL show the room light `uBg + uAfter * L` where `L` is the sum of the pot's gaussian (falling off with distance from `uPot`), the candle's gaussian at `uCandle.xy` and a bokeh term (§4). **unit** (uniforms and function present), **frame**
2. THE SYSTEM SHALL offset the room lookup by `REFRACT_PX * grad(h)`, between 1 and 3 css px, from the film's height field (§4). **unit**
3. THE SYSTEM SHALL NOT fill a stroke with one colour: stroke luminance SHALL vary by at least 12 levels (max minus min of the 5th and 95th percentile) across the hero note at `t = 6500`. **e2e**
4. THE SYSTEM SHALL scale the colour (not the channels) so that no pixel inside a stroke has luminance above `STROKE_LUMA_MAX` (0.92), keeping red above green above blue in at least 300 stroke pixels. **e2e** (existing property), **unit**
5. THE SYSTEM SHALL NOT draw a white or yellow-white blob near the pot: no 24 x 24 px window around the strokes SHALL have mean luminance above 0.92 x 255. **e2e**, **frame**
6. THE SYSTEM SHALL NOT use any colour literal in GLSL: every colour is a token uniform. **unit**

## R3. Condensation film

**User story:** As a viewer, I want the fog to look like wet glass with light inside it, so that it does not read as a grey card.

1. THE SYSTEM SHALL tint the film cool at the top (`--moon`) and warm at the bottom (`--after`), so that the mean red-minus-blue of the film's bottom quarter exceeds that of its top quarter by at least 6 levels at `t = -1000`. **e2e**
2. THE SYSTEM SHALL draw droplets at three scales (cell 7, 15 and 38 css px), each as a lens with a dark rim, refracted interior and a moon-side catch-light, at a density that follows the film and is zero in cleared glass (§5). **unit** (constants), **frame**
3. WHILE the film is dense (`d > 0.7`), THE SYSTEM SHALL show droplet pixels (a pixel departing from the mean of the pixels 20 px to its left and right by more than 14 levels) in at least 0.4 % of the pane at `t = -1000` and dpr 1. **e2e**
4. THE SYSTEM SHALL keep droplets 3x denser in the last 7 % of the pane height than in the middle band (rail beads). **e2e**
5. IF the governor is at tier 2 or above, THEN THE SYSTEM SHALL skip the droplet loops. **unit**

## R4. Wet edges and running water

**User story:** As a viewer, I want to see water run under the hand, so that it feels like a window and not a texture.

1. THE SYSTEM SHALL draw a denser, brighter film lip 1 to 2 css px wide outside each stroke and a cold `--ghost` rim on the fog side of the edge only (T < 0.5). **frame**
2. THE SYSTEM SHALL hang beads (radius 1.2 to 2.4 css px) under lower edges whose outward normal faces down. **frame**
3. THE SYSTEM SHALL plan 3 to 6 runs for the hero note with `planDrips`, each starting on dark ink with clear glass below, chosen by ink mass with at least 90 note px between runs. **unit**
4. FOR ALL runs and `t1 <= t2`, THE SYSTEM SHALL have `dripDistance(run, t1) <= dripDistance(run, t2)`, `0 <= dripDistance <= run.length`, and no head lower than `paneH - 24` css px. **prop**
5. THE SYSTEM SHALL start a run no earlier than its stroke is written (`tStart >= u0 * WRITE_ON_MS`). **unit**
6. THE SYSTEM SHALL compute a run from `(plan, t)` only, so frames at the same `?t=` are identical. **prop**
7. WHEN `t` is 6500, THE SYSTEM SHALL show at least 3 runs with a bead head and a clear trail. **frame**
8. THE SYSTEM SHALL NOT contain the v0 hash-grid drip (`h > 0.9 && c < 0.2`) in the composite. **unit**

## R5. The writing head

1. WHILE the phase is `writing`, THE SYSTEM SHALL draw a cold-white fingertip glow at the time-of-ink frontier in `mix(--ghost, --moon, 0.5)`, with peak added luminance no greater than 0.28 and no amber component above the surrounding fog's. **unit**, **frame**
2. WHILE the phase is `writing`, THE SYSTEM SHALL thicken and cool the film in a soft puff around the head and along the last six path samples (about 0.4 s), without reducing `T`. **unit** (uniform `uTrail`), **frame**
3. WHILE the phase is `fogged` or `thickening`, THE SYSTEM SHALL NOT draw the head (v0 R1.3 holds). **e2e** (existing)

## R6. The night view

**User story:** As a viewer, I want a night outside and a candle on the sill, so that the haunting has a place.

1. THE SYSTEM SHALL render the upper sash as an SVG with `--night` sky, at least 15 faint stars, a low `--moon` full moon with halo and maria texture (SVG gradients and filters only), seeded bare branches crossing the moon and a thin drifting cloud (§7.1). **unit** (DOM), **frame**
2. THE SYSTEM SHALL split the upper sash into two panes with a `--rule` muntin. **unit**, **frame**
3. THE SYSTEM SHALL generate branches with `branchPaths(seed)`, deterministic for a seed and free of `Math.random`. **prop**
4. THE SYSTEM SHALL render a candle on the sill with wax body, runs and a CSS flame that flickers; under `prefers-reduced-motion` the flame SHALL NOT animate. **unit**, **e2e**
5. THE SYSTEM SHALL pass the flame's position to the shader as `uCandle` and add its warm light to the room and the film. **unit**
6. THE SYSTEM SHALL NOT include pumpkins, bats or raster images in the night view. **unit** (no `<image>`, no `.png`)

## R7. The haunting cue

1. WHEN a note's reveal starts from the fogged phase, THE SYSTEM SHALL spend `THICKEN_MS` (1200 ms) in `thickening` before the write-on, during which: the cloud slides over the moon, the candle leans and gutters, the cold bloom rises from the pane edges, and the existing hood lamp dips. **e2e**, **unit**
2. FOR ALL `t`, THE SYSTEM SHALL return `bloom` in [0, 1], 0 for `t <= -THICKEN_MS` and for `t >= WRITE_ON_MS + 1500`, continuous in `t`. **prop**
3. WHEN the note holds, THE SYSTEM SHALL slide the cloud off the moon and return the candle to steady. **e2e** (data attribute)
4. WHERE `prefers-reduced-motion` is set, THE SYSTEM SHALL NOT slide the cloud, animate the candle, drift the cloud or draw the bloom; the lamp dip and the silence remain. **e2e**, existing `Cook.cue.test.tsx`
5. THE SYSTEM SHALL keep every existing Cook Mode behaviour: the deep link, wipe, refog outside the hull only, the lost-context fallback. **e2e** (existing)

## R8. Phone gap groups

1. AT viewport widths 390 and 393 css px, THE SYSTEM SHALL give every placed group a core band of at least 16 css px (`MIN_CORE_CSS_PX`). **e2e**, **prop**
2. AT the same widths, THE SYSTEM SHALL keep the ink at least 12 css px inside the glass on both sides, measured on ink pixels, not on rects. **e2e** (fails if it breaks), **prop** over widths 330 to 430
3. WHEN a line cannot meet 1 within `paneW - 2 * PAD_PX`, THE SYSTEM SHALL cut it at the widest interior ink column gap of at least 18 note px and stack the two parts in reading order at one shared scale. **unit**, **prop**
4. THE SYSTEM SHALL NOT lose or double any ink: the parts' ink rectangles tile the group's rectangle's inked columns. **prop**
5. THE SYSTEM SHALL support up to 4 group placements in the shader. **unit**

## R9. Quality governor

1. THE SYSTEM SHALL keep a rolling window of 60 frame intervals and SHALL raise the tier by one when the window is full and its p95 exceeds 18 ms, restarting the window. **unit**, **prop**
2. THE SYSTEM SHALL ignore intervals longer than 500 ms, and a single long frame SHALL NOT raise the tier. **prop**
3. AT tier 1 THE SYSTEM SHALL halve the fog-pass resolution; AT tier 2 it SHALL skip droplet, run, bead and breath detail; AT tier 3 it SHALL swap to `StaticPane` at the current phase through the lost-context path. **unit**
4. THE SYSTEM SHALL never lower the tier within a session. **prop**
5. THE SYSTEM SHALL expose the tier on `window.__steamStats.tier` and in the `?fps=1` overlay. **e2e**

## R10. StaticPane parity

1. THE SYSTEM SHALL regenerate every static pane image from the v1 renderer with `npm run static-panes` (`?bloom=0` for fogged and held). **frame**
2. WHEN `prefers-reduced-motion` is set or WebGL2 is missing, THE SYSTEM SHALL show these images with the opacity-only crossfade of v0 (existing tests stay green). **e2e**

## R11. Bench, five profiles

1. THE SYSTEM SHALL provide `scripts/measure-steam.ts` profiles `desktop-1280x720`, `desktop-1920x1080`, `pixel5-4x-cpu`, `swiftshader-1280x720` and `capture-1920x1080`, written to `bench/results.json`. **unit** (a test of the profile list and the row shape)
2. EACH row SHALL carry average fps, p5 fps, frames under 55, frame-time p50 and p95, the governor tier reached and the GPU renderer string. **unit**
3. THE SYSTEM SHALL keep the old JSON files and update `bench/README.md`. **unit**
4. THE bench SHALL keep v0's rules (mean >= 55 fps and no frame slower than 1000/55 ms for the budget rows; exit 1 otherwise).

## R12. Honesty and invariants

1. THE SYSTEM SHALL draw the writer's hand only as the scan's own pixels: strokes are level sets of the scan alpha; nothing is traced, generated or re-typeset. **unit** (shader never reads scan RGB), **frame**
2. THE SYSTEM SHALL keep the reveal-once (P7) and provenance (P8) tests green and SHALL NOT delete any property.
3. THE SYSTEM SHALL keep `uInk` clamp (`col = min(col, uInk)`) as the last composite step. **unit**
4. THE SYSTEM SHALL allocate nothing per frame in `frame` or `draw`. **unit** (existing guard)
