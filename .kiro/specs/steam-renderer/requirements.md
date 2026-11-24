# Requirements: steam-renderer

Derived from `design.md`. "The system" is the steam pane (`SteamPane`, `SteamRenderer`, `StaticPane`). Times are in ms after reveal start unless stated. Section references (§) point to `design.md`.

Requirements R1 to R8 are the failure list of the previous prototype. Each is judged on captured frames.

## R1. Nothing of the note before the reveal (failure 1)

**User story:** As a viewer, I want the glass to hide the note completely until the reveal begins, so that the reveal is a surprise and the fog is not a trick.

1. WHILE the reveal clock `t` is below 0, THE SYSTEM SHALL render no pixel whose value depends on the note's ink alpha or scan pixels (`u = -1`, so the wipe amount is 0 everywhere).
2. WHEN a frame is captured at any time from load until LEAD_MS after load with no `t` parameter, including 2000 ms after load, THE SYSTEM SHALL show no part of the note.
3. WHILE the phase is `fogged` or `thickening`, THE SYSTEM SHALL NOT draw the writing head.
4. IF `?t` is negative, THEN THE SYSTEM SHALL render the pane as fogged with the note fully hidden.

## R2. Reveal timing (failure 8)

**User story:** As a judge, I want the reveal to last exactly as long as the stated constant and start at a known time, so that I can verify it with a stopwatch.

1. THE SYSTEM SHALL define `WRITE_ON_MS = 5000` and SHALL fail a test if `WRITE_ON_MS` exceeds 6000.
2. WHEN no `t` parameter is given, THE SYSTEM SHALL start the write-on `LEAD_MS` (2500 ms by default, or `?lead`) after the first presented frame that follows asset upload.
3. WHILE the phase is `writing`, THE SYSTEM SHALL set the reveal clock `u = t / WRITE_ON_MS`, so that `u` reaches 1 exactly when `t = WRITE_ON_MS`.
4. THE SYSTEM SHALL derive `t` from absolute `performance.now()` differences, so that a throttled or suspended frame loop does not lengthen the write-on.
5. WHEN `?lead=<ms>` is given with a finite non-negative value, THE SYSTEM SHALL use it in place of `LEAD_MS`.

## R3. Phase model

**User story:** As a developer, I want the reveal state to be a pure function of the clock, so that it can be tested without a GPU.

1. THE SYSTEM SHALL compute reveal state with `revealState(tMs, wipeAtMs)` in `src/steam/timeline.ts`, a pure function with no DOM or GL access.
2. THE SYSTEM SHALL return phase `fogged` for `t < -THICKEN_MS`, `thickening` for `-THICKEN_MS ≤ t < 0`, `writing` for `0 ≤ t < WRITE_ON_MS`, `holding` from `WRITE_ON_MS` until the wipe, and `wiped` from `wipeAt`.
3. FOR ALL finite `t` and any `wipeAt`, THE SYSTEM SHALL return a state with `u` in [-1, 1], and `thicken`, `head`, `wipe`, `refog` each in [0, 1].
4. WHEN `t` increases, THE SYSTEM SHALL NOT decrease `u`, `thicken`, or `wipe` (revealed fraction never decreases).
5. IF `t` is NaN or non-finite, THEN THE SYSTEM SHALL return the state for `fogged`.
6. IF `wipeAt` is less than `WRITE_ON_MS`, THEN THE SYSTEM SHALL treat it as `WRITE_ON_MS`.
7. WHERE `THICKEN_MS` is defined, THE SYSTEM SHALL keep it at or below `LEAD_MS`.

## R4. No white hotspot (failure 2)

**User story:** As a viewer, I want a soft, believable glass, so that nothing glares and nothing looks like an interface highlight.

1. THE SYSTEM SHALL clamp each colour channel of every canvas pixel to the corresponding channel of `--ink` (#EFE7DA) as the last step of the composite.
2. THE SYSTEM SHALL render the specular streak with colour `--ink` and alpha no greater than 0.55.
3. WHEN a full-page frame is captured at any `t` in [-3000, WRITE_ON_MS + 3000], THE SYSTEM SHALL have no pixel whose relative luminance exceeds the luminance of #EFE7DA.
4. THE SYSTEM SHALL draw the moon at opacity 0.96 over `--night` so that its peak luminance does not exceed the luminance of `--ink`.
5. THE SYSTEM SHALL draw the writing head and rim in `--ghost` and `--moon` blends only, subject to the clamp in 1.

## R5. Sash glass, not a slab (failure 3)

**User story:** As a viewer, I want to look through a real old window, so that the scene reads as a place and not a card.

1. THE SYSTEM SHALL draw the frame of the lower pane as sash bars and a bottom rail in `--rule` (#3A2D24) using CSS gradients.
2. THE SYSTEM SHALL draw condensation beads along the lower pane's bottom edge, above the bottom rail, with density falling away from the rail.
3. THE SYSTEM SHALL draw a faint specular streak across the top third of the lower pane.
4. THE SYSTEM SHALL tint the fog toward green-grey near the pane's left, right and top edges, derived from `--before` with no new colour token.
5. THE SYSTEM SHALL NOT draw any 1 px (hairline) border, outline, or card-shaped box shadow around the pane, canvas, caption, or note.
6. THE SYSTEM SHALL render the fog colour from `--before` (#7F909C) and the page background from `--bg` (#0E0A0A).

## R6. No rectangular patch (failure 4)

**User story:** As a viewer, I want no visible box around the writing, so that the writing seems to belong to the glass.

1. THE SYSTEM SHALL NOT alter fog density, tone, or texture at any pixel as a function of the note's bounding box or group rectangles.
2. THE SYSTEM SHALL compute the fog field (pass 1) without any dependence on the note, so that fog outside the feathered hull equals fog in the rest of the pane.
3. THE SYSTEM SHALL feather the hull mask at least 24 note px beyond the dilated ink hull (`HULL_FEATHER_PX = 24`, `HULL_DILATE_PX = 6`), and SHALL keep that reach (30 note px) inside the 32 px transparent margin of the input.
4. WHEN a frame is captured while the phase is `thickening`, `writing`, or `holding`, THE SYSTEM SHALL have a fog-density difference between pixels just inside and just outside every group rectangle edge that is no greater than the difference between neighbouring pixels elsewhere in the fog plus the pass-1 grain (measured by script, threshold in the test).

## R7. Wiped out, not laid over (failure 5)

**User story:** As a viewer, I want the writing to be cleared out of the fog with the pot's light behind it, so that it feels like the glass was wiped.

1. WHEN the reveal clock `u` passes a pixel's time-of-ink `toi(p)`, THE SYSTEM SHALL reduce the fog opacity at that pixel by the channel alpha, using one read of the derived channel texture.
2. THE SYSTEM SHALL shape each clear channel from the scan's own ink alpha, dilated by `DILATE_PX = 2` and softened by `SOFT_PX = 2` note px, so that it reads as a finger-wiped channel.
3. WHEN a channel is clear, THE SYSTEM SHALL show the ember glow of the pot (`--after`, #F2A65A) through it by adding light to the background behind the fog.
4. THE SYSTEM SHALL draw the cold wet rim in `--ghost` (#BCD3E4) at the channel edge, computed from the screen-space gradient of the channel clear amount.
5. THE SYSTEM SHALL NOT draw any layer coloured by the scan's RGB (or by `--ink`, `--paper`, or any text colour) over the fog.
6. THE SYSTEM SHALL NOT use a handwriting-style font, vectorised or traced strokes, or generated handwriting anywhere in the pane.
7. THE SYSTEM SHALL use the scan's ink only as a mask and a scalar (alpha and pressure), derived once at load by `derive.ts`.

## R8. Write-on path and writing head

**User story:** As a viewer, I want the writing to follow along the line, so that it feels as if it is being written, without anyone pretending to be the writer.

1. THE SYSTEM SHALL order the reveal by the toi map (left to right per line, line 1 then line 2) so that group A (`t` in [0, 0.485]) is wiped before group B (`t` in [0.485, 1]).
2. WHILE the phase is `writing`, THE SYSTEM SHALL draw a small cold-white glow (blend of `--ghost` and `--moon`) at the smoothed centroid of the current toi frontier.
3. THE SYSTEM SHALL NOT colour the writing head amber and SHALL NOT draw a hand, pen, or figure.
4. THE SYSTEM SHALL fade the head in over the first `HEAD_FADE_MS` of the write-on and out over the last `HEAD_FADE_MS`.
5. THE SYSTEM SHALL describe the write-on in any user-visible text as a traced path or the write-on, and SHALL NOT call it the writer's real pen order.
6. THE SYSTEM SHALL look up the head position from a table precomputed at load, with no allocation per frame.

## R9. Hold and re-fog (failure 7)

**User story:** As a viewer, I want the note to stay readable until I choose to wipe, so that I can read it.

1. WHEN the write-on finishes, THE SYSTEM SHALL keep every channel at its full clear amount for as long as the phase is `holding`.
2. WHILE the phase is `holding`, THE SYSTEM SHALL animate the fog drift only outside the note's channels and SHALL NOT increase fog opacity over any channel pixel.
3. WHEN the cook wipes, THE SYSTEM SHALL sweep a soft front from left to right across the pane over `WIPE_MS` (1400 ms), clearing fog everywhere.
4. WHILE the phase is `wiped`, THE SYSTEM SHALL return fog over `REFOG_MS` (20000 ms) only where the feathered hull mask is below 1, and SHALL keep the hull region clear.
5. IF the hull feather at a pixel is 1, THEN THE SYSTEM SHALL keep that pixel clear after the wipe regardless of `refog`.
6. WHEN a frame is captured at `t = WRITE_ON_MS`, at `t = WRITE_ON_MS + 4000`, and at a wipe time plus WIPE_MS + REFOG_MS, THE SYSTEM SHALL show the same clear amount at every channel pixel.

## R10. Wipe control

**User story:** As a cook, I want one large control to show the note and to wipe the glass, so that I can use it with wet hands or a keyboard.

1. THE SYSTEM SHALL provide one `<button>` with a hit area of at least 48×48 CSS px.
2. WHILE the phase is `fogged` or `thickening`, THE SYSTEM SHALL label the button "Show the note", and WHEN it is activated THE SYSTEM SHALL start the reveal at once.
3. WHILE the phase is `writing`, THE SYSTEM SHALL set `aria-disabled="true"` on the button and SHALL ignore activation.
4. WHILE the phase is `holding`, THE SYSTEM SHALL label the button "Wipe the glass", and WHEN it is activated THE SYSTEM SHALL record `wipeAt = t`.
5. WHILE the phase is `wiped`, THE SYSTEM SHALL label the button "Show the note", and WHEN it is activated THE SYSTEM SHALL reset `wipeAt` and replay from thickening.
6. WHEN the Space key is pressed and focus is not inside another interactive element, THE SYSTEM SHALL perform the button's action and prevent page scrolling.
7. WHILE `?t` is set, THE SYSTEM SHALL freeze the clock and ignore the button.
8. THE SYSTEM SHALL place the button outside the note's area so that it never covers the writing.

## R11. Phone layout (failure 6)

**User story:** As a phone cook, I want to read the note at arm's length, so that the writing is large and whole.

1. WHEN the pane width is at most `PHONE_MAX_W` (640 CSS px), THE SYSTEM SHALL use the `groups` layout, stacking the gap groups in `t` order, centred in the lower pane.
2. IF the pane is 390 CSS px wide or 360 CSS px wide, THEN THE SYSTEM SHALL render each group with `coreBand × scale ≥ 16` CSS px.
3. THE SYSTEM SHALL scale each group independently so that its inked rectangle plus `PAD_PX = 16` on each side fits the pane width, with no clipped right edge.
4. IF a width forces `coreBand × scale < 16`, THEN THE SYSTEM SHALL raise the scale to give 16 px and SHALL set `fits = false` instead of silently shrinking.
5. WHEN the viewport is 390 px wide, THE SYSTEM SHALL show only the note's stacked gap groups in the lower pane, and not the page's full-width note strip.
6. THE SYSTEM SHALL compute placement in `layout.ts` as a pure function of pane size and note meta.

## R12. Desktop layout

**User story:** As a desktop viewer, I want the note to sit as it sat on the page, so that it keeps its shape.

1. WHEN the pane width is above `PHONE_MAX_W`, THE SYSTEM SHALL use the `page` layout, with one uniform scale and the groups at their original relative positions.
2. THE SYSTEM SHALL cap the scale at 1.25 CSS px per note px and size it so the note fits the pane width less `2 × PAD_PX` and half the pane height.
3. WHEN the viewport is resized across `PHONE_MAX_W`, THE SYSTEM SHALL recompute the layout and redraw without reloading the page.

## R13. Upper sash

**User story:** As a viewer, I want the night outside to stay clear, so that the fogged glass is the only thing hidden.

1. THE SYSTEM SHALL render the upper sash in `--night` (#121A24) with a low full moon in `--moon` (#E4E9EC), using CSS only.
2. THE SYSTEM SHALL keep the upper sash unfogged during every phase.
3. THE SYSTEM SHALL separate the upper and lower sash by a meeting rail in `--rule`.

## R14. Renderer structure

**User story:** As a developer, I want a small WebGL2 renderer with a fixed per-frame cost, so that its cost can be measured.

1. THE SYSTEM SHALL use raw WebGL2 with GLSL ES 3.00 and no 3D engine or WebGL wrapper library.
2. THE SYSTEM SHALL render pass 1 (fog field) into an R8 texture at a quarter of the canvas resolution per axis.
3. THE SYSTEM SHALL render pass 2 (composite) at full canvas resolution, with a single read of the channel texture for the time-of-ink value.
4. THE SYSTEM SHALL cap the canvas resolution at `devicePixelRatio` 2.
5. THE SYSTEM SHALL perform no per-frame heap allocation in the render loop (no new objects, arrays, typed arrays, or closures) after `create` returns.
6. THE SYSTEM SHALL issue exactly two draw calls per frame.
7. THE SYSTEM SHALL expose `create`, `setClock`, `play`, `startReveal`, `wipe`, `resize`, `onContextLost`, and `dispose`.
8. WHEN `dispose` is called, THE SYSTEM SHALL stop the frame loop and delete all textures, buffers, framebuffers, vertex arrays, and programs, and SHALL do so safely if called twice.
9. THE SYSTEM SHALL read colours from the design-token CSS custom properties once at `create`, and SHALL NOT embed ad-hoc colour literals in shaders or components.

## R15. Performance

**User story:** As a viewer on a phone, I want smooth motion, so that the reveal feels like wiping and not like a slideshow.

1. WHILE the pane is animating on desktop, THE SYSTEM SHALL average at least 55 fps with zero frames under 55 fps.
2. WHILE the pane is animating on a Pixel 5 profile with 4× CPU throttling, THE SYSTEM SHALL average at least 55 fps with zero frames under 55 fps.
3. THE SYSTEM SHALL record these measurements in `bench/` as JSON produced by a script, and no document SHALL state a figure that is not in those files.
4. WHEN the `?fps=1` parameter is given, THE SYSTEM SHALL show a DM Mono overlay with the rolling mean fps, the worst frame time, and the count of frames over 18.2 ms.
5. IF the one-time derivation takes more than 50 ms on the throttled profile, THEN THE SYSTEM SHALL move it to a Web Worker.

## R16. URL parameters

**User story:** As a measurer, I want to freeze or time the reveal from the URL, so that frames can be captured reproducibly.

1. WHEN `?t=<ms>` is given with a finite value, THE SYSTEM SHALL freeze the reveal clock and the fog drift time at that value and render the same frame every time.
2. WHEN `?lead=<ms>` is given without `t`, THE SYSTEM SHALL start the reveal that long after the first presented frame.
3. WHEN `?fps=1` is given, THE SYSTEM SHALL show the fps overlay.
4. IF a parameter value is missing or not a finite number (or not `1` for `fps`), THEN THE SYSTEM SHALL ignore it and use the default.
5. THE SYSTEM SHALL read parameters from both the hash route query and `location.search`, with `location.search` taking priority.
6. THE SYSTEM SHALL offer no other controls or screens in this feature.

## R17. Assets and validation

**User story:** As a developer, I want a malformed note file to fail loudly, so that I never render a half-understood note.

1. THE SYSTEM SHALL load `note-looks-red-smooth.png`, `.toi.png`, and `.json` from `/hero/`.
2. THE SYSTEM SHALL validate the JSON with a zod schema covering `noteId`, `text`, `source`, `size`, `pageBox`, and `groups` (each with `line`, `rect`, `coreBand`, `t`, `inkPx`).
3. IF the JSON is malformed (missing key, wrong type, rect outside `size`, `coreBand` outside the rect, `t` out of [0,1] or unordered, or overlapping group time ranges), THEN THE SYSTEM SHALL reject it with an error naming the failing field.
4. IF either PNG's dimensions differ from `meta.size`, THEN THE SYSTEM SHALL reject the load.
5. WHEN the JSON contains keys not in the schema, THE SYSTEM SHALL ignore them and SHALL NOT fail.
6. IF an asset fails to load or validate, THEN THE SYSTEM SHALL show the fogged pane and the text "The note could not be loaded.", and SHALL NOT show a partial note.
7. THE SYSTEM SHALL decode the note PNG without premultiplication and without colour-space conversion, and SHALL read the toi PNG's raw bytes.

## R18. Derived data

**User story:** As a developer, I want the heavy per-pixel work done once, so that the frame loop stays cheap.

1. THE SYSTEM SHALL compute the channel texture and the head table in `derive.ts`, a pure function of the toi bytes, note bytes, and size.
2. THE SYSTEM SHALL propagate time-of-ink into dilated pixels from the nearest ink pixel, so that one texture read gives a consistent time across the channel width.
3. THE SYSTEM SHALL compute the head table as 256 bins of ink-weighted frontier centroid, smoothed by a 7-bin moving average, with empty bins copying the previous bin.
4. FOR ANY input, THE SYSTEM SHALL produce output arrays of the exact sizes (`w*h*4` and `256*2`) with all channel alpha and feather values in [0, 1] (0..255 as bytes).

## R19. Fallback pane

**User story:** As a viewer without WebGL2, or who prefers reduced motion, I want the same moment shown simply, so that I miss nothing.

1. IF `SteamRenderer.create` returns null, or WebGL context loss is not restored within 2000 ms, THEN THE SYSTEM SHALL render `StaticPane`.
2. WHERE `prefers-reduced-motion: reduce` is set, THE SYSTEM SHALL render `StaticPane` and SHALL NOT start the WebGL loop.
3. THE SYSTEM SHALL build `StaticPane` from pre-rendered fogged and held images of the live renderer's own output, and SHALL NOT compose any text-coloured layer in CSS.
4. WHEN the reveal moment arrives (LEAD_MS after load, or the button), THE SYSTEM SHALL crossfade from the fogged image to the held image by opacity only, over 600 ms, with no spatial motion.
5. THE SYSTEM SHALL keep the same sash frame, upper sash, button, credit, live-region announcement, and `?t` / `?lead` behaviour as the live pane.
6. WHEN the viewport is on the phone layout, THE SYSTEM SHALL use the `groups` image pair.
7. WHEN the cook wipes in the fallback pane, THE SYSTEM SHALL crossfade to the pre-rendered cleared-glass image.

## R20. Accessibility

**User story:** As a screen-reader user, I want to hear what the note says when it appears, so that I get the same moment.

1. WHEN the reveal starts, THE SYSTEM SHALL set an `aria-live="polite"` region to "The writer's note, handwritten: till it Looks red & smooth", built from `meta.text`.
2. WHEN a replay starts, THE SYSTEM SHALL clear the region and set it again.
3. THE SYSTEM SHALL mark the canvas `aria-hidden="true"`.
4. THE SYSTEM SHALL make the button focusable, operable by Enter and Space, and give it a visible focus ring in `--after`.
5. WHERE `prefers-reduced-motion: reduce` is set, THE SYSTEM SHALL show the same note at the same moment through the opacity-only crossfade of R19.
6. THE SYSTEM SHALL keep the live-region text within 2 s of the reveal start event.

## R21. Voice, provenance, and tokens

**User story:** As the product owner, I want the pane to follow the product rules, so that it is honest about whose hand it is.

1. THE SYSTEM SHALL show the credit "Wellcome Collection, Public Domain Mark" on the pane that shows the scan.
2. THE SYSTEM SHALL refer to the author only as "the writer", and SHALL NOT use "she" or "her" in any pane text (the product title excepted).
3. THE SYSTEM SHALL NOT include speech synthesis, a voice, a chatbot, or a persona.
4. THE SYSTEM SHALL NOT show the note as a gate-passing recipe, and SHALL NOT use wording such as "verified" or "AI-powered".
5. THE SYSTEM SHALL use only the design-token CSS custom properties for colour, with IM Fell English, Literata, and DM Mono as the only fonts (DM Mono for the fps overlay only).

## R22. Static site

**User story:** As a judge, I want a static site, so that nothing runs but the browser.

1. THE SYSTEM SHALL run with no server, no model, and no network request other than the static assets from the same origin.
2. THE SYSTEM SHALL render `SteamPane` full-screen from `src/App.tsx`.
3. THE SYSTEM SHALL build to a static `dist/`.
