# Bugfix: cook-layout-p1d

The static-pane review of P1c (`../specs/audit/autopilot-P1c-round-2.md`, "Carried to P1d") found six layout and label faults in Cook Mode. They are fixed in Cook Mode's CSS, DOM and copy only. The renderer look is not touched: `steam-renderer-v1` is closed, its pinned bounds and the P7 reveal-once properties stay green. Each fault is measured by bounding boxes in `e2e/cook-layout-p1d.spec.ts` (no screenshot diffs), committed red first, then fixed, then the preservation runs.

Terms. "Hold": `data-note-state="held"`. "The bar": `.controls`, fixed to the bottom edge at 1024 px and below. "Reading slot": the row under the pane that shows the reviewed reading (`[data-note-reading]`) once the note is held.

## Current Behavior

1. **L1.** Phone 390x844 and 393x852, at scroll 0: the bar covers the lower part of the timer and its "cooking time at ×12" caption at step 5 (bar top 759, timer bottom 771) and at step 4 (timer bottom 802, 43 px under the bar's top). The timer, the flame dial and the pace caption are reachable only by scrolling.
2. **L2.** While the note is written the Wipe label "The hand is writing…" is `white-space: nowrap`. At 320, 360, 390 and 393 px the text runs 9 to 38 px past the right edge of the button, over Unmute.
3. **L3.** Under the pane two lines name the source: the mono archive slip (institution, shelfmark, page, "c. 1750 (IIIF manifest)", licence) and a serif credit line ("Wellcome Collection, Public Domain Mark").
4. **L4.** Desktop 1280x720: the reading slot is added only when the note is held, so everything below it moves down about 34 px. At the hold the document is 766 px tall in a 720 px viewport: Back, "The hand, quoted" and Unmute end at 726 px and the page scrolls.
5. **L5.** The timer is `--muted`, turns `--after` in the last 10 s before a note arrives and returns to `--muted` when the note arrives. Nothing in the DOM names the state, so the change reads as a fault.
6. **L6.** Under `prefers-reduced-motion: reduce` the primary button still reads "The hand is writing…" while the held image fades in, and its hidden description says "The note is being written". Nothing is being written then.

## Expected Behavior

1. **L1.** At scroll 0, on 390x844 and 393x852, at the hold of steps 1, 4 and 5, at steps 2 and 3 and while the note is writing: `.timer`, `.timer__pace`, `.knob__dial`, every `.knob__stop`, `.badge` and the step text lie inside the viewport and above the top of the bar. Dial, stops, Back, Wipe and Unmute are at least 44x44 CSS px and the element at their centre is themselves (nothing covers them). The bar ends inside the viewport and keeps `env(safe-area-inset-bottom)` in its own bottom padding. The pane is shorter on a phone (`max(36dvh, 300px)`), a layout change; its drawing code is untouched.
2. **L2.** The label may wrap to two lines (no `nowrap`) and is smaller below 380 px. At 320, 360, 390 and 393 px the text box lies inside the button, the button does not intersect Back or Unmute, the button does not overflow, and the button stays at least 48 px tall.
3. **L3.** Exactly one attribution line per Cook view: the mono archive slip, which carries institution, shelfmark, page, "c. 1750 (IIIF manifest)" and the licence link from the bundle. The serif credit line is not rendered in Cook Mode. The copy stays in `src/copy/strings.ts`; the credit line remains on the shelf, the page view and "The hand, quoted".
4. **L4.** The reading slot is always in the layout (one line high) from the first frame, so Back, Wipe, Unmute, the step text and the under-pane row do not move by more than 0.5 px between the writing state and the hold. At 1280x720 every control lies inside the viewport at every step with no scroll (`scrollHeight` is 720 and `scrollY` is 0).
5. **L5.** The timer carries `data-timer-state` (`running`, `ember`, `paused` or `done`). Its colour is a function of that state only (`--muted`, `--after`, `--muted`, `--muted`), so it changes only when the state changes. `ember` is the "last 10 s before a note" state the product constitution allows `--after` for; it is kept.
6. **L6.** Under reduced motion the primary button reads "Show the note" while the note appears, never "writing", and its hidden description says "The note is appearing".

## Unchanged Behavior

1. The renderer look and drawing code, the `steam-renderer-v1` pinned bounds (`steam-phone-fit`, `steam-look3`, `steam-hold`) and the P7 reveal-once properties.
2. The Wipe table (labels, `aria-disabled` while writing, no action while writing, focus kept), the 48 px floor of the Wipe control and knob stops, the Space and Enter behaviour, the tab order.
3. The deep-link caption "Started at step n of N" and "Start again", and the hero judge path (reveal at most 10 s after interactive).
4. Provenance on every reveal: institution, shelfmark, page, date, licence and credit (the slip's institution is the bundle's credit), and the verify-at-source link on "The hand, quoted".
5. `prefers-reduced-motion` still gets the static reveal of the same note at the same moment; the `aria-live` announcements are unchanged.
6. Normal-motion label "The hand is writing…" and its description "The note is being written".
7. Design tokens only, fonts as assigned, no horizontal scroll at 320 to 393 px.

## Measured

Red first: on the unfixed code (commit before the fix) 20 of 22 tests in `e2e/cook-layout-p1d.spec.ts` failed; the two that passed are guards for behaviour that was already right (the bar's safe-area padding, and the step-1 reading that was already inside the page).

After the fix, 22 of 22 pass. Bounding boxes, CSS px:

- L1, 390x844 at scroll 0: timer bottom 702 (step 5 hold) and 733 (step 4 hold) against the bar's top at 759 (was 771 and 802). 393x852: 736 against 767. The pane is `max(36dvh, 300px)` (was 42dvh); the note layout is width-limited on a phone and `data-layout` still reports `fits: true`, with the same scale, down to 34dvh.
- L2: the Wipe label stays inside its button at 320, 360, 390 and 393 px (was 9 to 38 px over). At 320 px the clock and the knob wrap instead of widening the page to 357 px.
- L3: one `.slip`, no `.credit-line`, in Cook Mode on desktop and phone; "Wellcome Collection" and "Public Domain Mark" each appear once in the view. The slip's institution is the bundle's `credit`, so the credit is still on every reveal.
- L4: Back, Wipe, Unmute, the step text and the under-pane row move 0 px between the writing state and the hold, on all three notes. At 1280x720 the controls end at 705 (was 726) and `scrollHeight` is 720 (was 766). The pane is `44dvh` on desktop (was 47dvh).
- L5: in a 26 s run with `lead=14` the timer passes through `running` and `ember`; each state shows one colour once the 400 ms transition has settled: `rgb(154, 143, 130)` (`--muted`) and `rgb(242, 166, 90)` (`--after`).
- L6: with `prefers-reduced-motion: reduce` no sample of the button ever contains "writing"; during the writing state it reads "Show the note".

Decisions.
- L3: the request named the slip text "an anonymous hand · Wellcome MS.1810" from `src/copy/strings.ts`. That string is not in the copy file or in the bundle. The slip that exists carries "Wellcome Collection", "MS.1810", "p.23", "c. 1750 (IIIF manifest)" and "Public Domain Mark", so that slip is the line kept; no new copy was invented.
- L5: the orange-to-grey change is the 10 s "ember" window that `product.md` and cook-mode R10.4 define. It stays, as the named state `ember`; what is fixed is that it is now a named state the colour follows, so it cannot change without a state change. The three states of the request (running, paused, done) are all `--muted`.
- L4: the reading slot is reserved for one line. A reading that wraps to two lines would still shift the layout; the three bundled readings are one line at 320 px and up.

## Tasks

- [x] 0. `[kiro] cook-layout-p1d: bugfix spec and red e2e`: this file and `e2e/cook-layout-p1d.spec.ts`, 20 of 22 tests red on the unfixed code.
- [x] 1. L3, L5, L6 and the L4 slot: unit tests (`Cook.test.tsx`, `WipeControl.test.tsx`, `CountUpTimer.test.tsx`), then the code.
- [x] 2. L4, L1 and L2: CSS, then the e2e.
- [x] 3. Preservation: `npm test`, typecheck, lint, build, `npm run e2e -- cook-phone steam-phone-fit cook-flow cook-a11y cook-layout-p1d`.
