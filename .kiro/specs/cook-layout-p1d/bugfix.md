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

Filled in after the fix (see Tasks).

## Tasks

- [x] 0. `[kiro] cook-layout-p1d: bugfix spec and red e2e`: this file and `e2e/cook-layout-p1d.spec.ts`, 20 of 22 tests red on the unfixed code.
- [ ] 1. L3 and L6, unit tests first, then the code.
- [ ] 2. L4 and L1, CSS, then the e2e.
- [ ] 3. L2 and L5.
- [ ] 4. Preservation: `npm test`, typecheck, lint, build, `npm run e2e -- cook-phone steam-phone-fit cook-flow cook-a11y cook-layout-p1d`.
