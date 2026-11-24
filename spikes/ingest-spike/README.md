# Ingestion spike (P1a, throwaway, `[claude-direct]`)

One-hour spike on the hero page (Wellcome MS.1810 p.23, scan `p0033.jpg`, recipe No. 26), written outside Kiro to
give the first renderer real data: a **code-built ownership mask** and a **left-to-right time-of-ink** for the note
"till it Looks / red & smooth". It is replaced in P1b by the Kiro-built pipeline (`.kiro/specs/ingest-pipeline/`,
`src/ingest/`); nothing here is imported by the app.

Run: `python3 -I lines.py <p0033.jpg> <outdir>` then `python3 -I spike.py <p0033.jpg> <outdir>` (numpy, scipy, Pillow).

What it does
1. Sauvola adaptive threshold (window 41, k 0.2) on the recipe region, components < 30 px dropped.
2. Row projection → 11 line cores (core band = rows ≥ 60% of the line's peak), valley rows between them.
3. Connected components (8-connected). A component touching one core band belongs to that line; one touching two core
   bands is split at the valley row and logged; one touching none goes to the nearest band (distance upward to the
   band below is discounted ×0.6, because i-dots and capital flourishes hang above their own line).
4. The note = line 8 from "till" to the end + line 9 up to the column gap before "keeping". The two x positions were
   **located by eye** (790 and 515 px in region coordinates; 515 snaps to the measured gap at 499; 790 has no column gap
   because "it" and "till" overlap in slanted projection, so each whole component is assigned by its centroid). Word
   alignment from the two readers replaces these two numbers in P1b.
5. Output (`public/hero/`): `note-looks-red-smooth.png` (scan RGB, alpha = ink darkness inside the owned mask, 32 px
   transparent margin), `.toi.png` (R = ink alpha, G = reveal time 0-255 along a slant-corrected left-to-right path,
   line 8 then line 9, B = local ink density as pressure), `.json` (page box, the two gap groups with their core bands
   and time ranges, split measurements).

Measured (output of `spike.py`, `public/hero/note-looks-red-smooth.json`)
- 11 lines found (matches the 11 manuscript lines). 83 component splits across all 11 lines.
- Note ink: 4,357 px (line 8 group) + 4,006 px (line 9 group). Groups are 438 and 465 px wide with core bands of
  35 and 34 px.
- **Split share of the note = 0.1908** (4 components that touch both lines' core bands), against the frozen P3
  threshold of 0.02 → **P3 would FAIL** under the specified split rule. Measured alternative, not applied: splitting only
  components whose smaller core overlap is ≥ 25% of the larger still gives 0.178. The joined strokes between these two
  lines are real; P1b's `ingest-pipeline` spec has to resolve the rule before the gate's first run.

`overlay-note-ownership.png`: the owned note ink in red over the region.
