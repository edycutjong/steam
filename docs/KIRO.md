# How Kiro built this

**304 commits** in this repository are marked `[kiro]` (`git log --format=%s | grep -c "^\[kiro\]"`): they were made by a Kiro session running a spec task, a bugfix spec or an agent workflow. The rest are marked `[claude-direct]` (scaffold, measurement scripts, bench and provenance runs, interaction-QA CSS, evidence write-ups). Every Kiro turn of this build ran headless: `kiro-cli chat --v3 --no-interactive --trust-all-tools`, from this folder.

This page is the causal chain: for each Kiro feature, the file that drove the work, what it changed, and where to check it. Then the gap we found in our own hook evidence, and a list of what was planned and **not** built.

## 1. The chain, feature by feature

| Kiro feature | Files | What it drove | Commits (`git log --grep`) | Check it |
|---|---|---|---|---|
| **Specs (feature)**, requirements-first and design-first | `.kiro/specs/steam-renderer`, `steam-renderer-v1`, `ingest-pipeline`, `cook-mode`, `offline-shell` (`requirements.md`, `design.md`, `tasks.md`) | The steamed-glass renderer (v0 then v1), the ingestion pipeline and its gate (Correctness properties P1-P6), Cook Mode (properties P7-P8, K1-K9), the offline shell | `steam-renderer` (incl. `-v1`) 69, `ingest-pipeline` 54, `cook-mode` (incl. `-qa-r1`) 68, `offline-shell` 1 | property suites `src/**/*.prop.test.ts`; the gate: `npx tsx tools/steam-ingest/cli.ts gate --once` |
| **Specs (bugfix)**: red test first, then the fix, then a preservation run | `.kiro/specs/{renderer-v0-frames, crop-overlap, word-align-speck, word-cut-inside-word, cook-mode-qa-r1, cook-layout-p1d, a2a-arch-r05, a2a-arch-r06, hook-coverage, hero-hold-clearance}/bugfix.md` | Every defect found by a review, a frame capture or a measurement became a bugfix spec instead of a silent patch. `a2a-arch-r05`/`r06` came from two rounds of outside architecture review (18 items). | `git log --oneline --grep '\[kiro\] .*: red'` lists the red commits | `docs/kiro-evidence/<spec>/` (`red.txt`, `green.txt`, `preservation.txt`, `NOTES.md`) |
| **Steering** | `.kiro/steering/product.md`, `honesty.md`, `tech.md`, `structure.md` (always / file-match), `manuscript-reading.md` (auto) | "Quoted, not generated": no synthetic voice, no handwriting font, no imitation of the hand; claim only what is in the repo; how to read an 18th-century hand | `steering` 4 | The hooks below enforce the product rules; `honesty.md` is why this page lists what was not built |
| **Hooks** | `.kiro/hooks/*.json` → `tools/hooks/*.ts` (each tested in `tools/hooks/*.test.ts`) | `no-imitation` refuses a `src/` write that speaks or fakes handwriting; `catalog-gate` refuses a hand-written public catalog; `props-on-save` re-runs the gate when an agent saves a reading; `tests-after-task` runs the suite after a spec task (IDE only); `shell-gate` and `src-scan-after-shell` judge shell writes (section 2) | `hooks` `hook-coverage` 12 | `docs/kiro-evidence/hooks.log` (one line per run), `docs/kiro-evidence/README.md` (what each line can and cannot prove) |
| **Custom agents** | `.kiro/agents/scribe.json` (claude-opus-5.5), `second-reader.json` (claude-sonnet-5.5) | Two independent readers of the manuscript page. Permissions are enforced by Kiro: neither can read the other's file, the eyes-only reading, the merge or the gate; no shell, web or MCP | `scribe` / `second-reader` / `agents` 9 | `content/recipes/quinces-marmalade/agent/{scribe,second}.json`; `merged.json` marks the 5 places they disagree with † |
| **Workflow** | `.kiro/workflows/ingest-recipe.workflow.json`: `parallel` (both readers) → `watch` (the deterministic gate) | Ingestion of Quinces p.23 by agents, gated by code. 3 runs: fail (reader order), pass, pass with the `watch` ending on its first poll | `ingest-recipe` 4 | run id `wf_d9d9bb0e966e6461` in `docs/kiro-evidence/evals/results.json`; `watch` lines in `hooks.log` |
| **Session transcripts** | `docs/kiro-evidence/sessions/transcripts/turn-{19,22,34}-*.md` (by `scripts/kiro_transcript.py`) | Three Kiro sessions condensed from the session store: the prompt, Kiro's own messages, every tool call (name + first line) and every hook invocation; tool output left out | — | read one next to its commits |
| **Session ledger** | `tools/evidence/session-ledger.ts` → `docs/kiro-evidence/sessions/ledger.{json,md}` | Every Kiro session of this workspace: title, time window, tool calls by tool, hook invocations, and the `[kiro]` commits inside the window. Titles and counts only, never prompt or output text | `hook-coverage` | `ledger.md` |

## 2. What the hooks saw, and what they did not

The hooks were tested on 2026-11-24: a live session tried four writes, two were refused (`src/…` that called `speechSynthesis`, and `content/catalog.json`), and those blocks are in `hooks.log`. The write hooks match Kiro's `write` tools (`fs_write`, `str_replace`).

**Then we measured what they actually saw, and the answer was: almost none of the code.** On 2026-11-26, `tools/evidence/session-ledger.ts` read Kiro's own session store for this workspace (39 sessions) and counted, per tool call, what was written and whether a hook ran. Kiro wrote code mostly through its shell tool, not its write tools: **543 shell commands wrote under `src/` (368 to non-test files) against 30 write-tool calls, and 0 of the 543 had a hook event.** `no-imitation` had written its last line on 2026-11-25T01:45Z while many `src/` files were created after it. The "speech or fake handwriting cannot enter `src/`" rule had been enforced by a gate that most writes walked around (`docs/kiro-evidence/sessions/before/`, `ledger.md`).

That became bugfix spec `hook-coverage` (12 `[kiro]` commits, red tests first):
- **`shell-gate`** (PreToolUse, matcher `shell`): judges the text a shell command writes under `src/` with the same rules as `no-imitation`, and refuses any shell write of `content/catalog.json` other than `npm run catalog`. 0.06 s per call.
- **`src-scan-after-shell`** (PostToolUse, matcher `shell`): after every shell command, judges the added lines of `src/` in the working tree, so a script that builds a path from parts is still seen. 0.11 s per call. It logs only when its verdict changes.
- **Steering** (`.kiro/steering/tech.md`): edit files with the write tools.

Live probes in the same session, each line in `hooks.log`:

| Probe | Line |
|---|---|
| heredoc writing `speechSynthesis` into `src/steam/zz-shell-probe.ts` | `shell-gate · src/steam/zz-shell-probe.ts · blocked: speechSynthesis (line 1), SpeechSynthesisUtterance (line 1)` |
| `echo '{}' > content/catalog.json` | `shell-gate · content/catalog.json · blocked: a shell command writes the catalog; only npm run catalog writes it` |
| `python3 -c` building the path and the word from parts | not seen by `shell-gate`; `src-scan · src/steam/zz-shell-probe2.ts · fail speechSynthesis (src/steam/zz-shell-probe2.ts:1)` |

Limits, measured rather than assumed: in `kiro-cli` a PostToolUse exit 2 only logs; it does not stop the agent, so `src-scan` reports a script-written violation but cannot refuse it. A script run by name, `find -exec` and `xargs` are not seen before they run. The ledger's write rule is a heuristic with known false positives and misses, stated at the top of `ledger.md`; its counts are a lower bound. Full write-up: `docs/kiro-evidence/hook-coverage/NOTES.md`.

## 3. What the agents read, and who checked them
- The two readers' disagreements are not resolved by a model: `merged.json` keeps both readings, and the edition view shows each as `†[a | b]`.
- The eyes-only reading in `fixtures/gold-readings.json` was written **by the builder's agent, by eye, before any Kiro reader ran** — an independent check, not a human one. Scored against it, the scribe differs on 2 words and the second reader on 3; every scribe error was flagged (`docs/EXPERIMENTS.md`, row 1).
- `content/recipes/quinces-marmalade/review.json` is signed by the builder's agent and says so ("not a human"); the edition view prints that line. A human sign-off is still owed.

## 4. Planned, not built
Stated so nobody has to infer it from silence:
- **No MCP server** (`iiif-mcp` was planned; licences are resolved by code in `steam-ingest fetch`, eval E5) and **no rights-firewall hook**.
- **No Power**, and no `steam-ingest add --transcribe kiro` command for new pages.
- **No archivist agent.** Only the two readers.
- **No fog model A/B** and **no spec-vs-vibe comparison** (`docs/EXPERIMENTS.md`).
- **No `tests-after-task` line**: PostTaskExec does not fire headless (probe result 9), and no IDE spec run was made.
- **Credits were not measured.** `kiro-cli` does not report credit use headless; the budget was counted in turns (26 build turns + 8 probe turns).

## 5. IDE vs CLI
Everything here ran through `kiro-cli` 3.5.0-3.6.1 headless, so features that need the IDE (Markdown Review, Spec Correctness panel, checkpoints, PreTaskExec / PostTaskExec hooks) are not used, and nothing on this page claims them. Friction we hit with the CLI, dated: `docs/DX-REPORT.md`.
