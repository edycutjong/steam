# Bugfix: cook-mode-qa-r1

A reviewer drove the running app (shelf, edition, deep link, reveal, wipe, quoted) on desktop 1280x800 and Pixel 5, and looked at `docs/kiro-evidence/cook-mode/screens/`. Eight findings were accepted (Q1 to Q8). Each is fixed with a test written first (seen failing on the unfixed code), one commit each, titled `[kiro] cook-mode-qa-r1: Q<n> …`. Nothing is pushed by this spec; the builder pushes after its scans.

Terms. "Paced": the pace is ×4 or ×12, so the clock shows cooking time, not wall time. "Writing": the pane has the revealed note and has not yet reached `holding` (phases `fogged`, `thickening`, `writing` after a reveal). "Held": the note stands on the glass (`holding`, or a note whose scan failed and shows typed).

## Current Behavior

1. **Q1.** At ×12 the step timer reads "3:17" a few seconds after arrival, like real minutes. The pace is only on the badge over the glass, not tied to the clock, and the timer's accessible name is just its digits.
2. **Q2.** While the note is being written on the glass (about 1.5 s after arrival at real time) the Wipe button reads "Wipe the glass" (or "The hand, quoted" on the last step) although pressing it does nothing. Only `aria-disabled` and a hidden description say why.
3. **Q3.** `DisagreeDescription` ("Two independent readers disagree on this word. The hand is shown as written.") is a visible-to-screen-reader paragraph on every Cook step and every "The hand, quoted" screen, including steps and rows with no † mark, where it reads as stray text. It belongs to the † spans only.
4. **Q4.** Edition view: each judgement line shows a moment chip "with its step". The reviewer could not tell that it opens a per-note timing stepper. There is no e2e that it opens, shows its basis, saves a time on this device (IndexedDB) that survives a reload, and that Cook Mode then uses it.
5. **Q5.** Pixel 5 (393 px) Cook Mode at a held note: the fixed control bar cuts the step text after one line; the "×12 PACE" badge sits over the moon; about four rows of meta (archive slip fields, credit line, "Started at step n of N", "Start again") push the step text below the fold. The step text also scrolls inside its own 4-line box.
6. **Q6.** Shelf: one small card on a large dark void. On a phone the thumbnail is about 90 px and the second button ("Watch it at ×12") falls below the fold.
7. **Q7.** In Cook Mode the Wipe control takes focus once the pane is ready (R14.9), so the next Tab moves to Mute and then to the links and buttons that sit above the pane (archive licence link, "Start again"): after Mute although they are above. The tab order is not tested against the visual order on any screen.
8. **Q8.** On a lost WebGL context that is not restored, `SteamGlass` swaps in `StaticPane`, which starts a new reveal clock at `fogged` (lead ∞). A note that was held or being written disappears from the glass, and the Wipe control stays on "writing" for good. No test forces a loss.

## Expected Behavior

1. **Q1.** While the pace is ×4 or ×12 the timer says it is paced, inside the same element: the digits and a caption "cooking time at ×12" (or ×4). The timer's accessible name carries the same ("3:17, cooking time at ×12"). At real time nothing is added. The numbers still come from the clock (elapsed cooking time at the pace history); no new time is invented.
2. **Q2.** While the note is writing, the Wipe button reads "The hand is writing…", has `aria-disabled="true"`, does nothing when activated, and keeps focus. It reads "Wipe the glass", "The hand, quoted", "Next step" or "Show the note" only by the Wipe table, once the note is held. A test covers every row of the Wipe table: pending (Show the note), revealed and writing (writing label, for a non-last and for the last step), held non-last (Wipe the glass), held last (The hand, quoted), no note non-last (Next step), no note last (The hand, quoted).
3. **Q3.** The shared description is a `hidden` element (not read as free text), rendered only on a screen or step that shows at least one † mark, and referenced by `aria-describedby` from the † spans only. A step or a quoted row without a † has no description text anywhere in the accessibility tree.
4. **Q4.** The chip is a labelled button ("Change the moment of this note: <span>, <label>") that opens the stepper: the basis ("Basis: …"), Earlier, Later, Reset, "Not saved on this device." where storage is not kept. A press stores the time in IndexedDB for this device, relabels the chip "check from 30 s · set by you" and announces it; the time has source `cook` and basis "set by you on this device". After a reload the chip still shows it, and Cook Mode (real time) holds that note at "Show the note" until the check time. Covered by an e2e.
5. **Q5.** Phone (≤ 640 px wide), Cook Mode: the full step text is readable without overlap. The text is never inside its own scroll box on a phone; the page scrolls and has room under the last line for the control bar. The first lines of the step are above the bar without scrolling. The pace badge sits at the top left of the pane, off the moon. The archive slip and the credit line run together as one small block under the pane, and "Started at step n of N" and "Start again" are one row under it (all the provenance fields stay on the page: institution, shelfmark, page, date, licence, credit). Desktop is unchanged except what shares the rules.
6. **Q6.** The shelf card is a composed hero for the one recipe: a bigger scan thumbnail on its paper mat, the title in IM Fell English, the archive slip, the hint and both buttons. On 390x844 both buttons are fully above the fold and the thumbnail is at least 160 px wide. On desktop the card fills the width instead of floating on a void. No invented content (no new copy beyond the existing strings).
7. **Q7.** On every screen the Tab order follows the visual order (top to bottom, left to right within a row). The Wipe control still takes focus once when Cook Mode is ready, and Space and Enter still work at once. The sequence of the tab stops from the top of the page is tested against the visual positions on the shelf, edition, Cook Mode (before and at the held note) and quoted screens, desktop and phone.
8. **Q8.** After a forced `webglcontextlost` (not restored) the pane falls back to `StaticPane` at the phase it was in. A held note stays on the glass, a writing note continues from where it was, a wiped note stays wiped. The Wipe control follows the phase, the live region still has the note's transcription, and the held note can still be wiped. Covered by a unit test of the resume clock and an e2e with `WEBGL_lose_context`.

## Unchanged Behavior

1. P7 and P8 stay green. `npm run props` result is unchanged; no bundle is touched.
2. The deep-link caption "Started at step n of N" and "Start again" keep their words and behaviour.
3. The hero judge path: the reveal lands at most 10 s after interactive (`e2e/cook-flow.spec.ts`).
4. The renderer's look (fog, strokes, moon, shaders) is unchanged and belongs to a later renderer spec. The pane's box may be shorter on a phone; its drawing code is untouched except for the fallback resume in Q8.
5. Honesty copy: reviewer names exactly as recorded, "Not generated. Quoted.", no persona, no voice. The writer is "the writer".
6. Provenance on every reveal (institution, shelfmark, page, date, licence, credit) and the verify-at-source link.
7. The 48 x 48 CSS px floor of the Wipe control and the knob stops, `prefers-reduced-motion` behaviour, no horizontal scroll at 390 px, design tokens only, fonts as assigned.
8. Desktop Cook Mode layout (apart from the timer caption and the tab order).

## Tasks

- [ ] 0. `[kiro] cook-mode-qa-r1: bugfix spec`: this file.
- [ ] 1. Q1: test first (`CountUpTimer.test.tsx`, a Cook test), then the paced timer.
- [ ] 2. Q2: test first (`WipeControl.test.tsx`, `Cook.test.tsx` for every Wipe-table row), then the writing label.
- [ ] 3. Q3: test first (`ReadingText.test.tsx`, `Cook.test.tsx`, `Quoted.test.tsx`), then the hidden description on † spans only.
- [ ] 4. Q4: e2e first (`e2e/cook-timing.spec.ts`), then whatever it finds missing.
- [ ] 5. Q5: test first (unit CSS contract and `e2e/cook-phone.spec.ts`), then the phone layout.
- [ ] 6. Q6: test first (unit and phone e2e above the fold), then the shelf hero.
- [ ] 7. Q7: e2e first (`e2e/tab-order.spec.ts`), then the DOM order.
- [ ] 8. Q8: unit test of the resume clock and e2e first (`e2e/steam-context-loss.spec.ts`), then the resume.
- [ ] 9. Final: `npm test`, `npm run typecheck`, `npm run build`, `npm run e2e`; refresh `docs/kiro-evidence/cook-mode/screens/` (the same 10 shots) and look at each; report.
