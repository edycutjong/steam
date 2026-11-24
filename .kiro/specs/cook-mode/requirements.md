# Requirements: cook-mode

Requirements-first spec. `design.md` follows from this file and `tasks.md` from the design.

"The system" is the static web app in `src/app/`, the pure cook logic in `src/cook/`, the data helpers in `src/data/` (`provenance.ts`, `reading.ts`, the loader and the device store), and the small ingest additions of R21. It is the one flow of the product: **shelf → edition view → Cook Mode → the steam reveal → wipe → "The hand, quoted"**. Section references (§) point to `design.md`.

Scope boundaries:

- Data is real. The only recipes are the catalogued bundles in `public/recipes/<id>/` named by `content/catalog.json`. Today that is `quinces-marmalade` with three notes: `full-ripe` (step 1), `when-tender` (step 4) and `till-it-looks-red-smooth` (step 5, the hero). No mock recipe, no fixture recipe and no invented time exists in `src/`.
- The steam renderer (`SteamRenderer`, `SteamPane`, `StaticPane`, specs `steam-renderer` and `renderer-v0-frames`) is built. Its look and its public API are out of scope. This spec changes it only where the bundle needs it (R15).
- Out of scope: upload and in-browser ingestion, accounts, sharing, search, step-back navigation, a second recipe, any server, any model, any voice.

Terms:

- **Bundle**: `public/recipes/<id>/recipe.json`, validated by the zod `RecipeBundle` of `src/data/schema.ts`.
- **Displayable note**: a bundle note that passes P8 (R22). Only displayable notes are shown, revealed or quoted.
- **Step**: `steps[n-1]`. `stepIndex` is zero-based, "step n of N" is one-based.
- **Pending / revealed**: a displayable note is *pending* until the scheduler emits its reveal effect, *revealed* afterwards for the rest of the session.
- **Reveal**: the scheduler's decision to start the write-on of one note (R12). **Write-on**: the renderer's 5 s traced reveal (`WRITE_ON_MS`). **Held**: the renderer phase after the write-on, until the wipe.
- **Wipe**: the one advancing action of Cook Mode (button, drag, Space). On a step without a note it reads "Next step".
- **Pace**: 1 (real time), 4 or 12. **Wall time**: `Date.now()` in ms. **Elapsed**: the step clock in pace-scaled ms (R10).
- **Check time** (`checkAt`): `{seconds, source, basis}` with `source` one of `cited`, `step-entry`, `cook` (R8).
- **Interactive**: the Cook Mode screen has validated its bundle, decoded the first pane's note and drawn its first frame. It leaves the performance mark `cook:ready`.
- **Session**: one run of Cook Mode on one recipe, from a start event (`start`, `deepLink` or `restore`) to the last wipe.

---

## R1. Routes and navigation

**User story:** As a visitor, I want every screen to have a link I can share and reload, so that a judge can open the exact moment of the product.

1. THE SYSTEM SHALL use a hash router with exactly these routes: `#/` (shelf), `#/r/:id` (edition view), `#/r/:id/cook` (Cook Mode), `#/r/:id/quoted` ("The hand, quoted"), and the renderer harness route of R15.8.
2. THE SYSTEM SHALL parse a hash with the pure function `parseRoute(hash)` and build one with `formatRoute(route)`, both in `src/app/router.ts`, with no DOM access. `parseRoute` SHALL NOT throw for any string; an unknown or malformed hash gives `{name: 'notFound'}`.
3. THE SYSTEM SHALL accept the query `pace=1|4|12`, `note=<noteId>`, `lead=<seconds>` and `fps=1` on the cook route only. A missing, repeated or invalid value SHALL fall back to its default (`pace` 1, no `note`, `lead` 10, no overlay) and SHALL NOT make the route invalid. `lead` SHALL be a finite number from 0 to `LEAD_MAX_S` (120). Unknown query keys SHALL be ignored.
4. THE SYSTEM SHALL require `:id` to match the `RecipeId` pattern of `src/data/schema.ts`. WHEN `:id` is well formed but not in the catalog, THE SYSTEM SHALL render a "This recipe is not on the shelf" screen with a link to `#/`, not a blank page.
5. WHEN the route changes, THE SYSTEM SHALL swap the screen without a page reload, set `document.title` to the screen's name followed by "Her Hand in the Steam", and move keyboard focus to the screen's `<h1>` (made focusable with `tabindex="-1"`). The Cook Mode screen SHALL instead move focus to the Wipe control (R14.9).
6. THE SYSTEM SHALL support browser back and forward on every route, and SHALL give every screen a visible link or button to the previous screen of the flow (R4, R7, R9, R20).
7. THE SYSTEM SHALL NOT read `location.search`. All parameters live in the hash query.

## R2. Catalog and bundle loading

**User story:** As a judge, I want only real, checked recipes on the shelf, so that nothing I see is a stand-in.

1. THE SYSTEM SHALL read the list of recipes from `content/catalog.json`, imported at build time and validated with the zod `Catalog`. IF the catalog fails validation, THEN THE SYSTEM SHALL show the shelf error state (R4.9) and no card.
2. THE SYSTEM SHALL fetch `/recipes/<id>/recipe.json` from the same origin for every catalog entry and validate it with `RecipeBundle`.
3. THE SYSTEM SHALL NOT show a recipe whose bundle fails any of these checks, on any screen, and SHALL log one `console.warn` line with the recipe id and the first reason: the fetch fails; the zod schema fails; `bundle.id` differs from the catalog `id`; `bundle.gateSha256` differs from the catalog `gateSha256`; a note names a step that does not exist; two notes name the same step (Cook Mode supports one note per step, §8.3); a note group names a line that does not exist.
4. THE SYSTEM SHALL treat a note that fails P8 (R22) as withheld, not as a failure of the recipe: the recipe stays on the shelf, the step shows as a step without a note, and the edition view says so (R7.6).
5. THE SYSTEM SHALL contain no recipe data in `src/` outside tests. Every test that needs a recipe SHALL read `public/recipes/quinces-marmalade/` from disk or derive a variation of it in code.
6. THE SYSTEM SHALL request nothing from another origin. The only archive hosts in the built site are the `href` of "verify at source" links and of the archive slip, which the browser never fetches on its own. A Playwright run of the whole flow SHALL record every request and fail on any origin other than the app's, and a source scan SHALL list the hosts named in `src/`.
7. THE SYSTEM SHALL load each bundle once per page session and share it between the screens.
8. WHILE bundles load, THE SYSTEM SHALL show "Opening the shelf…" in a polite live region.

## R3. Archive slip and attribution

**User story:** As a judge, I want every screen that shows the scan to say where it comes from and who read and checked it, in the recorded words.

1. THE SYSTEM SHALL provide one `ArchiveSlip` component used on the shelf, the edition view, Cook Mode (while a note is visible) and "The hand, quoted". It shows, from the bundle only: institution, shelfmark, page, date, licence label (linked to the licence `url`) and credit. For quinces these read "Wellcome Collection", "MS.1810", "p.23", "c. 1750 (IIIF manifest)", "Public Domain Mark".
2. THE SYSTEM SHALL set the slip in DM Mono, small caps, tracking +0.08em, 12 px desktop and 11 px phone, with a `--rule` hairline above.
3. THE SYSTEM SHALL end every surface that shows the scan with the credit line `<credit>, <licence label>`, which reads "Wellcome Collection, Public Domain Mark" for quinces. The line SHALL be built from the bundle, not hard-coded.
4. THE SYSTEM SHALL print the expanded provenance (R7.4) with these lines, each from the bundle: work URL, manifest URL, canvas, image service, retrieved date; the reading line of R3.5; the review line of R3.6; the ownership review lines of R3.7; the alignment line of R3.8.
5. THE SYSTEM SHALL credit the readers as follows. WHERE `transcription.readers` is `["scribe", "second-reader"]`: "Read by the Kiro readers, scribe and second-reader: two independent readings, merged by code." WHERE it is `["fallback"]`: "Read by <transcription.by> (fallback reading, not by the Kiro readers)", with `by` verbatim. The page SHALL also state how many places the readers disagree, as `transcription.disagreements.length`.
6. THE SYSTEM SHALL show the sign-off exactly as recorded: "Reviewed by: <review.reviewedBy>, <review.reviewedAt>". For quinces, `reviewedBy` reads "Claude Code builder agent (autopilot P1b), not a human". THE SYSTEM SHALL NOT shorten, paraphrase or re-label it, and SHALL NOT use the words "curator", "editor", "expert", "verified by" or "approved".
7. THE SYSTEM SHALL show each ownership reviewer exactly as recorded in `ownership.reviewed[].reviewer`, for example "Kiro (agent), turn-18", next to its note id.
8. THE SYSTEM SHALL show the word-boundary choice of each note as "Word boundaries chosen by <alignmentBy>", with `alignmentBy` verbatim ("Kiro (agent), turn-24" for the hero). The internal value `alignment: "curator"` SHALL NOT appear in the UI.
9. THE SYSTEM SHALL NOT imply a human checked anything that the bundle does not say a human checked.

## R4. Shelf (S1)

**User story:** As a judge, I want to open the site and reach the product in one tap, with the provenance in sight.

1. THE SYSTEM SHALL render the title "Recipes in a hand" in IM Fell English (56 px desktop, 34 px phone) as the screen's `<h1>`.
2. WHILE the visitor has not yet left the shelf for a recipe, THE SYSTEM SHALL show under the title, in body type, the line "Every note you'll see is the writer's own hand, photographed. Nothing is generated." Afterwards it SHALL show the same words as a standing `--muted` line. The flag SHALL be kept on this device (R18.9).
3. THE SYSTEM SHALL render one card per displayable recipe, in catalog order. A card holds: the scan thumbnail on a `--paper` mat (the bundle's `page.jpg`, `loading="lazy"`, with its natural width and height set, alt text "The manuscript page, <shelfmark> <page>"), the recipe title in IM Fell English as a link to `#/r/:id`, the `ArchiveSlip` (title, shelfmark, page, date, licence, credit), and two buttons.
4. THE SYSTEM SHALL label the buttons "Cook it" and "Watch it at ×12". "Cook it" SHALL start a new session at step 1 in real time (`#/r/:id/cook`). "Watch it at ×12" SHALL start a new session at step 1 at pace 12 (`#/r/:id/cook?pace=12`). Both SHALL discard any saved session of that recipe first (R18.5).
5. THE SYSTEM SHALL make both buttons at least 48×48 CSS px and keyboard operable.
6. THE SYSTEM SHALL show no upload card, no placeholder card and no card for a recipe that is not in the catalog.
7. WHEN the viewport is 390×844, THE SYSTEM SHALL show the first card's title, slip and both buttons without scrolling.
8. THE SYSTEM SHALL name "Watch it at ×12" as accelerated playback wherever it leads: Cook Mode shows the pace badge of R11.4 from its first frame.
9. IF no recipe is displayable, THEN THE SYSTEM SHALL show "No recipe could be loaded." in place of the cards, and SHALL log the reasons of R2.3.

## R5. Edition view: the facsimile

**User story:** As a reader, I want to look at the page itself beside its transcription, so that I can judge the reading against the hand.

1. THE SYSTEM SHALL show the page scan (`page.jpg`) on a `--paper` mat with a `--rule` edge, with the credit line of R3.3 under it and a text alternative "A photograph of the manuscript page. The transcription beside it gives the same words."
2. THE SYSTEM SHALL let the reader zoom and pan the scan with: pinch (two pointers), Ctrl or ⌘ plus wheel, a "Zoom in", a "Zoom out" and a "Reset" button (each at least 48×48 CSS px), and the keys `+`, `-`, `0` and the arrow keys while the scan has focus. A plain wheel SHALL scroll the page when the scan is at scale 1, and SHALL pan the scan when it is zoomed.
3. THE SYSTEM SHALL keep the scale within `[1, MAX_ZOOM]` (`MAX_ZOOM` = 6) and SHALL clamp the pan so that the scan always covers its viewport, by the pure reducer in `src/app/facsimile.ts` (K4).
4. THE SYSTEM SHALL keep the point under the pointer or pinch centre fixed while zooming.
5. THE SYSTEM SHALL show the scan on the left and the transcription on the right at 1025 px and wider. At 1024 px and narrower it SHALL stack the scan above the transcription, the scan taking 40 vh.
6. THE SYSTEM SHALL change no pixel of the scan: no filter, no contrast change, no sharpening.

## R6. Edition view: the transcription

**User story:** As a reader, I want the line-by-line reading, with every place the two readers disagree shown, so that nothing is smoothed over.

1. THE SYSTEM SHALL list every line of `bundle.lines` in order, each with its line number in a gutter. The line number is the zero-based line index of `lines.json`, written with two digits ("00" to "11"), so that it matches `transcription.md` and the note groups.
2. THE SYSTEM SHALL set a line's text from `corrected` when present, else `merged`. WHERE a line has `corrected`, it SHALL also show the `merged` text beneath it in `--muted`, labelled "as merged".
3. THE SYSTEM SHALL render each reader disagreement `†[a|b]` of a line as the text `†[a|b]` in `--muted`, both readings visible, in Literata. An empty reading is written as nothing: `†[(N.26)|]`.
4. THE SYSTEM SHALL give each marker the role `group`, the accessible name "Readings: “a” or “b”" (an empty reading is spoken as "nothing"), and the accessible description "Two independent readers disagree on this word. The hand is shown as written.", through one shared hidden description element.
5. THE SYSTEM SHALL put the reading credit, the disagreement count and the legend "† marks a place where the two readers disagree; both readings are shown." above the list (R3.5).
6. THE SYSTEM SHALL parse markers with the pure `parseReading(line)` of `src/data/reading.ts`. FOR ALL lines the segments SHALL join back to the input (K2), and the number of markers SHALL equal the number of `†[` in the line.
7. THE SYSTEM SHALL set transcription text in Literata 400, 20 px desktop and 17 px phone, and SHALL NOT set any transcription in a handwriting-style font.
8. THE SYSTEM SHALL keep the text selectable and exposed to assistive technology as plain text.

## R7. Edition view: judgement lines, timing and provenance

**User story:** As a cook, I want to see which lines carry the writer's own judgement and when each will appear, and to adjust that for my own pan.

1. THE SYSTEM SHALL mark in the gutter every line that a displayable note quotes (`notes[].groups[].line`) with a steam glyph drawn in CSS or SVG (`aria-hidden`), and SHALL give the line the text "Judgement note on this line: <span>" for assistive technology.
2. THE SYSTEM SHALL show for each displayable note its moment, built by `checkLabel` (R8.2). A note whose check time is `step-entry` reads "with its step".
3. WHEN the reader activates a moment label, THE SYSTEM SHALL open the timing stepper of R8.5 for that note.
4. THE SYSTEM SHALL provide a "Read the provenance" button (`aria-expanded`) that opens the expanded archive slip of R3.4.
5. THE SYSTEM SHALL provide a primary "Cook it" button (new session, R4.4) and a link back to the shelf. Both SHALL be at least 48×48 CSS px.
6. WHEN one or more notes are withheld by P8, THE SYSTEM SHALL say so under the legend: "<n> note(s) withheld: the source of the note could not be checked." It SHALL NOT hide the line they quote.

## R8. Check times

**User story:** As a cook, I never want a cooking time that the page did not give, and I want to set my own.

1. THE SYSTEM SHALL take a note's check time from the device override of R8.4 when one exists, else from `note.checkAt` of the bundle. It SHALL compute no time from any other source (R36 of `ingest-pipeline`).
2. THE SYSTEM SHALL label every check time with its source through `checkLabel(checkAt)`: `step-entry` → "with its step"; `cited` → "check from <duration> · cited: <basis>"; `cook` → "check from <duration> · set by you", and "with its step · set by you" at 0 s. A duration is "<n> s" below 60 s, else "<m> min" or "<m> min <s> s".
3. THE SYSTEM SHALL show the `basis` of the effective check time in the stepper and in the expanded provenance.
4. THE SYSTEM SHALL keep overrides only on this device, in IndexedDB (R18.1), as `{recipeId, noteId, seconds}`, and SHALL mark an override with `source: "cook"` and the basis "set by you on this device".
5. THE SYSTEM SHALL provide a stepper with "Earlier" and "Later" buttons (each at least 48×48 CSS px, step `TIMING_STEP_S` = 30 s, range 0 to `TIMING_MAX_S` = 10 800 s), the current value, the basis, and "Reset to the manuscript's". It SHALL be keyboard operable, and each change SHALL be announced in a polite live region as "<note span>: <label>".
6. THE SYSTEM SHALL apply an override from the next session start. A running session SHALL NOT change its check times.
7. THE SYSTEM SHALL ship no default other than `step-entry` for a note whose bundle carries none. A test SHALL expect `step-entry` on all three notes of `quinces-marmalade`.

## R9. Cook Mode: screen and step engine (S3)

**User story:** As a cook with wet hands, I want one large step at a time, readable from arm's length.

1. THE SYSTEM SHALL lay out Cook Mode full-bleed: the steam window (R15) in the top 55% of the viewport on a phone; on desktop the window 60% of the width, centred, at most 1100 px wide. Below it on `--bg`: "Step n of N", the step text, the timer (R10), the flame knob (R11), and the controls row (Wipe, Back, Mute).
2. THE SYSTEM SHALL show the step text from `lines[lineIdx[]]` of the current step, each line's `corrected ?? merged` joined by one space, rendered with the markers of R6.3. FOR ALL steps with no `corrected` line, the text with markers resolved to the first reading SHALL equal `steps[n-1].text` (K2).
3. THE SYSTEM SHALL set the step text in Literata 500, line height 1.3, at least 24 px at 1024 px and narrower and at least 34 px at 1025 px and wider. The step panel SHALL show at least 2 lines and SHALL scroll (focusable, labelled "Step text") when the text is longer.
4. THE SYSTEM SHALL announce, in one polite live region (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`), "Step n of N. <plain step text>" on arrival at a step, composed as in R23.3.
5. THE SYSTEM SHALL move only forward. There is no previous-step control. "Back" SHALL navigate to the edition view (`#/r/:id`) and keep the session (R18).
6. THE SYSTEM SHALL show the archive slip (R3.1) under the pane while a note is revealed on the current step.
7. THE SYSTEM SHALL show, on a step without a note, the fogged pane (R15.5) and no slip.
8. WHILE the bundle or the first pane loads, THE SYSTEM SHALL show the fogged window frame, the step text of the starting step and "Opening the glass…" in the live region. It SHALL NOT start the scheduler's clock for the lead-in hold before the bundle has validated (R19.3).

## R10. Step timer

**User story:** As a cook, I want a clock that is right when my phone wakes up.

1. THE SYSTEM SHALL show the step's elapsed time as `m:ss` (and `h:mm:ss` from one hour), Literata 600, `tabular-nums lining-nums`, 64 px desktop and 44 px phone, in `--muted`.
2. THE SYSTEM SHALL compute elapsed from wall time and the pace history, by the pure `elapsedMs(state, wallMs)`, never by counting ticks. FOR ALL pace histories and wall times, elapsed SHALL equal the sum over the history of pace × the wall time spent at it.
3. THE SYSTEM SHALL keep elapsed monotonic: FOR ALL sequences of wall times, including a wall time that goes backwards, elapsed never decreases within a step (K3). A backwards wall time SHALL be treated as no time passing.
4. THE SYSTEM SHALL count time asleep: after a sleep and resume, the first displayed value SHALL include the time asleep at the pace in force.
5. THE SYSTEM SHALL set the timer in `--after` only while a reveal is scheduled on the current step and the wall time left before it is greater than 0 and at most `EMBER_WINDOW_S` (10 s), at any pace. At every other moment it SHALL use `--muted`. `--after` SHALL appear nowhere else in Cook Mode outside the pane, except dim on the pot flame.
6. THE SYSTEM SHALL update the displayed value at most every 250 ms and whenever the page becomes visible, and SHALL give the timer `role="timer"` with no live announcement per second.
7. WHEN the step changes, THE SYSTEM SHALL restart the timer at 0:00.

## R11. Flame knob and pace

**User story:** As a judge, I want to watch the whole flow quickly and be told plainly that it is faster than real time.

1. THE SYSTEM SHALL provide a flame knob with three stops: "Real time" (pace 1), "×4" and "×12". It SHALL be a slider (`role="slider"`, `aria-valuemin` 0, `aria-valuemax` 2, `aria-valuetext` "Real time", "×4 pace" or "×12 pace") that rotates between stops.
2. THE SYSTEM SHALL change the pace with the keys ← and → (and ↓ and ↑), by click or drag on the knob, and by a click on a stop label, each target at least 48×48 CSS px. The pace SHALL snap to a stop.
3. WHEN the pace changes, THE SYSTEM SHALL send `setPace` to the scheduler with the current wall time, and SHALL announce "Pace ×N" ("Pace real time" at 1) in the live region.
4. WHILE the pace is not 1, THE SYSTEM SHALL show a badge "×N pace" in DM Mono, pinned to the top right of the window, visible from the first frame. At pace 1 there SHALL be no badge.
5. THE SYSTEM SHALL scale only the step timer and the cited and cook check times by the pace (R12.6). A step-entry note does not wait, so at any pace it appears on arrival; the badge and the timer still tell the truth about the pace.
6. THE SYSTEM SHALL NOT use the pace to change the write-on, the wipe or the audio.

## R12. Scheduler

**User story:** As a developer, I want the reveal timing to be a pure state machine, so that it can be proven for every interleaving.

1. THE SYSTEM SHALL implement the scheduler in `src/cook/scheduler.ts` as pure functions with no DOM, no clock, no timer, no random and no I/O: `reduce(plan, state, event) → {state, effects}`, where `plan` is the fixed list of steps with their displayable note and check time in ms. Wall time arrives only inside events.
2. THE SYSTEM SHALL accept these events, each with `wallMs`: `start` (with the starting pace); `deepLink` (`stepIndex`, `leadMs`, pace); `restore` (a snapshot and an optional pace); `tick`; `sleep`; `resume`; `setPace` (1, 4 or 12); `show`; `wipe`.
3. THE SYSTEM SHALL emit these effects, in order, from one event: `reveal {noteId, cause: "scheduled" | "show" | "wipe", stepIndex}`, `advance {stepIndex}`, `finish`.
4. THE SYSTEM SHALL accept `start`, `deepLink` and `restore` only as the first event of a session. Any of them at another time, and any event before the first or after `finish`, SHALL change nothing and emit nothing (apart from clamping the wall time).
5. THE SYSTEM SHALL clamp every `wallMs` to at least the last wall time seen, so that a wall clock that steps back changes nothing.
6. THE SYSTEM SHALL schedule a note's reveal when both hold: the step's elapsed (pace-scaled, R10.2) has reached the note's check time in ms, and the lead-in hold of R12.9 has ended. A `step-entry` note (0 s) therefore reveals on arrival.
7. THE SYSTEM SHALL handle the events as follows. `tick`: emit the scheduled reveal if due and awake. `sleep`: process a `tick` at that wall time, then mark asleep. While asleep, `tick`, `show` and `wipe` SHALL only advance the clamped wall time and emit nothing. `resume`: mark awake, then process a `tick`, so a reveal that fell due during the sleep is emitted once, now. `setPace`: process a `tick` at the old pace, then switch pace from that wall time. `show`: IF the current note is pending and the machine is awake, emit `reveal {cause: "show"}`; otherwise nothing. `wipe`: IF the current note is pending, emit `reveal {cause: "wipe"}` first; then advance to the next step (or `finish` on the last step); on arrival at a step, process a `tick` at that wall time.
8. THE SYSTEM SHALL never emit a second reveal for a note that is in `revealed`, whatever the cause. A `scheduled` reveal that falls due after a `show` SHALL be a no-op.
9. WHEN started by `deepLink`, THE SYSTEM SHALL hold the reveal of the initial step's note until `startWall + leadMs`, in wall time and not scaled by the pace. The hold SHALL apply to that one note only.
10. THE SYSTEM SHALL expose pure helpers: `elapsedMs(state, wallMs)`, `nextDueWall(state)` (the wall time of the next scheduled reveal, or `null`), `noteState(state)` (`none`, `pending` or `revealed`), `toSnapshot(state, recipeId)` and `controlFor(state)` (R14.1).
11. THE SYSTEM SHALL keep the state a plain, JSON-serialisable object.

## R13. Property P7: each note is revealed exactly once

**User story:** As a cook whose phone sleeps, I want the note to appear once when I come back, and never twice.

1. THE SYSTEM SHALL provide `src/cook/scheduler.prop.test.ts` (fast-check). Its generator SHALL produce a recipe plan (1 to 8 steps, notes on any subset of steps, check times from 0 to 3 600 s, one note per step at most) and a session of up to 200 events drawn from every event of R12.2, with arbitrary non-decreasing and occasionally decreasing wall times, a deep link with a random `leadMs` or a restore or a plain start, and arbitrary pace changes.
2. FOR ALL such sessions, each note on a step visited from the session's initial step onward SHALL be revealed EXACTLY ONCE, once the session has been flushed (a final `resume` if asleep, then a `tick` far in the future); and no note SHALL ever be revealed twice, at any point of the session.
3. FOR ALL sessions, a `scheduled` reveal SHALL carry a wall time at which the elapsed has reached the check time and the lead-in hold has ended. A `show` reveal SHALL come from a `show` event that found the note pending. A `wipe` reveal SHALL come from a `wipe` event that found the note pending, and SHALL be followed by `advance` (or `finish`) in the same event.
4. FOR ALL sessions, no note SHALL be left unrevealed when its step is left: every `advance` and `finish` SHALL follow a reveal of that step's note, earlier or in the same event.
5. FOR ALL sessions, no reveal SHALL be emitted while asleep, and a reveal that fell due while asleep SHALL be emitted at the first awake event after the due time.
6. FOR ALL sessions, the step index SHALL never decrease, SHALL rise by exactly 1 per `advance`, and the elapsed of the current step SHALL never decrease (R10.3).
7. FOR ALL pace changes, a reveal SHALL fall at the pace-scaled check time: with pace history `h`, the reveal wall time SHALL be the least wall time at which `elapsedMs` reaches the check time (within one event's wall step).
8. FOR ALL sessions started by `deepLink`, the initial step's note SHALL NOT be revealed by `scheduled` before `startWall + leadMs`, and SHALL be revealed by it at the first awake event at or after that time when its check time is 0.
9. FOR ALL restored sessions, no note in the snapshot's `revealed` SHALL be revealed again.
10. EVERY row of the Wipe state table (R14.1) SHALL be a named case of this test file, driven by `controlFor` and the event it prescribes.
11. Notes on steps before a deep link's initial step are out of scope: the test SHALL NOT require their reveal, and SHALL require that none is emitted.

## R14. Wipe control and the state table

**User story:** As a cook, I want one big control that always says what it will do.

1. THE SYSTEM SHALL label and drive the Wipe control by this table, computed by `controlFor(state)`:

   | State of the current step | Label | Action sent |
   |---|---|---|
   | no displayable note, not the last step | "Next step" | `wipe` |
   | note pending | "Show the note" | `show` (starts the same write-on at once) |
   | note revealed, pane held, not the last step | "Wipe the glass" | `wipe` (advances) |
   | last step, note revealed and held, or no note | "The hand, quoted" | `wipe`, then navigate to `#/r/:id/quoted` |

2. THE SYSTEM SHALL, while the pane is writing a revealed note, keep the label of its row, set `aria-disabled="true"` and the accessible description "The note is being written", and ignore the activation. This is a state of the pane, not of the scheduler.
3. THE SYSTEM SHALL make the control a `<button>` of at least 48×48 CSS px (in practice at least 56 px tall), at the bottom centre of the controls row, and SHALL NOT place it over the pane.
4. THE SYSTEM SHALL let a drag across the pane do what the button does at that moment (R14.1), by the pure recognizer `dragWipe` in `src/cook/drag.ts`: a pointer path whose horizontal travel (the sum of its horizontal steps) is at least `DRAG_MIN_PX` (96 px) and at least 25% of the pane width, completed within 2 s. A tap, a short move or a scroll SHALL never act.
5. THE SYSTEM SHALL let the Space key do what the button does, unless focus is inside another interactive element (a focused button acts natively), and SHALL prevent page scroll.
6. THE SYSTEM SHALL ignore a second activation within the 400 ms after the first, so that a double tap advances one step.
7. THE SYSTEM SHALL never skip a note: no control, key, drag, route or timer SHALL move the session past a step whose displayable note has not been revealed (R12.7, R13.4).
8. WHEN the wipe advances, THE SYSTEM SHALL announce "Glass wiped. Step n of N. <text>" (R23.3), and SHALL play the sweep of the outgoing pane to its end before the next pane replaces it (R15.6).
9. WHEN Cook Mode is ready, THE SYSTEM SHALL focus the Wipe control, so that Space and Enter work at once. The pane SHALL carry `touch-action: none` so that a drag does not scroll.
10. THE SYSTEM SHALL show a visible focus ring (R23.4) on the control.

## R15. The steam window in Cook Mode

**User story:** As a cook, I want the writer's note to appear in the glass at its moment, from the real scan.

1. THE SYSTEM SHALL extract from `SteamPane.tsx` a `SteamGlass` component: the sash, rails, canvas (or `StaticPane`) and load error, without the button, credit, live region or URL reading. `SteamPane` SHALL become `SteamGlass` plus its existing chrome, with the same behaviour as today.
2. THE SYSTEM SHALL give `SteamGlass` the props `stem` (the URL stem of the note's three files), `paneDir` and `noteId` (for the `StaticPane` images), `params` (a `SteamParams`, never read from the URL), `controllerRef`, `onState`, `onReady` (called once when the first frame is drawn, or the static images are decoded) and `initial` (`"fogged"` or `"held"`).
3. THE SYSTEM SHALL feed the renderer from the bundle's note files `note-<id>.png`, `note-<id>.toi.png` and `note-<id>.json`. `NoteMeta` SHALL read the text from `shownText` (replacing `text`) and the time ranges from `groups`, and SHALL check that the JSON `noteId` and `size` equal the bundle's note.
4. WHEN Cook Mode drives the pane, THE SYSTEM SHALL create it with `lead` = `Infinity`, so that it never reveals by itself, and SHALL call `startReveal()` only when a reveal effect is applied (R15.7). WHERE the session restores a revealed note, it SHALL create the pane `initial: "held"` (lead = `−WRITE_ON_MS`), without replaying the write-on.
5. THE SYSTEM SHALL choose the pane's note for a step by `paneNoteFor`: the step's own displayable note; else the next displayable note after it; else the last displayable note. It SHALL keep the pane fogged (no `startReveal`) until a reveal effect for that note is applied, which by the guarantee of R1.1 of `steam-renderer` shows no pixel of the note. IF the recipe has no displayable note, THEN THE SYSTEM SHALL show the fog-only `StaticPane`.
6. THE SYSTEM SHALL, when the wipe advances, keep the outgoing pane until its sweep has finished (`WIPE_MS`), then replace it by a fresh pane through an opacity-only crossfade of 600 ms. At most two panes SHALL exist at once, and only during that crossfade. A pane SHALL dispose its WebGL resources on unmount (R14.5 of `steam-renderer`).
7. THE SYSTEM SHALL apply a reveal effect through a gate: IF the pane of that note is not ready (assets decoded, first frame drawn, outgoing sweep finished), THEN the effect SHALL wait and be applied once, when it is ready. The gate SHALL apply each effect at most once. The reveal's performance mark `cook:reveal:<noteId>` SHALL be set when the effect is applied, and `cook:write-on:<noteId>` when the renderer enters `writing`.
8. THE SYSTEM SHALL provide the renderer harness route `#/pane/:id/:noteId`, linked from nowhere, which renders `SteamPane` for that bundle note with the existing `t`, `lead` (ms) and `fps` parameters, read from the hash query only (R1.7), so that the renderer's e2e specs and the `static-panes` script keep a fixed note after `public/hero/` is gone.
9. THE SYSTEM SHALL delete `public/hero/` and every reference to it (tests, helpers, scripts, `HERO_DIR`, `NOTE_STEM`) once the bundle's note files feed the pane; a test SHALL fail if `public/hero` exists or if any file under `src/`, `e2e/` or `scripts/` names it. A renderer test that needs a fixed note SHALL use `till-it-looks-red-smooth` from the bundle.
10. THE SYSTEM SHALL, for `StaticPane`, read its images per note from `public/recipes/<id>/panes/<noteId>-<kind>-<state>.webp` (`kind` `page` or `groups`, `state` `fogged`, `held` or `wiped`), produced by `npm run static-panes` from the real renderer and committed. A test SHALL fail if any of the six files of a catalogued note is missing.
11. THE SYSTEM SHALL prepare the notes the session can reach: the pane's current note before `cook:ready`, the others in idle time and never while a pane is writing. A prepared note (decoded bitmaps and `derive` output) SHALL be kept for the session. IF a note is not prepared when its reveal is applied, THEN the gate of R15.7 SHALL wait for it.
12. IF a note's files fail to load or validate, THEN THE SYSTEM SHALL show "The scan of this note could not be loaded." with its typed transcription (`span`, with markers) in body type, labelled as the transcription and not as the hand, and SHALL still let the cook continue. It SHALL NOT mark the failure as a reveal.

## R16. Haunting cue and audio

**User story:** As a cook looking away from the screen, I want the room to change when the writer's note arrives.

1. THE SYSTEM SHALL, when a reveal effect is applied, dip the hood lamp once (a brightness overlay of `--bg` on the whole screen, by the pure `cueEnvelope(tMs)`) and drop the simmer to near-silence and back, by the same envelope. The cue SHALL fire once per applied reveal and SHALL NOT fire at any other moment.
2. THE SYSTEM SHALL keep the lamp dip under `prefers-reduced-motion: reduce`, as a single brightness change with no movement and no flashing. THE SYSTEM SHALL NOT change the brightness of any region more than once per cue, and SHALL NOT start a second cue within 3 s of the first.
3. THE SYSTEM SHALL generate the simmer in Web Audio as brown noise (`brownNoise(n, seed)`, a leaky integration of seeded white noise, normalised, with its two ends matched so that the loop has no click), through a low-pass filter and a gain. It SHALL use no audio file, no music and no speech synthesis, and SHALL NOT contain `speechSynthesis` or `SpeechSynthesisUtterance` anywhere in `src/` (hook `no-imitation`).
4. THE SYSTEM SHALL create and resume the `AudioContext` only after the first user gesture (`pointerdown`, `keydown` or `touchend`) anywhere in the app, and SHALL make no sound before it. A test SHALL show that the context factory is not called before a gesture.
5. THE SYSTEM SHALL provide a Mute control (`<button aria-pressed>`, at least 48×48 CSS px) labelled "Mute" while sound plays and "Unmute" when muted or not yet unlocked. Activating "Unmute" before any gesture SHALL itself unlock the context. Muting SHALL ramp the gain to 0 in at most 100 ms, and the choice SHALL be kept on this device (R18.9).
6. IF the Web Audio API is unavailable, THEN THE SYSTEM SHALL disable the Mute control with a visible reason ("This browser has no sound") and SHALL still play the lamp dip.
7. THE SYSTEM SHALL suspend the audio while the page is hidden and resume it when it is visible and not muted.
8. THE SYSTEM SHALL keep the simmer level and the duck depth as named constants (`SIMMER_GAIN`, `SIMMER_DUCK`) in `src/cook/cue.ts`, and SHALL NOT output a gain above `SIMMER_GAIN`.

## R17. Screen wake lock

**User story:** As a cook, I want the phone to stay awake at the stove where the browser allows it.

1. WHERE `navigator.wakeLock` exists, THE SYSTEM SHALL request a `screen` lock when Cook Mode is visible, request it again each time the page becomes visible, and release it when Cook Mode closes or the session finishes.
2. IF the request is refused or throws, THEN THE SYSTEM SHALL carry on without a message and SHALL NOT retry in a loop.
3. WHERE `navigator.wakeLock` does not exist, THE SYSTEM SHALL do nothing and SHALL NOT claim the screen will stay awake.
4. THE SYSTEM SHALL publish the outcome as `data-wake="held" | "refused" | "unsupported"` on the Cook Mode root, for tests only.
5. THE SYSTEM SHALL NOT depend on the lock: sleep is handled by R12 and R13.

## R18. Session persistence and restore

**User story:** As a cook, I want my place back after a reload or a sleep.

1. THE SYSTEM SHALL keep device-local data in IndexedDB database `steam`, version 1, with three stores: `sessions` (key `recipeId`), `timing` (key `<recipeId>/<noteId>`) and `settings` (key string). THE SYSTEM SHALL send nothing off the device.
2. THE SYSTEM SHALL save the session snapshot `{v: 1, recipeId, stepIndex, stepStartWall, paceHistory, revealed}` after every event that changes the scheduler state and when the page is hidden. `paceHistory` is the list of `{atWall, pace}` since the step began, the first entry at `stepStartWall`. `revealed` is the list of revealed note ids.
3. THE SYSTEM SHALL validate a snapshot with a zod schema before using it. A snapshot that is malformed, names another recipe, a step out of range or a note that is not on the recipe, whose `paceHistory` does not start at `stepStartWall`, or whose `stepStartWall` is more than `SESSION_MAX_AGE_MS` (12 h) in the past SHALL be discarded and a fresh session SHALL start.
4. WHEN `#/r/:id/cook` opens with no `note` and a valid snapshot exists, THE SYSTEM SHALL restore it with the `restore` event, show "Resumed at step n of N" and offer "Start again". A `pace` in the route SHALL replace the restored pace.
5. THE SYSTEM SHALL discard the saved session of a recipe when the visitor presses "Cook it", "Watch it at ×12" or "Cook again", when a `note` deep link opens, when "Start again" is pressed, and when the session finishes.
6. THE SYSTEM SHALL restore a revealed current note as held, with no replay of the write-on (R15.4), and SHALL announce "Resumed at step n of N. <text>" and then the note's announcement.
7. THE SYSTEM SHALL, on reload, count the time since the step began at the restored pace history (R10.4), so that a note that fell due while the page was closed is revealed once when it opens (R12.7).
8. IF IndexedDB is unavailable or throws, THEN THE SYSTEM SHALL fall back to memory for the page session, SHALL restore nothing after a reload, and SHALL show one muted line "This browser will not keep your place." on the Cook Mode screen and "Not saved on this device." beside the stepper.
9. THE SYSTEM SHALL keep in `settings`: `introSeen` (R4.2) and `muted` (R16.5).

## R19. Deep link

**User story:** As a judge, I want a link that goes straight to the moment, and a reveal I do not have to ask for.

1. WHEN `#/r/:id/cook?note=<noteId>` opens and `<noteId>` is a displayable note of the recipe, THE SYSTEM SHALL start a new session at that note's step with the `deepLink` event and show the caption "Started at step n of N".
2. THE SYSTEM SHALL honour `pace` on a deep link. For the hero: `#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12` starts at step 5 of 5 at ×12 with the badge.
3. THE SYSTEM SHALL send the `deepLink` event when the bundle has validated, with `leadMs` = `lead` × 1000 (default 10 000), and SHALL count the lead-in hold from that wall time. The reveal SHALL be applied at the later of the end of the hold and the readiness of the pane (R15.7).
4. WHEN no input is given, THE SYSTEM SHALL begin the reveal (the reveal effect applied, `cook:reveal:<noteId>`) no later than `max(lead, load time)` after the session start. FOR a default `lead` this is no more than 10 s after `cook:ready`, because the hold starts before the screen is interactive.
5. IF `note` is not a displayable note of the recipe, THEN THE SYSTEM SHALL start at step 1 and show "That note is not on this page. Started at step 1 of N."
6. THE SYSTEM SHALL start no audio and ask for no permission on a deep link; sound begins at the first gesture (R16.4).
7. THE SYSTEM SHALL let "Show the note" press during the hold reveal at once (R12.7), and the scheduled reveal SHALL then be a no-op.
8. THE SYSTEM SHALL publish `data-started-at-step` and the marks of R15.7 so that the e2e specs can measure the time to reveal.

## R20. "The hand, quoted" (S6)

**User story:** As a judge, I want to see every note the writer left, as the writer wrote it, and to check it against the archive.

1. THE SYSTEM SHALL render the title "The hand, quoted" in IM Fell English as the screen's `<h1>`.
2. THE SYSTEM SHALL list one row per displayable note, in step order. A row holds: the crop, the transcription of the note's quote with its uncertainty marks (R6.3), "Step n", the archive slip, and the "verify at source ↗" link.
3. THE SYSTEM SHALL show the crop as the note PNG (`note-<id>.png`, the scan pixels with the owned-ink alpha) on a `--paper` mat, scaled by CSS only, with the text alternative "The writer's note, handwritten: <span>". It SHALL NOT re-typeset, trace, enhance or recolour it.
4. THE SYSTEM SHALL build the note's transcription with `quoteSegments(bundle, note)` of `src/data/reading.ts`, from the `groups[].words` ranges of the lines the note quotes, joined by one space across lines. FOR ALL displayable notes, the primary text of the segments SHALL equal `note.span` up to the trailing punctuation that `span` omits (K2).
5. THE SYSTEM SHALL make "verify at source ↗" an `<a target="_blank" rel="noopener noreferrer">` whose `href` is the IIIF Image API region URL of R21.4, with the accessible name "Verify at source: opens the same pixels on the Wellcome Collection image server in a new tab".
6. WHERE `note.verifyApproximate` is true, THE SYSTEM SHALL add the muted line "The region is the note's bounding box on the original page and may take in a little of the lines beside it."
7. THE SYSTEM SHALL end the list with the credit line of R3.3 and, below it, "Cook again" (new session at step 1, R4.4) and a link to the edition view.
8. THE SYSTEM SHALL open directly from its route with no session, and SHALL show a row for every displayable note whether or not the cook has seen it.
9. THE SYSTEM SHALL show no upload action.

## R21. Bundle additions and the IIIF region

**User story:** As a judge, I want the verify link to name the same pixels on the archive's server, to the pixel.

The bundle lacks four things that the app needs. They are added at catalog time, without touching any gate input, so that `gateSha256` and the recorded review stay valid.

1. THE SYSTEM SHALL record the manifest canvas in `source.json` as `canvas: {id, width, height}` (the canvas `@id`, `width` and `height` of the manifest), by a new `steam-ingest canvas <id> [--from-fixture]` command that changes nothing else, with `--from-fixture` reading `fixtures/wellcome-manifest-b18419665.trimmed.json` (3695×4737 for quinces). `source.json` is not a gate input.
2. THE SYSTEM SHALL write into every bundle, from `buildRecipeBundle`: `source.canvas` (required in a bundle), `source.frame` (always, `{width, height, scaleX, scaleY}`, the frame of `lines.json` when `source.json` has none), `notes[].verifyBox` (`[x, y, w, h]` in page-frame px, the same rectangle `verifyUrl` converts to percentages, deskew-aware and clipped to the frame) and `review: {reviewedBy, reviewedAt}` (required unless the readers are `["fallback"]`).
3. THE SYSTEM SHALL produce `verifyBox` and the percentage URL from one computation, so that the two cannot disagree. A test SHALL check that regenerating the bundle leaves `gateSha256` unchanged and changes no file of `content/recipes/quinces-marmalade/` that `gate.json` hashes.
4. THE SYSTEM SHALL build the region URL as `{imageService}/{x},{y},{w},{h}/full/0/default.jpg`, with `x = floor(vx·sx)`, `y = floor(vy·sy)`, `x1 = ceil((vx+vw)·sx)`, `y1 = ceil((vy+vh)·sy)` clipped to the canvas, `w = x1−x`, `h = y1−y`, `sx = canvas.width / frame.width`, `sy = canvas.height / frame.height`, so that the crop contains every pixel of the note's box. All four numbers are integers and `w`, `h` ≥ 1.
5. THE SYSTEM SHALL compute the region in `src/data/provenance.ts` by the pure `regionOf(bundle, note)` and `regionUrl(bundle, note)`.
6. THE SYSTEM SHALL agree with the percentage `verifyUrl` of the bundle: each edge of the pixel region SHALL be within 1 canvas px of the corresponding percentage times the canvas size, plus the rounding of the 4-decimal percentage (at most 1e-6 × the canvas side).
7. IF `source.canvas` or `verifyBox` is missing, THEN the schema SHALL fail and the recipe SHALL NOT be shown (R2.3); the app SHALL NOT guess a canvas width.

## R22. Property P8: every displayed note resolves to its source

**User story:** As a judge, I want no note on screen whose source cannot be checked.

1. THE SYSTEM SHALL provide `provenance.ts` with `resolveNote(bundle, note)` returning `{ok: true, manifest, canvas, region, licence, regionUrl}` or `{ok: false, reason}`, and `displayableNotes(bundle)` returning the notes with `ok`.
2. THE SYSTEM SHALL return `ok` only when: `source.manifest` is an https URL; `source.canvas.id` is non-empty and `source.canvasIndex` is an integer; the note's `provenance` agrees with `source` in institution, shelfmark, page, date, licence id and credit; the licence id is one of `pdm`, `cc0`, `cc-by`; the region is four integers with `w`, `h` ≥ 1 inside the canvas; and `regionUrl` parses back to the same service and region.
3. THE SYSTEM SHALL provide `src/data/provenance.prop.test.ts` (fast-check). FOR ALL bundles built from the real bundle by random valid and invalid mutations: a note is displayable if and only if R22.2 holds; a displayable note's URL parses to exactly its region; the region contains the scaled box and exceeds it by less than 2 canvas px per edge, except where clipped; no displayable note has a licence outside the three ids; and the shelf, edition, Cook Mode and quoted lists contain exactly the displayable notes.
4. THE SYSTEM SHALL call `displayableNotes` once per bundle at load, so that no screen can show a note that failed.

## R23. Accessibility

**User story:** As a keyboard, screen-reader or reduced-motion user, I want the same flow and the same notes.

1. WHEN `prefers-reduced-motion: reduce` matches, THE SYSTEM SHALL show the static reveal: `StaticPane` (no canvas), the held image crossfading in over 600 ms (opacity only) at the same moment as the live reveal would start, the lamp dip kept (R16.2), no particle, no flash. The step, the announcement and the Wipe table SHALL be the same.
2. THE SYSTEM SHALL make every function reachable and operable by keyboard alone: the shelf buttons, the facsimile, the stepper, the disclosure, the knob (←/→), the Wipe control (Space, Enter), Mute, Back, and the verify link.
3. THE SYSTEM SHALL announce through the one live region of R9.4, one composed message per batch of changes: arrival `Step n of N. <plain step text>`; arrival with a reveal adds ` The writer's note, handwritten: <span>`; a wipe prefixes `Glass wiped. `; a pace change `Pace ×N`; a restore `Resumed at step n of N.`; a deep link `Started at step n of N.`. Plain text turns each marker `†[a|b]` into "a (the second reader reads b)" and an empty reading into "nothing".
4. THE SYSTEM SHALL show a focus ring on every focusable element, at least 2 px, in `--ghost`, with at least 3:1 contrast against its neighbour, and SHALL NOT remove the outline without an equal replacement.
5. THE SYSTEM SHALL meet contrast with the tokens of `src/index.css`: `--ink` and `--muted` text on `--bg` at least 4.5:1 (`--muted` at its sizes); `--after` timer digits on `--bg` at least 3:1 at 44 px. A test SHALL compute these from the token values.
6. THE SYSTEM SHALL give every image a text alternative or `aria-hidden`, every control an accessible name, and the page one `<h1>` per screen and `lang="en"`.
7. THE SYSTEM SHALL pass the axe rules `color-contrast`, `button-name`, `link-name`, `image-alt`, `aria-valid-attr`, `aria-required-attr` and `label` on each screen, in the e2e specs.
8. THE SYSTEM SHALL respect `prefers-reduced-motion` for every transition it adds, except the lamp dip.

## R24. Responsive layout

**User story:** As a phone cook and a desktop judge, I want each screen to fit its device.

1. THE SYSTEM SHALL use the breakpoints phone ≤ 480 px, tablet 481 to 1024 px, desktop ≥ 1025 px. Tablet uses the phone arrangement with a larger window.
2. THE SYSTEM SHALL meet these sizes: step text R9.3; timer R10.1; title 56 px desktop, 34 px phone; transcription R6.7; archive slip R3.2; buttons at least 48×48 CSS px, 17 to 18 px Literata 600.
3. THE SYSTEM SHALL give Cook Mode no horizontal scroll and no clipped control at 360×800, 390×844, 768×1024, 1280×720 and 1920×1080.
4. THE SYSTEM SHALL keep the pane's phone layout (stacked note groups, core band at least 16 CSS px) as the renderer spec defines it, and SHALL NOT override its sizing.
5. THE SYSTEM SHALL use the three fonts of `tech.md` only: IM Fell English for titles, Literata for body, DM Mono for shelfmarks, coordinates and the pace badge.

## R25. Words, claims and the writer

**User story:** As a reader of the product, I want it to say only what is true and never to speak for the writer.

1. THE SYSTEM SHALL keep every fixed string of the UI in `src/copy/` and SHALL fail a test that finds, in the string literals of `src/copy/` and `src/app/`: the words "she", "her", "hers" (except in the product title "Her Hand in the Steam"), "curator", "AI-powered", "Kiro-powered", "generated by", "enhanced", "restored", "chatbot", "assistant"; or a digit other than in the pace labels "×4" and "×12". Every other number on screen SHALL be computed at run time from a bundle file or a named constant (honesty steering).
2. THE SYSTEM SHALL speak of the writer as "the writer" or "a dead writer's hand", and SHALL NOT present any persona.
3. THE SYSTEM SHALL describe the write-on only as "traced left to right from the ink" and SHALL NOT call it the writer's pen order.
4. THE SYSTEM SHALL label any accelerated playback with its pace (R11.4).
5. THE SYSTEM SHALL show the credit "Wellcome Collection, Public Domain Mark" on every surface that shows the scan: shelf cards, edition view, Cook Mode (under the pane while a note is visible), "The hand, quoted".
6. THE SYSTEM SHALL contain no speech synthesis, no recorded voice and no handwriting-style font anywhere, and no note shown in any typeface except as a labelled typed transcription beside, or in place of a failed, scan.

## R26. Runtime, size and speed

**User story:** As a judge, I want a static site that is fast on a phone.

1. THE SYSTEM SHALL run with no server, no model and no Kiro, and SHALL build to a static `dist/`.
2. THE SYSTEM SHALL measure, never assume, the Cook Mode frame rate on the deep-link path: `scripts/measure-cook.ts` SHALL write `bench/cook.json` with mean fps, minimum fps, worst frame time and frames over 18.2 ms for desktop and for a Pixel 5 profile with 4× CPU throttling, and the time from navigation to `cook:ready` and to the reveal. The budget is at least 55 fps average with no frame under 55 fps. A failing result SHALL be reported as measured, not hidden.
3. THE SYSTEM SHALL NOT start a `derive` of another note while a pane is in `writing`, because `derive` takes about 96 ms unthrottled and 353 ms at 4× throttle on the main thread (`bench/steam-renderer.json`) until the open task 39 of `steam-renderer` moves it to a worker.
4. THE SYSTEM SHALL start no timer, listener or audio node that outlives its screen: every one SHALL be released on route change (tested with a leak check on the timer and listener counters).

## R27. End-to-end tests

**User story:** As the builder, I want the whole flow proven in a browser.

1. THE SYSTEM SHALL provide `e2e/cook-flow.spec.ts` (Playwright, production build). The main case: open `#/`; the quinces card shows its slip and both buttons; open the edition view; the transcription shows as many `†[…|…]` markers as the bundle lists disagreements (the count read from the bundle), each with the description of R6.4; the three notes show "with its step"; open the deep link `#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12`; with no input, the reveal mark `cook:reveal:till-it-looks-red-smooth` appears no later than 10 s after `cook:ready` (the measured time written to the test log); the live region reads "The writer's note, handwritten: till it Looks red & smooth"; the label reads "Wipe the glass" once held; press it; the label reads "The hand, quoted"; press it; the quoted screen shows three rows in step order; the hero row's verify link has the exact URL that `regionUrl` returns for the bundle (shape `…/b18419665_MS_1810_0033.JP2/{x},{y},{w},{h}/full/0/default.jpg`, four integers); the last line reads "Wellcome Collection, Public Domain Mark"; "Cook again" opens step 1.
2. THE SYSTEM SHALL provide the full-flow case: from the shelf, "Watch it at ×12", then step 1 (note pending → "Show the note" or arrival reveal), through every row of the Wipe table to "The hand, quoted", with the badge "×12 pace" visible throughout.
3. THE SYSTEM SHALL provide a reduced-motion case (`emulateMedia({reducedMotion: 'reduce'})`): no `canvas`, the held image opacity transitions over 600 ms, the same live-region text, the lamp overlay present.
4. THE SYSTEM SHALL provide a keyboard-only case: Tab, Enter, Space and ←/→ only, from the shelf to "The hand, quoted"; every control focused shows the ring; the knob changes pace with ←/→.
5. THE SYSTEM SHALL provide a sleep case using the browser clock (`page.clock`): a long fast-forward past a pending cited-or-set check time reveals the note exactly once on resume; the timer reads the full elapsed time.
6. THE SYSTEM SHALL provide a restore case: reload mid-session restores the step, the pace and the held note without replaying the write-on, and "Cook it" from the shelf starts at step 1.
7. THE SYSTEM SHALL provide a phone case at 390×844: shelf above the fold (R4.7), Cook Mode with no horizontal scroll, the Wipe control at least 48×48 CSS px, step text at least 24 px.
8. THE SYSTEM SHALL provide an unreadable-bundle case: a route that serves an invalid `recipe.json` shows no card for it, and a withheld note (a bundle with an unsupported licence) leaves the step without a note.
9. THE SYSTEM SHALL run these specs in CI after `npm run build`, and the existing renderer specs SHALL pass unchanged in behaviour through the harness route (R15.8).
