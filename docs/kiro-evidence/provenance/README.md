# Provenance runs (`scripts/verify_provenance.py`)

Claim (spec.md metrics row "Provenance"): the hand on screen is the archive's. (a) each bundled note's IIIF region, re-fetched live from
Wellcome Collection's image server, correlates with the bundled **unflattened** page crop (`public/recipes/<id>/page.jpg`) at NCC >= 0.90
(threshold fixed in the script before run 1), while a region shifted 150 canvas px and the same region from the neighbouring canvas both fall below it;
(b) every displayed mask pixel lies inside that verified region, and the ingest gate recorded its ownership checks P3/P4 as passing.

| run | what changed | outcome |
|---|---|---|
| run-1 | first run, thresholds fixed in the commit before it | (a) PASS 3/3 with both controls failing; b1 (pageBox containment) and b2 (opaque pixels on ink, 0.51-0.75 vs 0.97) FAIL |
| run-2 | b1 redefined to the displayed (alpha >= 128) pixels (pageBox includes transparent padding); b2 redefined to alpha-vs-darkness correlation | b1 PASS; b2 FAIL (0.04-0.22) |
| run-3 | b2 evaluated on the mask's own support only | b2 FAIL (0.07-0.32) |
| run-4 | b2 dropped: the displayed png is a processed render (RGB differs from the page by 53-71 gray levels on average) and a dilated-ink containment check scored the 40 px-shifted control 0.97-1.0, so no pixel-level check discriminated | (a) 3/3 PASS, controls fail, b1 3/3, b3 3/3: exit 0 |

(a)'s metric, threshold and controls were never changed. The abandoned b2 is **not claimed anywhere**; the evidence is the four files above, kept as run.
