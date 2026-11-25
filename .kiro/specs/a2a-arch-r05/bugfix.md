# Bugfix: a2a-arch-r05

An architecture review of the repository at HEAD 3907daf found eleven faults (B1 to B11) in the renderer clock, the quality governor, the static fallback, the shelf loader, Cook Mode's reveal gate, the wake lock, session wake-up, screen-reader access and provenance. Each is fixed with a test written first and committed red (`[kiro] a2a-arch-r05: red …`), then the fix (`[kiro] a2a-arch-r05: fix …`), then a preservation check. Nothing is pushed by this spec.

Terms. "Reveal clock": `now - revealStart` in `src/steam/renderer.ts`, in ms of animation-frame time. "Hidden gap": the time between a tab being hidden and shown again, during which no frame runs. "Held": phase `holding`. "Live state": the last `RevealState` the live renderer reported to `SteamGlass`.

## Current Behavior

1. **B1.** A hidden tab gets no animation frames. The first frame after it carries a `now` that includes the whole hidden gap, so a write-on or wipe sweep that was in flight is already finished when the cook comes back, and `startReveal()` returns without replaying it once the phase is `holding`. The same gap enters `stats` (`sumMs`, `worstMs`, `over`) and the governor.
2. **B2.** `QualityGovernor.push` ignores every interval over `GOV_IGNORE_MS` (500 ms). A visible device that renders slower than 2 fps can never be degraded.
3. **B3.** At tier 3 `govern()` calls the degrade callback at once, which swaps the live canvas for `StaticPane` in the middle of a write-on or a wipe sweep.
4. **B4.** `SteamGlass` hands `StaticPane` the live state only when `contextLost` is true. A fallback chosen for another reason after a live state existed (reduced motion switched on mid-reveal, tier 3) restarts the reveal instead of continuing it.
5. **B5.** `createShelfLoader` turns a fetch rejection or any non-OK status into a `Rejection` and caches it. One transient failure on a flaky network hides the recipe for the whole visit, and the hero deep link shows NotFound.
6. **B6.** Cook's reveal gate is built once with `useMemo(…, [])` and closes over `audio` from its first render. When the recipe comes from the service-worker cache before IndexedDB opens, that value is `null` for good: the lamp dips, the simmer never ducks.
7. **B7.** The wake lock (a) stores a sentinel that resolves after `release()` and reports `held` after Cook Mode has closed; (b) never asks again after a `release` event from the browser while the page stays visible; (c) retries a refusal only after a hide and show.
8. **B8.** `pageshow` and `focus` dispatch `tick`, and the scheduler's `tick` never clears `asleep`. A page restored as visible without a `visibilitychange` stays asleep: no reveal, no wipe.
9. **B9.** The held transcription paragraph (`.cook__reading`) has `aria-hidden="true"`. Its words reach a screen reader only through the single polite live region, which the next message (a pace change) replaces. The note is then on screen and not in the accessibility tree.
10. **B10.** The compact archive slip under Cook Mode's reveal shows institution, shelfmark, page, date and licence, and no "verify at source" link. Only "The hand, quoted" has it.
11. **B11.** `SteamPane` puts `j.span ?? j.shownText ?? ''` from fetched JSON into state without a type check, so a non-string `span` reaches the live-region text.

## Expected Behavior

1. **B1.** While `document.visibilityState === 'hidden'` the reveal clock does not advance. On hidden the renderer records the time. On visible it shifts `revealStart` and `t0` (the fog clock) by the hidden duration and sets `lastFrame` to NaN, so the gap reaches neither the reveal, nor `stats`, nor the governor. The visibility source is injectable (`RendererOptions.visibility`, default `document`). The listener is removed in `dispose()`. A `fogged` pane with `lead: Infinity` stays fogged until `startReveal`.
2. **B2.** Three consecutive visible intervals over `GOV_IGNORE_MS` raise the tier straight to 3 (the stall path). One long interval, or long intervals separated by a normal one, change nothing. The 60-frame p95 path is unchanged. Non-finite and non-positive intervals are still ignored and do not break the run.
3. **B3.** A tier-3 request made while the phase is `thickening` or `writing`, or while a wipe sweep is still moving, is held and applied on the first frame whose phase is `fogged`, `holding` or a finished wipe. Tiers 1 and 2 apply at once. Context loss keeps its 2 s restore window before the fallback.
4. **B4.** Whenever a live state exists, `StaticPane` resumes from it (`RevealClock.resume`), whatever triggered the fallback. A reduced-motion page that never had a live state is unchanged: it waits for `startReveal`.
5. **B5.** A network rejection or HTTP 408, 429 or 5xx is retried up to 2 more times with a backoff of about 300 ms then about 1000 ms. The delay is injectable so tests run at once. A load that still fails on transport is not kept in the cache: a later `load()` fetches again. HTTP 404 and every content failure (invalid JSON, schema, `checkCookable`, provenance withholding) stay terminal, are cached and are never retried.
6. **B6.** The gate reads the current `audio` through a ref updated on every render. An audio that arrives after Cook mounted is ducked once per reveal.
7. **B7.** (a) A request that resolves after `release()` releases its sentinel at once and the status stays `idle`. (b) A `release` event from the browser, while the page is visible and the lock was not released by us, triggers one re-acquire attempt; a refusal stops it, so there is no loop. (c) A refusal is also retried on the next `pointerdown` or `keydown` inside Cook Mode, at most once per gesture. Nothing waits on the lock.
8. **B8.** On `pageshow` or `focus`, when the document is visible and the session is asleep, the session dispatches `resume`. Otherwise it dispatches `tick` as before.
9. **B9.** The held reading paragraph is in the accessibility tree (no `aria-hidden`). The canvas and the empty placeholder `div` stay `aria-hidden`. No second live announcement is added.
10. **B10.** While a note is revealed in Cook Mode the compact slip also carries a "verify at source" link for that note: `href = regionUrl(bundle, note)`, `target="_blank"`, `rel="noopener noreferrer"`, label `QUOTED.verify`, accessible name `QUOTED.verifyName`. It keeps the one-line phone layout and the tap height the other slip links have.
11. **B11.** Only a string value of `span` or `shownText` is used. Anything else gives `''`.

## Unchanged Behavior

1. The Cook wall clock (`src/cook/clock.ts`, `Date.now`) and the scheduler keep running while a phone sleeps. Only the renderer's animation clock stops while hidden. (B1)
2. `frozenT` measurement frames are never degraded and never shifted. Context-loss handling and its 2 s restore window. A `fogged` pane with `lead: Infinity` stays fogged until `startReveal`. (B1, B3)
3. The 60-frame p95 tier path of the governor, the tier thresholds, and the property that the tier never falls. (B2)
4. Shaders, design tokens and pinned visual bounds are not touched. P7 (reveal-once) properties stay green.
5. A reduced-motion page that never had a live state waits for `startReveal`. (B4)
6. Content failures of the shelf stay terminal and cached; the catalog-invalid path is unchanged. (B5)
7. The lamp dip cooldown and the "once per cooldown" duck. (B6)
8. A granted lock still gives `data-wake="held"`; a refusal still shows no text; no API still gives `unsupported`. (B7)
9. A `tick` on `pageshow` or `focus` for a session that is awake. (B8)
10. The live region keeps its last-message-wins behaviour; no new announcement is added. (B9)
11. The slip's institution, shelfmark, page, date and licence, the reserved attribution slot (no control moves at the reveal), and the phone layouts pinned by `e2e/cook-layout-p1d.spec.ts`, `e2e/cook-phone.spec.ts` and `e2e/steam-phone-fit.spec.ts`. (B10)
12. The service worker lifecycle (`skipWaiting`, `clients.claim`), `Quoted.tsx` and its `regionUrl(b, n)!`, and effects' dependency arrays other than B6's are out of scope and untouched.

## Test changes made deliberately

Recorded per item in `docs/kiro-evidence/a2a-arch-r05/NOTES.md` as each lands.
