---
inclusion: auto
name: manuscript-reading
description: How to read and transcribe an 18th-century English round-hand manuscript receipt (recipe) from a line image. Use when transcribing handwriting from a scan, reading a strip PNG, writing agent/scribe.json or agent/second.json, or deciding how to record long s, raised-letter contractions, ampersands, weight marks, capitals, spelling or an uncertain word.
---

# Reading an 18th-century English hand

You are making a diplomatic transcription: the text as the writer wrote it, not as a modern edition would print it. The reading is quoted back to a cook beside the writer's own pixels, and a second reader transcribes the same page independently. Both readings are only useful if each one reports what is on the strip and nothing else.

The writer is anonymous and their sex is unknown. In every field you write, say "the writer". Never "she" or "her".

## Look first, then write

- Look at the strip image for the line you are reading. Read it by looking at the PNG, not by recalling what a recipe like this would usually say.
- Strip i is line i. Open the strips one at a time, in index order, and fix the text of line i from strips/line-<i>.png alone before you open the next one. Never reorder lines, never merge strips, and never move a word from one line to another, even if a line looks squeezed in or seems to belong elsewhere. The order of the strips is the order of the page.
- Echo the index of the strip you are on, and before you write, check that the number of lines you hold equals the number of lines in lines.json.
- Read one line at a time. A word that runs on to the next line is written as the line shows it, with the part you can see. Do not join words across lines and do not complete a word from the next strip.
- Never use a published transcription, a catalogue note, or any file other than `lines.json` and the strips as a source for what the line says.

## Letters and signs

| On the page | Write |
|---|---|
| Long s (ſ), the tall s that looks like f without the crossbar | `s`. Transcribe the letter. Do not keep the glyph |
| Round s | `s` |
| Ampersand, or the "and" sign | `&` |
| Raised (superscript) letters after a stop, as in `Rec.d` | The stop the writer wrote, then the raised letter on the line: `Rec.d`. Keep the raised letter. Do not expand it to `sugar` |
| Raised letters with no stop before them, as in the writer's short form of "the" (a y with a raised e) | The Unicode raised letter: `yᵉ` (the). `wᶜʰ` (which). `yᵗ` (that). `wᵗʰ` (with). Use the Unicode modifier letters ᵃ ᵇ ᶜ ᵈ ᵉ ʰ ⁱ ˡ ᵐ ⁿ ᵒ ʳ ˢ ᵗ ᵘ ʷ ʸ. Never expand. Never write `^` or a tag |
| The y that stands for "th" in such short forms | `y`, as written. The short form of "the" is `yᵉ`, never `the` |
| Weight marks: `lb`, `l.`, `℥`, `oz`, `dr`, a pound sign that looks like a barred or looped l | Write what the writer wrote: `lb`, `oz`. Do not turn one mark into another, and do not spell a mark out as a word |
| Numerals, fractions, `½` | As written. Roman or Arabic, whichever the writer used |
| Capital letters | Exactly as written, including the ones a modern text would lower-case in the middle of a sentence |
| Spelling | As written. No modernising and no correcting: an old spelling such as `Cloathes` stays `Cloathes`. A word that looks wrong to you is still the word on the page |
| Punctuation | As written: commas, stops, colons, dashes, and a missing mark where the writer put none. Do not add a stop at the end of a line |
| Abbreviation stops, tails and flourishes | Write a `.` only where the writer made a dot. A flourish is not a letter |
| A mark you cannot name | Write `(?)` for that one mark or word (see below). Do not draw a character from memory |

Reserved characters. The files you write are checked by a schema that refuses the three characters `|`, `]` and `†` inside any `text`, `token` or `alt`. If the page shows a mark you would write with one of them, do not type it: write `(?)` and list what you saw in `uncertain`. This is also why the unreadable-word marker is `(?)` and not `[?]`: the closing bracket is on the refused list.

Words are the pieces between spaces. Keep one space between words as the writer spaced them. A word the writer broke across a line end stays two pieces, one on each line. A raised letter, a stop and the word they belong to stay in one piece with no space.

## When you are not sure

1. Give your best reading in `text`. Use it as the line's primary text.
2. List the doubt in that line's `uncertain` array: `uncertain: [{ "token": "Cloathes", "alt": ["Clothes", "Cloaths"] }]`. `token` is the word exactly as you wrote it in `text`. `alt` holds the other readings you considered, as they would be written (same rules as above). Put the most likely alternative first.
3. Only list a real doubt. If you are sure, leave the line without `uncertain`.
4. Never silently normalise. If you chose `Received` over `Rec.d`, or `Clothes` over `Cloathes`, the choice is a doubt and goes into `uncertain`, or it is not a choice at all and you copy what is written.
5. Never guess a word you cannot see. Where ink is too faint, cut off at the strip edge, or crossed through, write `(?)` for that word, and add `{ "token": "(?)", "alt": [] }`. Do not fill the gap from context, from what a recipe would say, or from the line above and below.
6. A crossed-out or inserted word: transcribe what stands in the line, and if the writer struck a word through, list it as uncertain rather than dropping it.

Two readers will disagree on some words. That is expected and is shown to the cook with both readings. A disagreement is a finding. It is never something to avoid by reading what the other reader might read. Do not try to guess what the other reader wrote, and do not open their file.

## Never

- Never supply a pixel coordinate, a box, a crop, a row, a column, a size or a position. Positions are computed from the ink by code.
- Never write a generated or imitated version of the handwriting: no description of strokes as a substitute for text, no "in the style of".
- Never present a reading as the writer's intention. You are reporting letters on a page.
- Never mention a person, a name or a persona behind the hand.
