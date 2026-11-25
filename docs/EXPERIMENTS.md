# Experiments

Counted by what ran. Every number below comes from a file in this repository, named beside it; anything that did not run says **not run** and claims nothing.

| # | Experiment | Status | Result | Evidence |
|---|---|---|---|---|
| 1 | One reader vs two readers, scored against an independent reading | **ran** | On Quinces p.23 the `scribe` reading differs from the eyes-only reading on **2** words; the `second-reader` reading on **3**. Both of the scribe's errors were flagged twice: by the scribe's own `uncertain` marks (6 tokens marked) and by the two-reader diff (5 disagreements). Neither safeguard missed one. One page, 11 body lines: the sample is too small to call the second reader necessary or redundant. What it does show: on this page no wrong word reached the cook unflagged. | `scripts/experiment_readers.py` → `docs/kiro-evidence/evals/experiment-readers.json` |
| 2 | Kill-test self-check vs gate property P4 | **ran** | The kill-test's own Kiro-written check passed overlapping eye-read boxes. Property P4 fails the same boxes on steps 1-5 (red run: 5 failed, 1 passed) and passes the code-built ownership masks (green: 9 passed + 5 expected-fail). | `docs/kiro-evidence/crop-overlap/{red,green,preservation}.txt`, eval E9 in `docs/kiro-evidence/evals/results.json` |
| 3 | Bugfix specs, red before green | **ran, 10 specs** | Each spec committed a failing test before the fix, then the fix, then a preservation run. Specs: `renderer-v0-frames`, `crop-overlap`, `word-align-speck`, `word-cut-inside-word`, `cook-mode-qa-r1`, `cook-layout-p1d`, `a2a-arch-r05`, `a2a-arch-r06`, `hook-coverage`, `hero-hold-clearance`. | `.kiro/specs/*/bugfix.md`, `git log --grep '\[kiro\] .*: red'`, `docs/kiro-evidence/<spec>/` |
| 4 | Headless probe of Kiro's hook triggers (kiro-cli 3.5.0) | **ran** | 5 of 7 trigger types fire headless; PreToolUse can block; File hooks need regex matchers (globs never matched); PreTaskExec / PostTaskExec are not reachable headless. | `docs/kiro-evidence/probe-3.5.0.md`, `probe-3.5.0/run*.hooks.log` |
| 5 | Hook coverage: what the write hooks actually saw | **ran** | Kiro's session store, read by `tools/evidence/session-ledger.ts`: across 39 sessions, 543 shell commands wrote under `src/` (368 non-test) against 30 write-tool calls; 0 of the 543 had a hook event, because the write hooks match only the write tools. Fixed by bugfix spec `hook-coverage` (shell-gate + src-scan); three live probes after the fix: 2 blocked before the write, 1 caught after it. The count rule is a heuristic and a lower bound. | `docs/kiro-evidence/sessions/ledger.md`, `docs/kiro-evidence/hook-coverage/NOTES.md` |
| 6 | Two-reader workflow end to end | **ran, 3 runs** | Run 1: gate FAIL (the scribe wrote strips out of order). Prompt fixed, run 2: gate PASS P1-P6. Run 3 (after a gate fix): the `watch` node ended on its first poll with `terminal-state` pass. | `.kiro/workflows/ingest-recipe.workflow.json`, `hooks.log` (`watch` lines), evals E1/E2/E4 (`wf_d9d9bb0e966e6461`) |
| 7 | Agent-output evals E1-E9 | **8 ran, 8 pass; E3 not run** | E3 (French Bread p.17) is not run: the page was held out of ingestion, so no agent reading of it exists. | `scripts/eval_agents.py` → `docs/kiro-evidence/evals/results.json` |
| 8 | Provenance: is the note on the glass the archive's own pixels? | **ran, 4 runs disclosed** | Run 4 exit 0: all 3 notes match a fresh IIIF fetch of the same region (NCC .960 / .976 / .991 against a threshold of .90 fixed before the run); a shifted region and a wrong page both fail. A pixel-level check (b2) was tried in runs 1-3, did not separate from its control, and was dropped, not tuned. | `scripts/verify_provenance.py`, `docs/kiro-evidence/provenance/` |
| 9 | Frame rate on five profiles | **ran** | See the table in `bench/README.md` (hardware GPU via ANGLE Metal, plus a SwiftShader software-GL row); both runs of the loaded machine are disclosed. | `scripts/steam-bench.ts` → `bench/results.json` |
| — | Fog model A vs B (two Kiro implementations of the fog field) | **not run** | Skipped by the credit plan's default (the 600-credit table has no row for it). | — |
| — | Spec-driven vs vibe-coded component (`FlameKnob`) | **not run** | No Kiro turn left in the plan for it. | — |
| — | Physical Android frame rate | **not run** | Emulated Pixel 5 profiles only (`bench/results.json`). | — |
| — | Blind look at the reveal by people who have not read the specs | **not run** | The renderer was judged only by review agents, against a 7/10 gate; look pass 2 scored 6.5 (`docs/kiro-evidence/renderer-v1/NOTES.md`). | — |

## How to re-run the ones that ran
```bash
npm ci
python3 scripts/experiment_readers.py quinces-marmalade   # 1
npx vitest run src/ingest/cropOverlap.bug.test.ts          # 2 (green on HEAD; red.txt is the pre-fix run)
python3 scripts/eval_agents.py                             # 7
python3 scripts/verify_provenance.py                       # 8 (fetches the IIIF region)
```
