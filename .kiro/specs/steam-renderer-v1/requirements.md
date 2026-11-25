# Requirements: steam-renderer-v1

Derived from `design.md`. "The system" is the steam pane (`SteamGlass`, `SteamRenderer`, `NightView`, `Candle`, `StaticPane`).
Section references (§) point to `design.md`. Each acceptance criterion names the check: **unit** (vitest), **prop** (fast-check),
**e2e** (Playwright on the production build, software GL), **frame** (a captured PNG in `docs/kiro-evidence/renderer-v1/after/`
judged against `before/`; look pass 3 frames are in `after/`, the pass-2 frames in `v1b/`).

## R1. Ink-darkness transmission

**User story:** As a viewer, I want the writer's pen pressure to show in the glass, so that the hand reads as handwriting, not a sticker.

1. THE SYSTEM SHALL compute how clear the glass is as `T = trans(a) * wiped`, with `trans(a) = smoothstep(0.03, 0.97, a)^0.9` (tuned on the hero's alpha histogram: the first guess 0.04, 0.85, 0.8 failed the coverage bound; look pass 3 moved the exponent from 0.75 to 0.9, which takes the measured ratio from 1.108 to 1.020 and opens the counters) over the scan's continuous alpha `a` (§3). **unit**
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
4. THE SYSTEM SHALL gather droplets toward the sill: at least 1.5x as many droplet pixels in the last 7 % of the pane height as in the middle band (the large layer is boosted 3x there; the e2e test measures it). **e2e**
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

## R13. Running water (look pass 2)

**User story:** As a viewer, I want the runs under the hand to look like water on glass, so that they do not read as sticks.

1. THE SYSTEM SHALL place 2 to 4 runs on a pane wider than 640 css px and 1 to 3 on a narrower one, chosen by ink mass, with no more than one run per word-sized stretch (starts at least 90 note px apart). **unit**
2. THE SYSTEM SHALL give every run a length between 0.7 and 2.0 times the height of its group's core band (or the room it has, if less), except at most one run per pane, which may reach 3.4 times. **unit**
3. THE SYSTEM SHALL bend every run longer than one core-band height by a seeded path: `runOffset(run, dy)` is 0 at the start, bounded by `amp + lean * dy`, with `amp` between 1.2 and 4 css px and `lean` within +-0.05, and is a pure function of its arguments. **prop**
4. THE SYSTEM SHALL draw the trail as a thin clear channel through which the room and the night are seen (darker than the film beside it, never a brown solid), wider at its start (the lip), and SHALL re-fog it from its top with the age since the stall. **frame**
5. THE SYSTEM SHALL draw the head as a lens bead at least 1.6 times the trail's half-width: dark rim, warm inverted light, one small catch-light, and no white dot. **unit** (constants), **frame**
6. THE SYSTEM SHALL scale run widths, bead radius and wobble with the pane (phone smaller than desktop). **unit**

## R14. Strokes as cleared glass (look pass 2)

1. THE SYSTEM SHALL draw the cold rim on the fog side of the edge only, no wider than 1 css px at dpr 1 (`RIM_PX`), and SHALL break it with the film height so that it is not a continuous outline. **unit** (constant), **frame**
2. THE SYSTEM SHALL reduce the halo to a faint warm spill: `HALO_GAIN` at most half of v1's 0.4, so that it does not read as an outline. **unit**
3. THE SYSTEM SHALL let the fill vary with the scan's ink darkness (`PRESSURE_*`): thick dark strokes are the clearest and warmest, hairlines dimmer and cooler. **e2e** (the stroke luminance spread of R2.3 is re-pinned higher), **frame**
4. THE SYSTEM SHALL keep the luminance cap of R2.4 and R2.5 and the transmission of R1. **e2e**, **prop**

## R15. Phone composition (look pass 2)

1. AT widths 390 and 393 css px, THE SYSTEM SHALL place the groups so that the block of ink fills at least 55 % of the glass height and its centre lies above the pane's middle (between 2 % and 8 % of the height above it; the e2e accepts 1 % to 8 % because it measures ink pixels). **unit** (on the hero's metadata), **e2e**
2. THE SYSTEM SHALL keep R8.1 and R8.2 (core band at least 16 css px, at least 12 css px of glass to both sides). **e2e**
3. THE SYSTEM SHALL gather droplets toward the sill less than v1: the boost of the large layer is at most 1.6, the large lens shrinks toward the sill and every lens takes 0.6 of the room's warm light. **unit** (constants), **e2e** (R3.4 re-pinned from 1.5 to 1.1), **frame**
4. WHERE the pane is narrower than 640 css px, THE SYSTEM SHALL draw the candle at most 70 % of its desktop height (the CSS gives under half), and SHALL keep it clear of the ink block (no overlap of rectangles). **e2e**
5. THE SYSTEM SHALL keep the phone-fit e2e green at 390 and 393. **e2e**

## R16. A film with a history (look pass 2)

1. THE SYSTEM SHALL add to pass 1 a static, seeded layer of old finger-wipes (a few thin arcs where the film is thinner and has re-fogged) and a density variation at a larger scale than v1's. **unit** (GLSL), **frame**
2. THE SYSTEM SHALL keep the film a function of position and time only, with no read of the note (v0 R6.2), and SHALL NOT let the old wipes form letter-like shapes (arcs only, density change at most 0.12). **unit**
3. THE SYSTEM SHALL keep the old wipes subtle: they SHALL NOT change the mean luminance of the pane by more than 4 levels (e2e R3.1 holds). **e2e**

## R17. The streak (look pass 2)

1. THE SYSTEM SHALL NOT draw a diagonal light streak over the upper film (it was not motivated by the moon's position). **unit** (GLSL), **frame**

## R18. The moon stays whole (look pass 2)

1. FOR a desktop pane 600 to 1080 px tall at widths 1024 to 1920, and on the Pixel 5 (393 x 851), THE SYSTEM SHALL keep the whole moon disc inside the upper sash. **e2e** (bounding box of the disc inside the sash's box)
2. THE SYSTEM SHALL keep the moon on one side of the muntin. **e2e**

## R19. The stroke is a window (look pass 3)

**User story:** As a viewer, I want a stroke to look like glass cleared by a finger, so that I see the room through it and not an orange paint.

1. THE SYSTEM SHALL show inside a cleared stroke the room behind the glass: a darker room gradient, the pot's glow, the candle's glow and out-of-focus discs at two scales (cell 72 and cell 22 css px), looked up at a position refracted by up to `WINDOW_REFRACT_CSS` (3) css px along the edge normal. **unit** (GLSL names and constants), **frame**
2. THE SYSTEM SHALL let brightness and hue vary inside every thick stroke: the 5th to 95th percentile luminance spread over the hero's stroke pixels at `t = 6500` is at least 40 levels (re-pinned from 30), the ember hue survives (red above green above blue in at least 300 stroke pixels) and the luminance cap of R2.4 holds. **e2e**
3. THE SYSTEM SHALL NOT darken the inside of a stroke at its edge: `EDGE_SHADE` and the inner-edge shade are removed from the GLSL. **unit**
4. THE SYSTEM SHALL draw the edge as a thin meniscus: a fine highlight (`MENISCUS_PX` at most 1.2 css px) on the side facing the lamp (`LAMP_DIR`), a slight shade on the far side, both broken by the film height, and beads under at most 40 % of lower edge stretches. THE SYSTEM SHALL NOT draw a continuous outline. **unit**, **frame**
5. THE SYSTEM SHALL NOT threshold the ink alpha anywhere (R1.4 holds). **unit**

## R20. Legible cold, and the reading under the pane (look pass 3)

1. ON a desktop pane of 1236 x 345 css px THE SYSTEM SHALL place the hero note at least 15 % larger than look pass 2 (scale at least 1.84), centred within 1 css px, with at least 24 css px of clear glass above the bottom rail. **unit** (layout)
2. THE SYSTEM SHALL keep `sum(T) / sum(a)` between 0.85 and 1.15 (R1.5) and SHALL NOT let the halo or the lip fill a counter: `HALO_GAIN` at most 0.06 and `LIP_DENSITY` at most 0.05. **unit**
3. WHEN a note's phase becomes `holding` THE SYSTEM SHALL show the reviewed reading of the note under the pane (Literata italic, `--muted`; a disagreement as the existing † marks), and SHALL NOT show it before the write-on ends or after the wipe starts. The text is announced once, by the existing live region; the visible copy is `aria-hidden`. **unit**, **e2e** (shown at `t = 6500`, absent at `t = 2000`)
4. THE SYSTEM SHALL NOT typeset the reading on the glass: the glass shows only the scan's pixels. **unit** (the reading is DOM text outside the canvas)
5. THE SYSTEM SHALL keep the phone-fit e2e (R8) green. **e2e**

## R21. Something unseen is writing (look pass 3)

1. WHILE the phase is `writing` THE SYSTEM SHALL draw a fingertip-width wet smear at the position of the path `FINGER_LEAD_MS` (250 to 350 ms) ahead of the time-of-ink frontier: clearer glass, a soft cold highlight on its moon side, added luminance at most `HEAD_MAX_LUMA`, never amber, never a white hotspot. **unit** (`fingerU`, constants), **frame**
2. WHEN the write-on starts THE SYSTEM SHALL pulse the film: `breathAt(t)` is in [0, 1], 0 for `t <= 0` and for `t >= 1500`, reaches its peak between 100 and 600 ms, and thickens and cools the film. **prop**, **unit**
3. WHILE the phase is `thickening` THE SYSTEM SHALL thicken the film from the pane edges, bloom a faint cold breath around the point where the writing will start, and dip the candle: at `t = -600` the edge band is at least 3 levels different in mean luminance from `t = -1500`, and `candleDipAt(-600)` is at least 0.5. **e2e**, **unit**
4. WHILE the phase is `thickening` or `writing` THE SYSTEM SHALL lean the candle's flame toward the writing head (toward the path's start while thickening): `candleLean(headX, candleX, paneW, cueOn)` is in [-1, 1], has the sign of `headX - candleX` and is 0 when the cue is off; the flame's rotation follows it. **prop**, **e2e** (`--lean` is non-zero at `t = 2000`, 0 at `t = 6500`)
5. WHILE the phase is `thickening` or `writing` THE SYSTEM SHALL slide the cloud across the moon: `cloudShiftAt(t)` is non-decreasing in `t`, is over the moon's centre between `t = 1000` and `t = 5000`, and is clear of the moon by the hold plus 3 s. THE SYSTEM SHALL NOT slide it under `prefers-reduced-motion`. **prop**, **e2e**

## R22. The frame set (look pass 3)

1. THE SYSTEM SHALL capture desktop and phone at the same four moments (`t = -600, 2000, 4000, 6500`): eight frames, named `desktop-t<ms>.png` and `mobile-t<ms>.png`. **unit** (the list), **frame**

## R23. The moon is a moon (look pass 3)

1. THE SYSTEM SHALL draw the disc with a soft limb (limb darkening, a blurred edge and a halo), and its maria as procedural low-contrast mottling (`feTurbulence`), not ellipses. **unit** (DOM), **frame**
2. THE SYSTEM SHALL NOT let two symmetric dark blobs sit above a third inside the disc: the DOM has no `<ellipse>` in the moon group. **unit**
3. THE SYSTEM SHALL draw branches tapered and crooked, none crossing the disc's centre (no sample of any branch within 0.45 of the moon's radius from its centre; a thin twig across an edge is allowed). **prop**

## R24. The candle stands on the sill (look pass 3)

1. THE SYSTEM SHALL stand the candle on a ledge at least 1.8 times its width, that projects over the bottom rail (proud of the frame). **unit**, **e2e**
2. THE SYSTEM SHALL draw irregular wax with at least one drip, and a flame that flickers by a function of the render clock only: under `?t=` two captures at the same `t` are identical. **unit**, **e2e**
3. THE SYSTEM SHALL spill a warm bloom from the flame onto the rail and the glass beside it. **frame**

## R25. Runs are lighter channels (look pass 3)

1. THE SYSTEM SHALL draw a run's channel lighter than the film beside it (the room seen through clear glass), ending in a bright lens bead, with lengths that vary. THE SYSTEM SHALL start a run under its stroke and SHALL NOT draw it over ink (`T` above 0.15 hides it). **unit** (GLSL and constants), **frame**

## R26. Droplets obey gravity (look pass 3)

1. THE SYSTEM SHALL make droplets fewer and finer at the top and larger and clustered lower: droplet pixels in the top third of the pane are at most 0.6 times those in the bottom third at `t = -1000` and dpr 1. **e2e**
2. THE SYSTEM SHALL draw lenses with a dark rim and a small catch-light, and give a lens warm light only in proportion to the room light at its place. **unit**

## R27. Neutral edge condensation (look pass 3)

1. THE SYSTEM SHALL NOT shift the hue of the film at the pane edges: the mean of `(g - b)` over a 4 % band at the left, right and top edges is within 3 levels of the mean over the band just inside it (8 to 12 % in) at `t = -3000` (the pane centre is warmed by the pot by design). **e2e**

## R28. The window frame (look pass 3)

1. THE SYSTEM SHALL draw rails and muntins with a bevel, a putty line against the glass and a soft inner shadow, in gradients only (no 1 px border, R5.5). **unit** (CSS), **frame**
2. THE SYSTEM SHALL show the button label at a contrast of at least 4.5:1 against the button in every state. **unit**
