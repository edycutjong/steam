# Design: steam-renderer-v1

Status: design-first. Written before any v1 code. Builds on `.kiro/specs/steam-renderer/` (v0, still the source of the
timeline, layout and derive contracts) and `renderer-v0-frames/bugfix.md`. Evidence frames of v0.2 are in
`docs/kiro-evidence/renderer-v1/before/`; the v1 frames go to `.../after/`.

The renderer is the one moment the app is judged on: a dead writer's hand, c. 1750, wiped clear out of a fogged kitchen
window on All Hallows' night. This document replaces v0's "narrow threshold over the note alpha" look with a physical
model: glass, a film of condensation on it, and a room behind it.

## 0. What the v0.2 frames got wrong (the reviewer's seven findings)

| # | Finding | Cause in v0.2 | Fix in v1 |
|---|---|---|---|
| 1 | Letterforms crushed, "red & smooth" reads "ied Q vsnioothi" | `smoothstep(CLEAR_MID ± edgeHalf, aRaw)` turns the continuous scan alpha into a binary sticker; counters close, hairlines break | R1: monotone transmission over the whole alpha range, bicubic sampling |
| 2 | Flat orange sticker, no glass | the clear region is a flat ember fill | R2: refracted room behind clear glass, residual film, wet edge |
| 3 | White-yellow blob on "& sm" | pot gain stacked on the stroke ember | R2: colour (not channel) luminance cap, falloff of the pot light |
| 4 | Drips are static stalks | hash grid of vertical columns | R4: 3-6 seeded runs with motion |
| 5 | Moon is a flat disc, no night view | one CSS radial gradient | R6: SVG night view and candle |
| 6 | Fog is a flat grey card | one R8 density, one grey | R3: lit scattering layer, droplets as lenses |
| 7 | Phone note overflows by 1-16 px | forced 16 px core band scale > pane width | R8: gap groups cut at ink column gaps |

## 1. Physical model

Three layers, back to front, seen from the room:

1. **The room behind the glass** (not the garden: this is the haunting). Dark `--bg`, the pot's warm light rising from
   below, the candle's warm point light at the lower right, a few out-of-focus bright discs (bokeh) near the bottom.
   A function of screen position only, `room(uv)`.
2. **The glass with its film of condensation.** Opacity `d(x,y)` (pass 1 noise, 0..1) times `FOG_MAX`. The film is a
   scattering layer lit from inside the scene: cool backscatter from the moon above (`--moon`, `--ghost`, faint), warm
   scatter from the pot and candle below (`--after`, faint). Its brightness therefore has a vertical temperature gradient.
   Micro-droplets sit in it at three sizes. Each droplet is a lens: dark rim, the room's light refracted (inverted)
   inside, a catch-light on the moon side.
3. **The writer's hand.** The scan's ink darkness `a` (0..1, continuous) says how much of the film is removed:
   `T = trans(a) * wiped`. Where `T` is 1 the film is gone and the room shows; between, the film is thinned. The pen's
   pressure therefore shows as how clear the glass is. `trans` is monotone and continuous (R1).

Glass optics on top of the three layers:

- **Refraction.** The film's height field `h` (pass 1, second channel) has a gradient. The room lookup behind clear glass
  and inside droplets is offset by `REFRACT_PX * grad(h)`, 1 to 3 css px. This makes the clear glass look wet.
- **Wet edge.** The film is pushed aside by the finger and piles up: a denser, slightly brighter lip 1 to 2 css px wide
  just outside each stroke, lit from the moon side. The cold `--ghost` rim sits on the fog side of the edge only.
  Tiny beads hang under the lower edges of near-horizontal strokes.
- **Running water.** 3 to 6 runs per note start under the heaviest stroke bottoms after the stroke is written.
  Each accelerates, then stalls (optionally pauses and slides once more), leaves a clear trail that slowly re-fogs,
  carries a refracting bead head, and stops above the sill.
- **The writing head.** A cold fingertip glow at the time-of-ink frontier, with a breath: a soft puff around the head that
  thickens and cools the film and trails behind the head for about 0.4 s of the write-on.

"Nothing invented": the scan's pixels are the only source of any stroke shape. Every stroke edge is a level set of the
scan's own alpha, sampled smoothly. Nothing is traced, re-typeset or generated. Drips are glass physics under strokes,
not letters. The scan's RGB is still never drawn (v0 R7.5).

## 2. Passes and resources

Two passes, one composite. No pass earns its cost beyond these.

| Pass | Target | Size | Reads | Writes |
|---|---|---|---|---|
| 1 fog | `RG8` texture | canvas / `fogDiv` (4; 8 at governor tier 1) | nothing from the note | R = film density `d`, G = film height `h` |
| 2 composite | canvas | canvas (dpr capped at 2) | `uChan`, `uInk`, `uFog` | colour |

Textures:

| Unit | Name | Format | Filter | Content |
|---|---|---|---|---|
| 0 | `uInkTex` | `RG8`, mipmapped | `LINEAR_MIPMAP_LINEAR` / `LINEAR`, clamp | R: the scan's continuous ink alpha (`toi.png` R, 133 levels), the "derived channel": sampled bicubic at lod 0 and as a blur at lod `INK_LOD_BLUR`. G: alpha times time-of-ink, so the blurred G/R is the neighbourhood's own time-of-ink (the warm halo's wipe gate) |
| 1 | `uChan` | `RGBA8`, no mips | `LINEAR`, clamp | v0 channel: R alpha plus shoulder, G time-of-ink, B pressure, A hull feather (unchanged) |
| 2 | `uFog` | `RG8` | `LINEAR`, repeat | pass 1 |

The v0 `uNote` texture is no longer uploaded: the shader never read it (the scan's RGB is never drawn), so it only cost
memory.

### 2.1 Sampling the ink without stair-steps

`uInk` is sampled with a 5-tap Catmull-Rom (the 9-tap filter folded into bilinear fetches, corners dropped), so the
scan is magnified smoothly at 1.6x to 2.2x device px per note px. Mip levels are generated; lod 0 is used for the
stroke, lod `INK_LOD_BLUR` (a ~2 css px blur) for the wet-edge lip and the edge normal, which come from three taps
(centre, +x, +y), no extra pass.

### 2.2 Tap budget (tier 0, per fragment inside a group rectangle)

| Tap | Count |
|---|---|
| `uChan` (1 per group rect the fragment lies in; 2 where margins overlap) | 1 to 2 |
| `uInk` Catmull-Rom, winning group only | 5 |
| `uInkTex` blur for lip and normal (lod 1: centre, +x, +y) | 3 |
| `uInkTex` wide blur for the warm halo (lod 3) | 1 |
| `uFog` centre, +x, +y (density, height, refraction gradient) | 3 |
| **Total** | **13 typical, 14 worst case** |

Outside every group rect: 3 taps (`uFog`). The beads and the lip take no further taps. There is no per-fragment loop that samples a texture. ALU-only loops:
droplets (3 scales x 4 cells), runs (at most 6, rejected by one x test), breath (6 gaussians). Governor tier 2 turns the
droplet, run and breath loops off.

## 3. Transmission (R1)

```
trans(a) = smoothstep(TRANS_LO, TRANS_HI, a) ^ TRANS_GAMMA      TRANS_LO = 0.03, TRANS_HI = 0.97, TRANS_GAMMA = 0.75
T        = trans(a_bicubic) * wiped(toi)
```

- Monotone non-decreasing, continuous, `trans(0) = 0`, `trans(1) = 1`, with T between 5 % and 95 % over more than 0.6 of the alpha range.
- The constants were measured, not guessed: the first guess (0.04, 0.85, 0.8) clears 1.205 times the scan's ink area on the hero note, over the 1.15 bound, because the hero's alpha is mostly mid to dark (the histogram peaks at 0.5 to 0.7). (0.03, 0.97, 0.75) clears 1.043 times and keeps `T(0.15) = 0.08`.
  `src/steam/transmission.ts` holds the TS twin (and the Catmull-Rom the test uses); the GLSL is generated from the same constants.
- Hairlines (`a` about 0.1 to 0.3) become partly clear (`T` about 0.05 to 0.3): the pen's pressure shows.
- The old `CLEAR_MID`, `CLEAR_HALF*`, `EDGE_FOG_*` and `clearCurve` are removed. The "edge follows the fog density" idea
  (v0 D13) becomes the lip, which is physical.
- Coverage property: at 1x and 2x magnification (desktop 1.6x, phone 0.84 x 2 dpr), `sum(T) / sum(a)` over the hero note is between 0.85 and 1.15, so counters stay open. Checked by `hero.coverage.test.ts`.

The write-on front is v0's: `wiped = smoothstep((uU - toi) / (TOI_SOFT * FEATHER_K))` on `uChan.g`. Because the
transmission is continuous, a stroke clears in the shape of its own pen pressure as the front passes.

## 4. View through the glass (R2)

`room(uv)` returns light `L` (scalar) and a colour:

```
L   = POT_GAIN * pot(uv) * flicker + CANDLE_GAIN * candle(uv) * uCandle.z + FLOOR_GAIN * floorGlow(uv) + bokeh(uv)
rgb = uBg + uAfter * L
```

- `pot(uv)` is a gaussian of the aspect-corrected distance to `uPot` (below the pane, as v0).
- `candle(uv)` is a tighter gaussian around `uCandle.xy` (measured from the DOM flame, see section 7.3). `uCandle.z` is
  the flame intensity: flicker, and the dip of the haunting cue.
- `bokeh(uv)`: a jittered grid of soft discs (cell 70 css px, 2x2 cells), probability rising toward the bottom; the
  out-of-focus kitchen, only ever seen through clear glass and lenses. Brightness varies along a stroke.
- The seen colour is `room(uv + REFRACT_PX * grad(h) / res)`.
- Inside a stroke the colour is `uAfter * (EMBER_BASE + EMBER_GAIN * L)`, shaded by `T` (a thinner film is dimmer) and
  darkened by `EDGE_SHADE` in the meniscus band (`T(1-T)` peaks at the edge). It is never a flat fill.
- Luminance cap: after composition inside strokes, `col *= min(1, STROKE_LUMA_MAX / lum)` weighted by `smoothstep(0, 0.5, T)`.
  The cap scales the colour, so the `--after` hue survives. No blob near the pot because `L` is bounded by
  construction (`POT_GAIN` is tuned so the stroke peak sits under the cap before it is applied).
- The last step stays `col = min(col, uInk)` (v0 R4.1).

## 5. Condensation film (R3)

Pass 1 (`FOG_FRAG`) writes `d` and `h`: domain-warped 4-octave value noise as v0 for `d`, a second, smoother and
lower-frequency noise for `h`. Slow drift as v0. `uThicken` as v0. It reads nothing from the note, so the film outside the
hull is the same function as anywhere (v0 R6.2).

Film colour (composite):

```
film = uBefore * (FILM_BASE + FILM_D * d)
     + uMoon * COOL_A * (1 - y)^COOL_P                      cool backscatter from the moon above
     + uAfter * (WARM_POT * potFog + WARM_CANDLE * candleFog) * (0.4 + 0.6 d)   warm scatter from below
```
`FILM_*`, `COOL_*`, `WARM_*` are small constants (about 0.05 to 0.3 of a channel). Colours arrive as uniforms. There are
no colour literals in GLSL (v0 R14.9, `shaders.test.ts` checks).

Micro-droplets, three screen-space layers (cell, radius range in css px, probability at full film):

| Layer | Cell | Radius | Prob. | Role |
|---|---|---|---|---|
| tiny | 7 | 0.8 to 1.3 | 0.55 | frost sparkle: a bright pin and a dark pin |
| mid | 15 | 1.8 to 3.4 | 0.35 | the wet-glass read at 100% zoom |
| large | 38 | 3.5 to 6.5 | 0.16, x3 near the bottom rail | beads gathered at the rail |

Each cell holds one jittered droplet (jitter +-0.18 cell, radius at most 0.3 cell), so the 2x2 cells nearest the
fragment contain every droplet that can cover it: 4 hash evaluations per layer, 12 per fragment. Presence is
`hash < prob * smoothstep(0.3, 0.9, d) * (1 - smoothstep(0, 0.3, T))`: density follows the film and wiped glass has none.
Lens shading `lens(q)` with `q` the offset in radius units: mask `1 - smoothstep(0.88, 1, |q|)`; dark rim
`smoothstep(0.55, 0.95, |q|)`; interior `room` light inverted vertically (brighter at the top of the drop, because a drop
inverts the scene); a `--moon` catch-light at `(-0.38, -0.42)`; a faint `--after` caustic at the lower right.

Warm halo: the hand's light reaches into the film around each written stroke (`HALO_GAIN`), thinning it a little. One tap of
`uInkTex` at lod 3 gives the blurred alpha (R) and the blurred alpha times time-of-ink (G); G/R gates the halo by the
neighbourhood's own time, so a halo never shows before its stroke is written.

Cold bloom (R7): `uBloom` in 0..1, ~1.2 s, `--ghost` tinted; the film densifies from the pane edges inward, the front
wobbled by `h`. Zero in `?bloom=0` and under reduced motion (the static pane has none).

## 6. Wet edges and running water (R4, R5)

### 6.1 Lip and rim (no extra tap beyond section 2.2)

```
B     = ink blurred at lod INK_LOD_BLUR            (tap 1)
gradB = (B(+x) - B, B(+y) - B) / texel             (taps 2, 3)
out   = -normalize(gradB)                          outward from the stroke
lip   = smoothstep(LIP_LO, LIP_HI, B) * (1 - T) * wipedNear     wipedNear uses uChan.g (dilated 2 note px)
lit   = 0.5 + 0.5 * dot(out, MOON_DIR)             MOON_DIR = (-0.35, -0.94), y down
film  = film * (1 + LIP_BRIGHT * lip * lit);  opacity += LIP_DENSITY * lip
rim   = band of T in (0.01, 0.5), peak near 0.12     (fog side of the edge, T < 0.5)
col   = mix(col, uGhost, RIM_A * rim * (0.35 + 0.65 * lit))
```

Beads under lower edges: where `out.y > 0.6` (the edge faces down) a bead of radius 1.2 to 2.4 css px hangs at every
`BEAD_SPACING = 9` css px along the edge, found by signed distance `sd = (0.5 - B) / |gradB|` and the along-edge
coordinate, drawn with `lens(q)`. Heavier strokes (larger `a` mass in the blur) get larger beads. Governor tier 2 drops them.

### 6.2 Runs (`src/steam/drips.ts`, pure, seeded)

`planDrips(ink, toi, meta, seed)` chooses 3 to 6 candidates: for each group, each maximal vertical run of dark ink
(`a >= 0.6`) whose bottom has clear glass below (`a < 0.2` for the next 3 px) is a candidate, weighted by the ink mass of
the run (so the heaviest stroke bottoms win), jittered by a seeded hash, with at least 90 note px between picks.
`mass`, the group, the note position, `u0` (the toi at the candidate) and a seeded `delay` are stored.

`placeDrips(plan, layout, paneW, paneH)` maps runs to css px, limits each so its head stops at least `SILL_CLEARANCE_CSS`
(24) above the glass bottom and above any group below it, and drops runs shorter than 18 css px.

`dripDistance(run, tMs)` is the distance travelled: nothing until `tStart = u0 * WRITE_ON_MS + delay` (the stroke is
written first), then one or two segments, each `s(x) = len * smootherstep(x^0.7)` over its duration (accelerates quickly,
decelerates to a stall). Monotone, bounded by the run length, a pure function of the clock, so a frozen `?t=` frame is
reproducible. Uniforms per run: `uRunA = (x, y0, yHead, halfWidth)` and `uRunB = (headRadius, ageSinceStall, seed, 0)` in
device px. The shader draws a clear trail (width wobbles with `seed`, narrows toward the start, re-fogs with distance
behind the head and with age since the stall, `RUN_REFOG_S`), a lip along it, and a teardrop head with `lens(q)`.

### 6.3 Writing head and breath (R5)

`uHeadPos`, `uHeadGroup` as v0 give the frontier. The glow is `mix(uGhost, uMoon, 0.5) * HEAD_A` with a gaussian of
radius `HEAD_R`, capped so the head never exceeds `HEAD_MAX_LUMA` (never a white hotspot, never amber). Breath: the CPU
writes `uTrail[6]` (device px) from the head path at bins `bin - 12 k`, each weighted `0.78^k`; the shader sums 6
gaussians (radius `BREATH_R` css px). Breath raises the film opacity by `BREATH_DENSITY` and tints it toward `uGhost`;
it never reduces `T`, so a written stroke stays clear. Fresh strokes (small `uU - toi`) carry a short cold wet sheen
that settles into the steady ember.

## 7. The night view and the candle (R6, R7, DOM and SVG, no simulation)

### 7.1 `NightView.tsx` (upper sash)

One SVG, `viewBox 0 0 1200 300`, `preserveAspectRatio="xMidYMax slice"` (the horizon stays in view on a phone):

- `--night` sky with a vertical gradient toward `--bg`, 22 seeded faint stars.
- A low full moon at (760, 200), r = 58: halo (radial gradients in `--moon` and `--ghost` at low opacity), disc, faint maria
  from blurred ellipses clipped to the disc (`feGaussianBlur`; no raster).
- Bare branches: `branchPaths(seed)` (`src/steam/branches.ts`, pure, seeded recursive, no `Math.random`) returns paths;
  three main limbs enter from the left, upper left and upper right and cross the moon. Drawn as strokes in a colour mixed
  from `--bg` and `--night`.
- A thin cloud (blurred ellipses in `--ghost`, low opacity) drifting slowly (CSS animation, 90 s).
- The muntin: a DOM bar in `--rule` wood over the SVG, splitting the sash into two panes (the sky is continuous behind it).

### 7.2 Candle (`Candle.tsx`)

On the sill (the bottom rail), lower right, in front of the glass: an SVG wax body (`--paper` mixed with `--bg`) with
two runs, a dark wick, and a CSS flame (`--paper` core, a dim `--after` outer glow) that flickers by CSS keyframes. Under
`prefers-reduced-motion` it is still. No pumpkins, bats or clip-art.

### 7.3 Candle light to the shader

`SteamGlass` measures the flame element's centre relative to the canvas on mount and on every resize and calls
`renderer.setCandle(u, v)`. The renderer folds the intensity (flicker from `time`, dip from the haunt state) into `uCandle.z`.

### 7.4 Haunting cue (`src/steam/haunt.ts`, pure)

`hauntAt(tMs)` returns `{ bloom }` (shader) and `phase` data attributes drive the DOM:

| Phase | Moon / cloud | Candle | Hood lamp | Fog |
|---|---|---|---|---|
| calm (fogged) | moon out | steady | no | no bloom |
| gather (thickening, writing) | cloud slides over the moon (1.2 s ease), moon dims | leans 7 deg, flame low and fast, light x 0.45 | existing `LampDip` | `bloom` rises 0 to 1 over the 1.2 s thickening, relaxes to 0.45 during the write-on |
| clear (holding, wiped) | the cloud slides off, the moon returns | recovers | no | bloom eases to 0 over 1.5 s |

`startReveal()` from `fogged` now begins with the 1.2 s thickening (`revealStart = now + THICKEN_MS`), so the bloom, the
cloud and the candle precede the write-on. Reduced motion: no cloud slide, no candle motion, no bloom; the lamp dip and
the silence remain (existing tests).

## 8. Quality governor (R9, `src/steam/governor.ts`, pure)

Rolling window of 60 frame intervals. Intervals over 500 ms are ignored (hidden tab). When the window is full and its
p95 exceeds 18 ms the tier rises by one and the window restarts (a single long frame can never trigger: p95 of 60 needs
at least 4 slow frames).

| Tier | Effect |
|---|---|
| 0 | full |
| 1 | fog pass at `canvas / 8` |
| 2 | `uDetail = 0`: droplet, run, bead and breath loops skipped |
| 3 | `StaticPane` at the current phase (the lost-context path) |

`window.__steamStats = { tier, frames, avgFps, p95Ms, framesOver, renderer }` is updated at 4 Hz; the `?fps=1` overlay shows the tier.

## 9. Phone gap groups (R8)

`src/steam/gaps.ts` finds, per group, interior column gaps of the ink (note px) at least `GAP_MIN_PX` (18) wide, and the
time-of-ink range of the two parts. `computeLayout('groups', ...)` splits a group only when its whole line cannot meet
`MIN_CORE_CSS_PX` (16) inside `paneW - 2 * PAD_PX`. Both parts get the same scale (at least the minimum core band, at most
what fits the wider part) and are stacked in reading order. `src` of each part stops at the cut so it never carries the
neighbour's ink. At 390 to 393 css px each core band is at least 16 css px and the ink keeps at least 12 css px of clear
glass on both sides. The renderer's group arrays grow from 2 to 4.

## 10. Static panes (R10)

`scripts/render-static-panes.ts` is unchanged in flow; it now opens the pane with `?bloom=0` (new, ignored elsewhere) for
`fogged` and `held`, and screenshots the v1 canvas. Reduced motion and no-WebGL2 users see the v1 look.

## 11. Performance and budgets

- 60 fps on desktop GPUs at 1280x720 and 1920x1080 (dpr 1); tap budget in section 2.2.
- At most 55 fps average with zero frames under 55 on desktop and a Pixel 5 at 4x CPU throttle remains the project's
  budget (`tech.md`); the governor is the safety net, and `bench/results.json` records the tier reached per profile.
- Nothing is allocated per frame (`renderer.test.ts` guard: `frame` and `draw` contain no `new`, arrow function or array literal).
- The fog pass costs 1/16 of the canvas at tier 0, 1/64 at tier 1.

## 12. Correctness properties

Each is a test (vitest or fast-check) unless marked "frame".

1. **P-T1 monotone** (fast-check): `a1 <= a2` implies `trans(a1) <= trans(a2)`; the result is in [0, 1]; `trans(0) = 0`, `trans(1) = 1`.
2. **P-T2 continuous** (fast-check): `|trans(a + e) - trans(a)| <= K * e` with `K = 2.5`.
3. **P-T3 open counters** (hero note, bicubic at 2x and 1x): `sum(T) / sum(a) <= 1.15` and `>= 0.85`.
4. **P-C1 Catmull-Rom** (fast-check): weights sum to 1, interpolate texel centres exactly, output within [0, 1] after the clamp.
5. **P-D1 drips are deterministic** (fast-check): `dripDistance(run, t)` is a pure function of its arguments.
6. **P-D2 drips are monotone and bounded**: `t1 <= t2` implies `d(t1) <= d(t2)`; `0 <= d <= run.length`; the head never reaches the sill clearance.
7. **P-D3 plan**: 3 to 6 runs for the hero note; the same plan for the same seed; every start lies on dark ink with clear glass below; no drip starts before its stroke is written (`tStart >= u0 * WRITE_ON_MS`).
8. **P-G1 governor**: tier never decreases; a single long frame (any duration) never raises the tier; a full window with p95 over 18 ms raises it by exactly one and restarts the window.
9. **P-H1 haunt**: `bloom` in [0, 1] for all `t`, 0 at `t <= -THICKEN_MS` and for `t >= WRITE_ON_MS + 1500`; continuous.
10. **P-B1 branches**: `branchPaths(seed)` is deterministic and finite, all coordinates inside a bound, and uses no `Math.random`.
11. **P-L1 layout, phone**: for widths 330 to 430 css px every placed group has core band >= 16 css px and the placed ink lies at least 12 css px inside the pane on both sides; the parts of a split group are stacked in reading order and cover the group's rect exactly (no ink lost, none doubled).
12. **P-S1 shader hygiene**: no colour literals in GLSL; no unresolved `${`; `STROKE_LUMA_MAX / max(lum` is present; the composite declares `uCandle`, `uBloom`, `uDetail`.
13. **P-7 / P-8 (existing)**: reveal-once and provenance stay green. Not touched by v1.
14. **Frame properties** (Playwright, swiftshader): no pixel brighter than `--ink`; no stroke pixel over 92 % luminance with the ember hue surviving; the phone ink clearance (P-L1) measured on the ink; the canvas shows no rectangle around the crop (edge step within plain-fog variation).

## 13. Not in v1

Sound, true fluid simulation, per-device tuning, a Web Worker for `derive` (still owed from v0 task 39), refraction of
the scan itself (the hand is quoted, never distorted).
