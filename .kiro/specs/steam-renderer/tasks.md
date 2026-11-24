# Tasks: steam-renderer

Order follows dependencies: pure logic with tests first, then GL, then React, then measurement. Requirement numbers refer to `requirements.md` (R7.2 = requirement 7, criterion 2). Tests sit beside code as `*.test.ts`; property tests as `*.prop.test.ts`.

- [x] 1. Project check and dev dependencies
  - Check that `package.json` has Vite 8, React 19, TypeScript strict, and a `test` script. Add what is missing: `npm i zod`, `npm i -D vitest fast-check @playwright/test`.
  - Files: `package.json`, `package-lock.json`, `vitest.config.ts` (only if missing).
  - Satisfies: R14.1, R22.3.

- [x] 2. Timing constants and `revealState`
  - Create `src/steam/timeline.ts` with `LEAD_MS`, `THICKEN_MS`, `WRITE_ON_MS`, `WIPE_MS`, `REFOG_MS`, `HEAD_FADE_MS`, `TOI_SOFT`, the `Phase` and `RevealState` types, and `revealState(tMs, wipeAtMs)` as in design §2.
  - Files: `src/steam/timeline.ts`.
  - Satisfies: R2.1, R2.3, R3.1, R3.2, R3.5, R3.6, R3.7, R8.4, R9.3.

- [x] 3. Timeline unit tests
  - Test the state at each boundary: `t = -THICKEN_MS - 1`, `-THICKEN_MS`, `-1`, `0`, `WRITE_ON_MS - 1`, `WRITE_ON_MS`, `wipeAt - 1`, `wipeAt`, `wipeAt + WIPE_MS`, `wipeAt + WIPE_MS + REFOG_MS`.
  - Test: `u === -1` for all `t < 0`; `u === t / WRITE_ON_MS` while writing; `u === 1` at and after `WRITE_ON_MS`.
  - Test monotonic `u`, `thicken`, `wipe` over a sweep of `t`.
  - Test holding never lowers `u`, and `refog` stays 0 before the wipe sweep ends.
  - Test NaN, `Infinity`, `-Infinity`; `wipeAt < WRITE_ON_MS` clamps; `WRITE_ON_MS <= 6000`; `THICKEN_MS <= LEAD_MS`.
  - Files: `src/steam/timeline.test.ts`.
  - Satisfies: R1.1, R2.1, R2.3, R3.2 to R3.7, R9.1.

- [x] 4. Timeline property test (fast-check)
  - Property A: for any `t` (`fc.double` including NaN and infinities) and any `wipeAt` (`null` or double), the state is valid: `u` in [-1, 1], other fields in [0, 1], phase is one of five.
  - Property B: for any `t1 <= t2` and a fixed `wipeAt`, the revealed fraction `u` and `wipe` never decrease, and phase index never decreases.
  - Property C: for any `t >= WRITE_ON_MS` and any `wipeAt`, `u === 1` (hold never re-fogs the note).
  - Files: `src/steam/timeline.prop.test.ts`.
  - Satisfies: R3.3, R3.4, R9.1, R9.2.

- [x] 5. URL parameter parsing
  - Create `parseParams(search, hash)` returning `{ t: number | null, lead: number, fps: boolean }`. `location.search` wins over the hash query. Ignore non-finite, missing, negative `lead`, and `fps` values other than `1`.
  - Add `params.test.ts`: defaults, negative `t`, bad values, precedence, `t` overriding `lead`.
  - Files: `src/steam/params.ts`, `src/steam/params.test.ts`.
  - Satisfies: R1.4, R2.5, R16.1 to R16.5.

- [x] 6. Layout: types and `chooseLayout`
  - Create `src/steam/layout.ts` with constants (`MARGIN_PX`, `PAD_PX`, `MIN_CORE_CSS_PX`, `PHONE_MAX_W`, `GROUP_GAP_CSS`, `S_MAX`), the `GroupPlacement` and `Layout` types, and `chooseLayout(paneW)`.
  - Files: `src/steam/layout.ts`.
  - Satisfies: R11.1, R12.1.

- [x] 7. Layout: `computeLayout` for `page` and `groups`
  - Implement the desktop uniform scale and the phone per-group scale with the `fits` flag. Order groups by `t[0]`. Inflate `src` by `MARGIN_PX` and clamp to the note size.
  - Files: `src/steam/layout.ts`.
  - Satisfies: R11.2, R11.3, R11.4, R11.6, R12.1, R12.2.

- [x] 8. Layout unit tests
  - Use the real group data (rect 781,32,1219,93 / coreBand 46..81; rect 31,85,496,145 / coreBand 109..143; size 1251×177).
  - Phone at 390 and 360 px wide: both groups `coreBandCssPx >= 16`, `fits === true`, `dst` right edge plus `PAD_PX` ≤ pane width, groups ordered A then B and not overlapping.
  - Desktop at 1440×900, 1024×768, 800×600: inked rect fits within the pane, relative positions equal the page's, scale ≤ 1.25.
  - Very narrow width (for example 200): `fits === false` and core band still ≥ 16.
  - Resizing across 640 changes the kind.
  - Files: `src/steam/layout.test.ts`.
  - Satisfies: R11.1 to R11.5, R12.1 to R12.3.
  - Note: design §3 quotes 342/438 at 390 px (24 px each side); with `PAD_PX = 16` the code gives 358/438 (0.817) and 358/465 (0.770). Tests assert the `PAD_PX` formula. `GroupPlacement` gained an `inked` rect (dst without margin) so fit checks do not count the transparent margin.

- [x] 9. Layout property test
  - For any pane width in [320, 2560] and height in [400, 1600], the result has finite numbers, `src` inside the note, and in phone mode every `coreBandCssPx >= 16`.
  - Files: `src/steam/layout.prop.test.ts`.
  - Satisfies: R11.2, R11.3, R11.6.

- [x] 10. Asset schema (zod)
  - Add `NoteMeta` to `src/steam/assets.ts` (or a sibling schema block in the same file) per design §4. Strip unknown keys. Include the cross-field checks (rects inside `size`, `coreBand` inside rect, `t` ordered, group time ranges not overlapping).
  - Files: `src/steam/assets.ts`.
  - Satisfies: R17.2, R17.3, R17.5.

- [x] 11. Asset schema unit tests
  - Accept the real `public/hero/note-looks-red-smooth.json` (read it with `fs` in the test), including its extra spike keys.
  - Reject: missing `groups`, wrong `size` type, `rect` outside `size`, `coreBand` outside the rect, `t` of `[0.6, 0.4]`, `t` above 1, overlapping group ranges, empty `groups`. Assert that the error names the failing path.
  - Files: `src/steam/assets.test.ts`.
  - Satisfies: R17.2, R17.3, R17.5.

- [x] 12. Asset loader
  - Implement `loadNoteAssets(baseUrl, signal)`: fetch the JSON and validate it; decode the note with `createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`; read the note and toi bytes through an `OffscreenCanvas` (or a canvas) with `willReadFrequently`; check both sizes equal `meta.size`; throw `AssetError` with a field name.
  - Files: `src/steam/assets.ts`.
  - Satisfies: R17.1, R17.4, R17.6, R17.7.

- [x] 13. Derive: channel alpha, toi propagation, pressure
  - Implement the disc dilation, nearest-ink toi and pressure propagation, and separable box softening, into preallocated arrays. Blend 12% scan darkness into pressure.
  - Files: `src/steam/derive.ts`.
  - Satisfies: R7.2, R7.7, R18.1, R18.2.

- [x] 14. Derive: hull distance and feather
  - Implement the two-pass chamfer distance outside the dilated hull (`HULL_DILATE_PX = 6`) and the feather (`HULL_FEATHER_PX = 24`) into the A channel.
  - Files: `src/steam/derive.ts`.
  - Satisfies: R6.3, R18.1.

- [x] 15. Derive: head table
  - Implement the 256-bin ink-weighted centroid table, the 7-bin moving average, and the empty-bin carry.
  - Files: `src/steam/derive.ts`.
  - Satisfies: R8.1, R8.2, R8.6, R18.3.

- [x] 16. Derive tests
  - On a synthetic 40×20 note: output sizes are `w*h*4` and `256*2`; channel alpha at ink pixels is 255; dilated pixels carry the toi of the nearest ink; feather is 255 on ink, 0 at 30 px away and beyond, and non-increasing with distance; head table x is non-decreasing within a single line; no NaN.
  - On the real hero files (read with a PNG decoder devDependency or the test's own decoder, skipping if absent): the hull reach (A > 0) stays inside the 32 px margin, so no non-zero A on the note's outer 1 px ring.
  - Property test (fast-check) for random small masks: output sizes exact and all values in range.
  - Files: `src/steam/derive.test.ts`, `src/steam/derive.prop.test.ts`.
  - Satisfies: R6.3, R18.1 to R18.4.

- [x] 17. Design tokens reader
  - Create `readTokens(el)` returning `vec3` arrays for `--bg --ink --before --after --rule --ghost --moon --night` from `getComputedStyle`, parsed once. Throw if a token is missing. Add the tokens as CSS custom properties in the app stylesheet if not already present.
  - Files: `src/steam/tokens.ts`, `src/index.css` (or the existing global stylesheet).
  - Satisfies: R14.9, R21.5.

- [x] 18. Tokens test
  - Parse `#RRGGBB` and `rgb()` strings; reject empty values.
  - Files: `src/steam/tokens.test.ts`.
  - Satisfies: R14.9.

- [x] 19. Shader sources: vertex and fog pass
  - Write the shared vertex shader and pass-1 fragment shader (hash, value noise, 4-octave fbm, domain warp, low-pane density, thicken mix).
  - Files: `src/steam/shaders.ts`.
  - Satisfies: R6.2, R14.1, R14.2.

- [x] 20. Shader sources: composite pass
  - Write pass 2: `kitchen()`, `sampleNote()`, wipe-on, cook's wipe sweep with hull latch, fog mix, ember channel light, derivative-based rim, writing head, glass edge tint, specular streak (alpha ≤ 0.55 in `--ink`), beads, final per-channel clamp to `uInk`.
  - Files: `src/steam/shaders.ts`.
  - Satisfies: R1.1, R4.1, R4.2, R4.5, R5.2 to R5.4, R6.1, R7.1 to R7.5, R8.2, R8.3, R9.2 to R9.5, R14.3.

- [x] 21. Renderer: context, programs, resources
  - Implement `SteamRenderer.create` (returns null without WebGL2 or on compile/link/FBO failure), program build with error logging, the full-screen triangle VAO, `texNote`, `texChan`, `texFog` and `fboFog`, the sampler units, and the uniform locations cached once.
  - Files: `src/steam/renderer.ts`.
  - Satisfies: R14.1, R14.2, R14.7, R19.1.

- [x] 22. Renderer: frame loop and uniforms
  - Implement the clock (absolute `performance.now()`), frozen-`t` mode, `setClock`, `play`, `startReveal`, `wipe`, per-frame `revealState` call, uniform upload from preallocated `Float32Array`s, head lookup, and the two draw calls. Add a 10 Hz state callback for React.
  - Files: `src/steam/renderer.ts`.
  - Satisfies: R2.2, R2.4, R9.3, R10.2 to R10.5, R14.5, R14.6, R16.1.

- [x] 23. Renderer: resize, DPR cap, context loss, dispose
  - Implement `resize` (canvas size = CSS size × `min(dpr, 2)`, fog texture at ¼, layout uniforms), `webglcontextlost`/`restored` handling with the 2 s fallback callback, and an idempotent `dispose`.
  - Files: `src/steam/renderer.ts`.
  - Satisfies: R12.3, R14.2, R14.4, R14.8, R19.1.

- [x] 24. Renderer allocation guard test
  - In vitest with a stubbed GL context (a hand-written mock recording calls), check that `play` plus 120 simulated frames calls `drawArrays` twice per frame, creates no textures or buffers after `create`, and that `dispose` called twice deletes each resource once. Add a lint-style test that greps the frame function source for `new `, `[`…`]` literals, and `=>` (a cheap guard). Mark it a guard, not proof; the real check is task 36.
  - Files: `src/steam/renderer.test.ts`.
  - Satisfies: R14.5, R14.6, R14.8.

- [x] 25. Pane styles: sash frame, rails, upper sash and moon
  - Add CSS for the sash bars and rails from `--rule` using gradients only, the upper sash in `--night` with the moon (`--moon` at 0.96), the layout split (36% desktop, 24% phone), and the button style with `min-width/min-height: 48px`. No `border: 1px`, no outline-like box shadow.
  - Files: `src/steam/steam.css`.
  - Satisfies: R4.4, R5.1, R5.5, R5.6, R10.1, R13.1 to R13.3, R21.5.

- [x] 26. `SteamPane`: structure, assets, renderer wiring
  - Build the component: load assets, run `derive`, `computeLayout` on `ResizeObserver`, create the renderer, set the frozen or live clock from `parseParams`, fall back to `StaticPane` on null, unmount cleanly with `dispose`. Render the credit line and the load-failure text.
  - Files: `src/steam/SteamPane.tsx`.
  - Satisfies: R2.2, R12.3, R16.6, R17.6, R19.1, R21.1, R22.1, R22.2.

- [x] 27. `SteamPane`: button, Space key, live region, fps overlay
  - Implement the phase-driven button labels and actions, the guarded `Space` handler with `preventDefault`, `aria-disabled` while writing, the `aria-live` region built from `meta.text`, the clear-then-set on replay, the `aria-hidden` canvas, the `--after` focus ring, and the `?fps=1` DM Mono overlay (4 Hz text update, mean fps, worst frame, frames over 18.2 ms).
  - Files: `src/steam/SteamPane.tsx`, `src/steam/steam.css`.
  - Satisfies: R10.1 to R10.8, R15.4, R16.3, R20.1 to R20.4, R20.6, R21.2 to R21.4.

- [x] 28. `StaticPane` component
  - Implement the fallback: sash frame and upper sash reuse, two stacked images with a 600 ms opacity crossfade at the reveal moment, the cleared-glass image on wipe, the same button, live region, credit, and `?t`/`?lead` handling, and `matchMedia('(prefers-reduced-motion: reduce)')` selection (re-evaluated on change). Pick the `groups` or `page` image pair from `chooseLayout`.
  - Files: `src/steam/StaticPane.tsx`.
  - Satisfies: R19.1 to R19.7, R20.5.

- [ ] 29. Static pane image script
  - Write a Playwright script that opens the live renderer with `?t=-1`, `?t=5100`, and a wiped state, at the desktop and the 390 px viewport, and writes `public/hero/pane-{page,groups}-{fogged,held,wiped}.webp`. Output is deterministic through the frozen clock.
  - Files: `scripts/render-static-panes.ts`, `package.json` (script `static-panes`), `public/hero/pane-*.webp` (generated).
  - Satisfies: R19.3, R19.6, R19.7.
  - Not complete: the script is written and verified (it wrote all six images to a temp `OUT_DIR`), but this run was told not to edit `public/hero/`, so `pane-*.webp` are not generated or committed. Run `npm run static-panes` and commit the output. The wiped image uses the live clock (a wipe cannot be frozen), so it is not byte-reproducible. The commit also carries the `@fontsource` dependencies that task 30 needs, since they share `package.json`.

- [ ] 30. App entry
  - Render `<SteamPane/>` full-screen from `App.tsx` with the hash router already in place (or none if no other route exists). Set body background `--bg`, load IM Fell English, Literata, and DM Mono.
  - Files: `src/App.tsx`, `src/main.tsx` (only if needed), `index.html` (fonts, if not present).
  - Satisfies: R21.5, R22.2, R22.3.

- [ ] 31. Playwright frame capture helper
  - Write a helper that opens `/?t=<ms>` at a viewport and saves a PNG, and computes per-pixel luminance and per-region statistics in Node (using `pngjs` as a dev dependency).
  - Files: `e2e/helpers/capture.ts`, `package.json`.
  - Satisfies: supports R1, R4, R6, R9, R11 checks below.

- [ ] 32. E2E: concealment and timing (failures 1 and 8)
  - Capture at `t = -3000, -1500, -1`: assert the pixels at the note's destination area are statistically the same as an equal-size area of fog elsewhere (mean and variance within a tolerance), and that no ember-coloured channel exists. Load the page with no `t`, capture at 2000 ms after load, and assert the same. Record `performance.now` marks to assert the first rendered write-on frame is within 150 ms of LEAD_MS after the first presented frame, and the held state is reached WRITE_ON_MS later within 150 ms.
  - Files: `e2e/steam-timing.spec.ts`.
  - Satisfies: R1.1 to R1.4, R2.2, R2.3, R2.4.

- [ ] 33. E2E: brightness, glass, and patch checks (failures 2, 3, 4)
  - At `t = -1000, 1000, 2500, 5000, 9000` on desktop and 390 px: assert no pixel luminance above that of `#EFE7DA`; assert the CSS computed style has no `border-width` of 1px on pane, canvas, caption; assert the sash bar pixels match `--rule`; assert beads and the streak by region statistics; assert the fog-density step across each group rect edge is within the tolerance in R6.4.
  - Files: `e2e/steam-visual.spec.ts`.
  - Satisfies: R4.3, R4.4, R5.1 to R5.6, R6.1, R6.4.

- [ ] 34. E2E: wiped-out, hold, and wipe (failures 5 and 7)
  - Assert at `t = 5000` and `t = 9000` that channel pixels' clear amount is equal (frame diff within a tolerance on the channel mask), that no text-colour pixels (`--ink`, `--paper` hue) appear over fog at channel pixels, and that the rim colour is near `--ghost`. Press the button (and Space) at hold; assert the sweep, the label changes, and that after WIPE_MS + REFOG_MS fog returned outside the hull and not over the channels. Check `aria-disabled` during writing.
  - Files: `e2e/steam-hold.spec.ts`.
  - Satisfies: R7.3 to R7.5, R9.1 to R9.6, R10.2 to R10.7.

- [ ] 35. E2E: phone layout and accessibility (failure 6)
  - At 390×844 and 360×800: assert the lower pane contains two stacked groups, each core band ≥ 16 CSS px (read from the layout exposed on a `data-` attribute used only for tests), no ink in the right-most `PAD_PX` px, button ≥ 48×48, the live-region text equals the expected string after reveal start, Space operates the button, and a `prefers-reduced-motion` run renders `StaticPane` with the same live-region text and an opacity-only crossfade.
  - Files: `e2e/steam-phone.spec.ts`.
  - Satisfies: R10.1, R10.6, R11.1 to R11.5, R19.2, R19.4, R20.1 to R20.5.

- [ ] 36. Performance measurement script and report
  - Write a Playwright + CDP script that runs `/?fps=1` for 12 s over the lead-in, write-on, and hold on (a) desktop and (b) Pixel 5 emulation with `Emulation.setCPUThrottlingRate(4)`, records every frame interval from `requestAnimationFrame`, and writes mean fps, minimum fps, worst frame time, and frames over 18.2 ms to `bench/steam-renderer.json`. Fail the script if mean < 55 or any frame is under 55 fps. Also record the `derive` duration; if over 50 ms on the throttled profile, move `derive` into a Web Worker (new task).
  - Files: `scripts/measure-steam.ts`, `bench/steam-renderer.json` (generated), `package.json`.
  - Satisfies: R15.1, R15.2, R15.3, R15.5, R14.5.

- [ ] 37. Evidence log line
  - Append one line (ISO time, hook, target, result) to `docs/kiro-evidence/hooks.log` through the existing hook only if a hook runs on these tasks; do not write it by hand.
  - Files: none written manually.
  - Satisfies: honesty steering (no claims beyond logged evidence).

- [ ] 38. Final verification
  - Run `npm test`, `npm run e2e`, `tsc --noEmit`, and the build; confirm `dist/` is static. Search the pane's strings for "she", "her", "verified", and "AI-powered". Confirm no colour literal outside the token definitions in `src/steam/`.
  - Files: none (reads only).
  - Satisfies: R14.9, R21.2, R21.4, R21.5, R22.1, R22.3.
