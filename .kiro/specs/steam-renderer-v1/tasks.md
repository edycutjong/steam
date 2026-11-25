# Tasks: steam-renderer-v1

Ordered by dependency. Each task is one commit `[kiro] steam-renderer-v1: <task n> …`. Requirement numbers refer to
`requirements.md`. Every task leaves `npm test`, `npm run typecheck` and `npm run lint` green. `npx playwright test` and
`npm run build` are green at the end (task 12); tasks that legitimately change an e2e expectation update it in the same commit.

- [x] 1. Transmission and the continuous ink texture (R1)
  - `src/steam/transmission.ts`: `TRANS_LO/HI/GAMMA`, `trans(a)`, a TS Catmull-Rom (`catmullRom1D`, `sampleCatmull`) mirroring the GLSL.
  - `derive.ts`: add `ink: Uint8Array` (toi R, w*h). `renderer.ts`: upload `uInk` as `R8` with mipmaps, `uNote` upload removed.
  - `shaders.ts`: composite reads the ink through a 5-tap Catmull-Rom and clears by `T = trans(a) * wiped`; v0's `clearCurve`, `CLEAR_*` and `EDGE_FOG_*` removed.
  - Tests: `transmission.test.ts`, `transmission.prop.test.ts` (P-T1, P-T2, P-C1); `hero.coverage.test.ts` re-pinned to P-T3; `renderer.test.ts` and `shaders.test.ts` follow.
  - Satisfies: R1.1 to R1.5, R12.1.

- [x] 2. Film, room and droplets (R2, R3)
  - Pass 1 writes `RG8` (`d`, `h`). `shaders.ts`: `room(uv)` with pot, candle (`uCandle`) and bokeh; refraction by `grad(h)`; film colour with cool/warm scatter; three droplet layers as lenses; the luminance cap kept; `uDetail`.
  - Remove v0 `addBeadsAndStreak` beads and the hash-grid droplets; keep a quiet glass sheen.
  - Tests: `shaders.test.ts` (constants, hygiene P-S1, no colour literals), e2e `steam-visual.spec.ts` bead and streak tests re-pinned to R3.3 and R3.4.
  - Satisfies: R2.1 to R2.6, R3.1 to R3.5.

- [x] 3. Wet edges, beads and running water (R4)
  - `src/steam/drips.ts` (`planDrips`, `placeDrips`, `dripDistance`, `dripState`) with `drips.test.ts` and `drips.prop.test.ts` (P-D1 to P-D3).
  - Shader: lip and rim from the blurred ink and its gradient, beads under lower edges, run trail and teardrop head from `uRunA`/`uRunB`.
  - Renderer: runs placed on resize, uniforms written per frame without allocation.
  - Satisfies: R4.1 to R4.8.

- [x] 4. The writing head and its breath (R5)
  - Shader: capped cold fingertip glow, `uTrail[6]` breath, fresh-stroke sheen. Renderer: trail positions from the head path.
  - Satisfies: R5.1 to R5.3.

- [x] 5. The night view and the candle (R6)
  - `branches.ts` (+ `branches.prop.test.ts`), `NightView.tsx`, `Candle.tsx`, a `SashFrame` that `SteamGlass` and the empty pane in `PaneStage` share; CSS in `steam.css`. `renderer.setCandle`.
  - Tests: `NightView.test.tsx` (stars, muntin, no image, branches), `Candle.test.tsx` (flame, reduced motion).
  - Satisfies: R6.1 to R6.6.

- [x] 6. The haunting cue completed (R7)
  - `haunt.ts` (+ `haunt.test.ts`, `haunt.prop.test.ts`), `uBloom`, `?bloom=0`, `data-haunt` on the sash and candle, `startReveal` from fogged begins with the 1.2 s thickening, candle light intensity.
  - Satisfies: R7.1 to R7.5.

- [x] 7. Phone gap groups (R8)
  - `gaps.ts` (+ `gaps.test.ts`), layout split, group arrays 2 → 4 in the shader and renderer, `layout.prop.test.ts` (P-L1), e2e `steam-phone-fit.spec.ts` measuring core band and ink clearance at 390 and 393 css px.
  - Satisfies: R8.1 to R8.5.

- [x] 8. Quality governor (R9)
  - `governor.ts` (+ tests, P-G1), renderer wiring (fog div, `uDetail`, static fallback through `onContextLost`), `window.__steamStats`, overlay line.
  - Satisfies: R9.1 to R9.5.

- [x] 9. Look pass on the real frames
  - Capture, look, tune constants (transmission, film, lip, droplets, ember) up to three passes. `docs/kiro-evidence/renderer-v1/after/` and `NOTES.md`.
  - Satisfies: R1.6, R2.3, R2.5, R4.7 and the frame criteria.

- [x] 10. Static panes from v1 (R10)
  - `npm run static-panes` with `?bloom=0`; commit the webp files.
  - Satisfies: R10.1, R10.2.

- [x] 11. Bench, five profiles (R11)
  - `scripts/measure-steam.ts` profiles and rows, `bench/results.json` writer, `scripts/measure-steam.profiles.test.ts`, `bench/README.md`. Not run here.
  - Satisfies: R11.1 to R11.4.

- [x] 12. Whole suite green
  - Update e2e expectations v1 legitimately changes; `npm test`, `typecheck`, `lint`, `build`, `npx playwright test`.
  - Satisfies: R7.5, R10.2, R12.2 to R12.4.

## Look pass 2 (R13 to R18)

Recorded after the fact: the commit messages of 8034395 and 57ab916 say "tasks 13-19" but the task list never landed (ca30636 rewrote this file).
Each line names the commit that did the work.

- [x] 13. Running water (R13) — `57ab916` (`drips.ts` plan, bent seeded path, clear channel with lip, lens bead, re-fog from the top).
- [x] 14. Strokes as cleared glass (R14) — `57ab916` (thin broken rim, faint halo, pressure fill); `5597d4c` re-pinned the e2e (stroke spread 12 to 30, rim 60 to 72, variance 1.6 to 1.3).
- [x] 15. Phone composition (R15) — `57ab916` (all-parts layout, lift, sill droplets, small candle); `5597d4c` phone parts and the composition, candle and moon e2e.
- [x] 16. A film with a history (R16) — `57ab916` (`oldWipes`, broad density noise in pass 1).
- [x] 17. The streak goes (R17) — `57ab916`; `5597d4c` inverted the streak check.
- [x] 18. The whole moon (R18) — `57ab916` (`nightViewBox`, `NightView` measures its svg).
- [x] 19. Frames, static panes, NOTES, suite green (R10, R13 to R18) — `61028bb` (static panes re-rendered, design section 14), `f6d2ef8` (frames after look pass 2, NOTES, suite).

## Look pass 3 (R19 to R28): the go/no-go retry

The judge scored look pass 2 at 6.5/10 on desktop and phone (gate 7). Frames of that pass are kept in `docs/kiro-evidence/renderer-v1/v1b/`.
The shader budget does not grow in textures: the window, the finger smear and the breath are ALU only (design section 15).

- [x] 20. Spec look pass 3 and the frame set (R22)
  - This section, `requirements.md` R19 to R28, `design.md` section 15; `docs/kiro-evidence/renderer-v1/after` moves to `v1b`; `scripts/capture-renderer-frames.ts` takes its list from `e2e/helpers/frames.ts` (eight frames: both viewports at t = -600, 2000, 4000, 6500).
  - Satisfies: R22.

- [x] 21. The stroke is a window (R19)
  - Shader: `windowLight` (room gradient, pot, fine and coarse bokeh, candle discs) seen through the stroke, refracted by the edge normal; `EDGE_SHADE` and the inner shade removed; the meniscus (lamp-side highlight, far-side shade, broken, a few beads).
  - Satisfies: R19.

- [x] 22. Legible cold, and the reading under the pane (R20)
  - Desktop scale up and centring, halo and lip reduced so counters stay open, transmission checked against `hero.coverage.test.ts`; the reviewed reading under the pane when the note holds (harness pane and Cook Mode).
  - Satisfies: R20.

- [ ] 23. Something unseen is writing (R21)
  - Finger smear leading the ink, breath pulse at the start of the write-on, the pre-reveal frame (edge thickening, cold breath at the starting point, candle dipping), candle lean toward the head, cloud crossing the moon during the write-on.
  - Satisfies: R21.

- [ ] 24. Moon and branches (R23)
  - Soft limb, procedural mottling in place of ellipses, tapered crooked branches clear of the disc's centre.
  - Satisfies: R23.

- [ ] 25. Candle on a sill ledge (R24)
  - Ledge proud of the frame, irregular wax with a drip, flame flicker deterministic under `?t=`, warm bloom on the rail and glass.
  - Satisfies: R24.

- [ ] 26. Runs, droplets, edge tint (R25, R26, R27)
  - Lighter channel ending in a bright bead, never over ink; gravity-weighted dark lenses; neutral edge condensation.
  - Satisfies: R25, R26, R27.

- [ ] 27. Window frame and label contrast (R28)
  - Bevel, putty line and soft inner shadow in gradients; the button label at 4.5:1 or more.
  - Satisfies: R28.

- [ ] 28. Look rounds, static panes, NOTES, suite green
  - At least three capture rounds against items 1 to 11; `npm run static-panes`; NOTES "Look pass 3 (go/no-go retry)"; `npm test`, `typecheck`, `lint`, `build`, `npx playwright test`.
  - Satisfies: R10, R19 to R28.
