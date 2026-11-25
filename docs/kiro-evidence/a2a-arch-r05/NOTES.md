# a2a-arch-r05: what changed, the red-to-green tests, how to check each by hand

Spec: `.kiro/specs/a2a-arch-r05/bugfix.md`. Base: HEAD 3907daf. Each item has a red commit (`[kiro] a2a-arch-r05: red …`, the new tests failing for the reason named), then a fix commit (`[kiro] a2a-arch-r05: fix …`). `git log --oneline 3907daf..` lists them in order.

Two process notes. The B3 red commit was amended once before the fix: its first draft of the tests failed for two wrong reasons (a stale `performance.now` in the wipe test, a too short run in the thickening test), found by running the corrected tests against the unfixed `renderer.ts` before committing. The B10 e2e spec (`e2e/cook-verify.spec.ts`) was committed with the B11 red commit, before the B10 fix commit.

## B1. The reveal clock stands still while the tab is hidden

- Changed: `src/steam/renderer.ts`. New option `RendererOptions.visibility` (default `document`; a `VisibilitySource`). On `hidden` the renderer records `performance.now()`; on `visible` it shifts `revealStart`, `t0`, `lastNotify` and `lastStats` by the hidden time and sets `lastFrame` to NaN, so the gap reaches neither the reveal, nor `stats`, nor the governor. `startReveal`, `wipe` and `notify` read the clock through `clockNow()`, which is frozen at the hidden time. A frame that still runs in a hidden tab only reschedules. The listener is removed in `dispose()`. The Cook wall clock (`src/cook/clock.ts`) is untouched.
- Red to green (`src/steam/renderer.test.ts`, describe "SteamRenderer reveal clock and a hidden tab (a2a-arch-r05 B1)"): "a write-on in flight when the tab was hidden is still in flight when it comes back, and the gap is not a frame"; "a wipe sweep in flight is not finished by the gap"; "does not advance the reveal clock for a frame that runs while hidden"; "repeated hidden gaps never reach the governor"; "listens for visibility changes while alive and removes the listener in dispose". Preserved, passing before and after: "a pane with lead Infinity stays fogged through a hidden gap until startReveal".
- By hand: open `#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=1`, wait until the write-on starts, switch to another tab for 20 s, come back: the hand is still being written, not finished. With `&fps=1` the overlay's "worst" stays under 50 ms after the return.

## B2. The governor degrades a device slower than 2 fps

- Changed: `src/steam/governor.ts`. `GOV_STALL_RUN = 3`: three consecutive finite intervals over `GOV_IGNORE_MS` raise the tier straight to 3 and return 3. A normal interval resets the run. A long interval is still not entered in the 60-frame window. Non-finite and non-positive intervals are ignored and do not break a run. The p95 path is unchanged.
- Test changed on purpose (`src/steam/governor.test.ts`): "ignores intervals over 500 ms and non-positive or non-finite ones" pushed 501 and 5000 back to back. It still passed, but it described a rule that no longer holds (long intervals never count). It is now "does not enter a lone interval over 500 ms in the window, and ignores non-positive or non-finite ones", with a normal frame between the long ones and an extra `filled` and `tier` check. No other governor assertion changed. The property tests P-G1 (tier never falls; one long frame never raises it; three long frames of at most 400 ms never raise it) pass unchanged.
- Red to green (`describe "QualityGovernor stall path (a2a-arch-r05 B2)"`): "three consecutive visible intervals over 500 ms raise the tier straight to 3"; "jumps from a lower tier too, and says nothing once at tier 3"; "non-finite and non-positive intervals are not stalls and do not break a run"; "P-G1b: three consecutive long intervals always end at tier 3". Passing before and after: "one long interval, or long ones broken up by a normal frame, change nothing", "a long interval is not entered in the 60-frame window".
- By hand: open a pane with `?gov=1`, pause the page in the debugger for a second three times in a row (or throttle the CPU 20x): `window.__steamStats.tier` becomes 3 and the static pane takes over once the phase is calm (B3). A single pause leaves the tier at 0.

## B3. Tier 3 waits for a calm phase

- Changed: `src/steam/renderer.ts`. `govern()` only sets `degradePending` for tier 3. After the frame is drawn, `flushDegrade()` calls the degrade callback on the first frame whose state is `fogged`, `holding`, or `wiped` with the sweep finished (`wipe >= 1`). Tiers 1 and 2 apply at once as before. The context-loss timer (`CONTEXT_RESTORE_MS`) is untouched.
- Red to green (`describe "SteamRenderer tier 3 waits for a calm phase (a2a-arch-r05 B3)"`): "a tier-3 request while the hand is being written is held until the write-on is done"; "… while the note is thickening is held too"; "… while a wipe sweep is moving is held until the sweep is finished". Passing before and after: "applies at once while holding and while still fogged"; "tiers 1 and 2 apply at once, mid-stroke"; "a lost context still reaches the fallback after its 2 s restore window, mid-stroke". The older test "halves the fog pass at tier 1, drops detail at tier 2 and asks for the static pane at tier 3" passes unchanged (its tier-3 frame is already in `holding`).
- By hand: as B2, but trigger the stalls while the hand is writing: the canvas stays until the write-on ends, then the static pane shows the held note.

## B4. The static pane resumes from any live state

- Changed: `src/steam/SteamGlass.tsx`: `resume={lastState.current}` (was `contextLost ? lastState.current : null`).
- Red to green (`src/steam/SteamGlass.resume.test.tsx`, new, with a fake `SteamRenderer`): "reduced motion switched on while the note is held: the static pane shows it held, not fogged". Passing before and after: "tier 3 while the note is written: the static pane carries on writing", "a lost context still resumes from the live state (cook-mode-qa-r1 Q8)", "a reduced-motion page that never had a live state stays fogged and waits for startReveal".
- By hand: in Cook Mode at a held note, switch the OS to "reduce motion" (or toggle it in DevTools rendering): the note stays on the glass; before, it went back to fog.

## B5. The shelf retries transport failures

- Changed: `src/data/catalog.ts`. `createShelfLoader(fetchFn, catalog, sleep)`: a fetch rejection, a body that fails to arrive, or HTTP 408, 429 or 5xx is retried twice (`RETRY_DELAYS_MS` = 300 ms, 1000 ms). A load that still fails on transport is warned about once and dropped from the cache. HTTP 404 and other statuses, invalid JSON (`SyntaxError`), schema, `checkCookable` and withholding are final and cached.
- Test changed on purpose (`src/data/catalog.test.ts`): the `bad` table's "a network error" case now passes an instant `sleep`, because that case is retried twice before it is reported; its expectations (one warning naming the id, reason matching /offline/) are unchanged.
- Red to green (`describe "loadShelf retries transport failures (a2a-arch-r05 B5)"`): "two network rejections then success …"; "HTTP 408/429/500/502/503/504 is retried" (six cases); "a load that still fails after the retries is reported, warned once, and not cached"; "a network failure that stays is not cached either"; "two callers at once share one load, retries included". Passing before and after: the terminal table (HTTP 404, HTTP 403, invalid JSON, schema failure, `checkCookable` failure) and "a provenance withholding is terminal and the recipe stays in, cached".
- By hand: in DevTools, block `recipes/quinces-marmalade/recipe.json` for the first request (Network request blocking, then unblock within 1 s), open the hero deep link: the recipe loads instead of "not found".

## B6. The simmer ducks when the audio arrives late

- Changed: `src/app/Cook.tsx`. `audioRef` is updated on every render and the reveal gate calls `audioRef.current?.duck()`.
- Red to green (`src/app/Cook.cue.test.tsx`): "an audio that arrives after Cook mounted is ducked on the next reveal, once".
- By hand: reload a deep link on a return visit (service worker cache warm), reveal a note with the simmer on: the simmer dips with the lamp.

## B7. Wake lock

- Changed: `src/cook/wakelock.ts` and its use in `src/app/Cook.tsx`. A generation counter makes a request that resolves after `release()` release its sentinel at once and leave the status `idle` (a late refusal does not set `refused`). With `opts.visible` given, a `release` event from the browser while the page is visible triggers one new request; a refusal stops it, and a lock the browser keeps releasing is asked for once until a hide/show or a gesture. `onGesture()` retries a refusal; Cook calls it on `pointerdown` and on `keydown` that is not a repeat, on `document`, and removes both listeners when it closes. `onChange` keeps `data-wake` current when a promise settles late. Nothing waits on the lock.
- Red to green (`src/cook/wakelock.test.ts`, describe "wake lock lifecycle (a2a-arch-r05 B7)"): three (a) tests, three (b) tests, two (c) tests and "does nothing without the API". Passing before and after: "(b) no new request for a release while the page is hidden, or for our own release()". `src/app/Cook.wake.test.tsx`: "a refusal is asked again on the next pointerdown or keydown inside Cook Mode, and the listeners go when Cook closes"; "a keydown retries a refusal too, but a held key (repeat) does not hammer it"; "a release from the browser while the page is visible asks once more, and data-wake follows"; "a lock that arrives after Cook has closed is released at once".
- By hand: Chrome DevTools, Application, Permissions or a device with battery saver: refuse the lock, then tap the screen inside Cook Mode: `data-wake` on `main.cook` turns `held`. Close Cook Mode while the request is slow: the lock is not left held.

## B8. pageshow and focus wake a sleeping session

- Changed: `src/app/useCookSession.ts`: on `pageshow` and `focus`, `resume` when the document is visible and the session is asleep, else `tick`.
- Red to green (`src/app/useCookSession.test.tsx`, "pageshow (a2a-arch-r05 B8)" and "focus (a2a-arch-r05 B8)"): "wakes a sleeping session when the document is visible, with no visibilitychange". Passing before and after: "leaves a sleeping session asleep while the document is hidden", "on a session that is awake it is still a tick …".
- By hand: not reproducible on demand; it needs an engine that restores a page from the back-forward cache without a `visibilitychange`. The unit test fakes exactly that order.

## B9. The held reading is in the accessibility tree

- Changed: `src/app/Cook.tsx`: no `aria-hidden` on `p.cook__reading[data-note-reading]`. The canvas pane sections and the empty placeholder `div` keep `aria-hidden`. No announcement added. `e2e/cook-a11y.spec.ts` and no e2e asserts the attribute on Cook's reading (`e2e/steam-look3.spec.ts` asserts it on the spike page `SteamPane`, which is not changed).
- Test changed on purpose (`src/app/Cook.test.tsx`): in "shows the reviewed reading under the pane only while the note holds, in the accessibility tree …" the assertion `aria-hidden` equals `'true'` became "has no aria-hidden and no aria-hidden ancestor". It encoded the claim that the live region had announced the words; the next message replaces them there.
- Red to green: that test, and "the held reading stays readable after a later message replaces the note in the live region, and adds no announcement of its own". Passing before and after: "the canvas pane and the empty reading slot stay hidden from assistive tech".
- Not done, on purpose: no `showsMarks` change. A † mark in the held reading is also in the step text (the note quotes words of a line of its step), so the shared description is already rendered whenever the reading has a mark.
- By hand: with a screen reader at a held note, press the pace dial (a new live message): browse to the paragraph under the pane and it still reads "full ripe,".

## B10. Verify at source in Cook Mode

- Changed: `src/app/components/ArchiveSlip.tsx` (prop `verifyNote`, link `a.slip__verify` with `regionUrl(bundle, note)`, `target="_blank"`, `rel="noopener noreferrer"`, label `QUOTED.verify`, name `QUOTED.verifyName`; no new copy), `src/app/Cook.tsx` (passes the current note), `src/app/cook.css` (on desktop the link is a 44 px target inside the caption row's own 52 px; on a phone it runs on in the slip's paragraph like the licence link).
- Red to green: `src/app/Cook.test.tsx` "while a note is revealed the compact slip carries a verify-at-source link for that note, writing and held, and none without a note" and "the link follows the note of the step: step 4 links its own region". e2e `e2e/cook-verify.spec.ts` (desktop and 390 px): the slip's link href at the hold equals the Quoted page's link for the same note, attributes, inside the viewport, no horizontal scroll, axe, 44 px tall on desktop.
- By hand: open the hero deep link, wait for the hold, read the slip's "verify at source" href, press Wipe: the same URL is on "The hand, quoted" for that note.

## B11. SteamPane checks the fetched note text

- Changed: `src/steam/SteamPane.tsx`: only a string `span` or `shownText` is used; anything else gives `''`. `span` wins over `shownText` as before, so a non-string `span` gives `''` even when `shownText` is a string.
- Red to green (`src/steam/SteamPane.test.tsx`, new): "a non-string span (5, {"a":1}, ["x"], true) gives an empty note text, not its string form"; "a missing span falls back to shownText when that is a string, and to nothing when it is not" (a number there crashed `parseReading`); "a non-string shownText shows no reading under the pane". Passing before and after: the two string cases.
- By hand: serve `<stem>.json` with `"span": 5` on the spike page: the live region stays empty and nothing throws.
