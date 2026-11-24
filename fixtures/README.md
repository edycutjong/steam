# Fixtures (written before any `src/ingest/` code)

| File | What it is | Who made it |
|---|---|---|
| `p0033.jpg` | Wellcome Collection MS.1810, p.23 "To make Marmalade of Quinces" (canvas 33 of manifest b18419665), `full/1600,` as retrieved 2026-11-24. Public Domain Mark; credit "Wellcome Collection". Every fixture coordinate is in this 1601×2052 frame. | IIIF Image API download |
| `wellcome-work-zgtk6n7e.json` | Recorded Wellcome Catalogue API response for work zgtk6n7e (licence lives under `items[].locations[]`) | API, 2026-11-24 |
| `hero-word-bounds.json` | Loose word boxes for the hero note "till it Looks red & smooth" and the frozen recall threshold (0.85) | marked by eye by the builder's agent (Claude Code) before any alignment code |
| `gold-readings.json` | A frozen reading of p.23, used only as the labelled fallback if the Kiro reader run fails, and as an independent check | read by eye by the builder's agent (Claude Code) before any Kiro reader ran |
| `p0c-eyeread-boxes.json` | The kill-test prototype's eye-read crop boxes per step: the `crop-overlap` bug (they overlap neighbouring lines) | P0c kill-test Kiro run, 2026-11-24 |

French Bread (p.17, canvas 27) is held out of development and is not here.
