---
inclusion: always
---

# Product constitution: "Her Hand in the Steam"

Cook Mode for handwritten recipes. At a step where the writer left a judgement in their own words ("till it Looks red & smooth"), steam condenses on a pane of glass and the writer's scanned handwriting is wiped clear out of the fog, line by line. Demonstrated recipe: "Marmalade of Quinces", p.23 of an anonymous 18th-century manuscript receipt book, Wellcome Collection MS.1810 (c. 1750), Public Domain Mark.

## Quoted, not generated
- Show the writer's hand only as pixels from the photographed scan.
- Never generate, trace into vectors, re-typeset or imitate handwriting.
- Never render a note in a handwriting-style font.
- No speech synthesis, synthetic voice, chatbot or persona.

## Note crops and the gate
- Compute note crops in code from ink-component ownership masks. Each note shows only ink owned by its own quoted lines.
- Never use boxes an agent read by eye.
- A recipe reaches Cook Mode only when properties P1-P6 pass in its `gate.json`.

## Provenance
- Every reveal carries: institution, shelfmark, page, date, licence and credit.
- Every reveal carries a "verify at source" IIIF region link to the same pixels on the archive's server.

## Uncertainty
- Where the two independent readers disagree, the UI shows both readings.
- Never hide a disagreement.

## Write-on
- The write-on follows a traced left-to-right path per line, computed from the ink (a time-of-ink map).
- Never call it the writer's real pen order.

## Check times
- `checkAt` is cited from the text, or starts at step entry.
- Label every check time with its source.
- Never invent a cooking time.

## Voice about the writer
- The writer is anonymous and their sex is unknown. Say "the writer" or "a dead writer's hand".
- Never use "she" or "her" except in the product title.
- Never present a persona as a real person.

## Runtime
- The judged web app runs no model and no Kiro, and has no server. It is a static site.
- Kiro works at build time and in the opt-in ingestion CLI.

## Accessibility
- `prefers-reduced-motion` gets a static reveal of the same note at the same moment.
- Screen readers get an `aria-live` announcement of each step and of the note's transcription.
- The Wipe control is keyboard operable and at least 48x48 CSS px.
