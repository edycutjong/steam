# Kiro evidence

What is in this folder, who made it, and what each line of `hooks.log` can and cannot be used to claim. Claim only what is here, in `.kiro/`, or in git history (`.kiro/steering/honesty.md`).

## Files

| Path | What it is | Made by |
|---|---|---|
| `probe-3.5.0.md` | Results of the headless probe on kiro-cli 3.5.0: which hook triggers fire, whether PreToolUse blocks, whether agent permissions and `watch`/`command` workflow nodes work. Gates the format of every file in `.kiro/hooks/`, `.kiro/agents/` and `.kiro/workflows/`. | The probe runs, written up by Kiro |
| `probe-3.5.0/runN.out.txt`, `runN.hooks.log` | Raw transcript and raw hook stdin of probe run N. Unedited except for `[INFO]` transport lines. | kiro-cli, in a scratch folder (`/tmp/steam-probe`) |
| `probe-3.5.0/workspace/` | The probe's own `.kiro/` (as `dot-kiro/`) and scripts. Its formats are the ones this repository uses. | Kiro |
| `hooks.log` | One line per gate run and per hook run, append only. See below. | The gate (`tools/steam-ingest`), the hook scripts (`tools/hooks`), and hand-appended spec-run lines |
| `ingest/` | Measured figures of the ingest pipeline (`measurements.json`, written by the commands listed in `ingest/README.md`) and the hero mask overlay. | The ingest-pipeline build |
| `crop-overlap/`, `word-align-speck/` | Bugfix evidence: the failing test run before the fix (`red.txt`), the measured state before (`before-fix.json`), after (`green.txt`) and the preservation run (`preservation.txt`). | The bugfix specs |
| `renderer-v0/` | Frames from the renderer before and after each fix. | The renderer spec |

## `hooks.log`

One line, appended, never rewritten: `<ISO time> · <who> · <target> · <result>`. The separator is U+00B7 with single spaces. The time is UTC. `<who>` says which program wrote the line.

| `<who>` | Written by | Fires on | `<target>` | `<result>` |
|---|---|---|---|---|
| `cli`, `watch`, or the value of `$STEAM_WHO` | `steam-ingest gate` (`tools/steam-ingest/gate.ts`) | Every gate run: by hand (`cli`), by the workflow's `watch` node (`watch`, `gate --once`), by a spec run | recipe id | `pass`, `fail` or `waiting`, then the failing properties, the waiting reasons or `P1-P6 ok`, then `no-op (inputs unchanged)` for a repeat |
| `props-on-save` | `tools/hooks/props-on-save.ts`, hook `.kiro/hooks/props-on-save.json` | PostFileSave and PostFileCreate on `content/recipes/<id>/(agent/*.json, alignment.json, transcription.md, ownership-review.json)`. Kiro fires both triggers for one agent write, so one write gives two lines, the second a `no-op`. | `<id> ← <file>` | `pass`, `fail <properties>`, `waiting <reasons>` or `error <reason>` (a recipe folder that is not ready yet). It never blocks the save. |
| `catalog-gate` | `tools/hooks/catalog-gate.ts`, `.kiro/hooks/catalog-gate.json` | PreToolUse `write` when the path is the public catalog file. Other paths write no line. | `content/catalog.json` | `blocked: <first reason>` (exit 2, the agent reads the reason) or `allowed: N recipes verified` |
| `no-imitation` | `tools/hooks/no-imitation.ts`, `.kiro/hooks/no-imitation.json` | PreToolUse `write` on a path under `src/`, test files excepted. Other paths write no line. | the file under `src/` | `blocked: <what> (line N)` (exit 2) or `pass (…)` |
| `tests-after-task` | `tools/hooks/tests-after-task.ts`, `.kiro/hooks/tests-after-task.json` | PostTaskExec: after a spec task, in the IDE. | `npm test -- --reporter=dot` | `pass`/`fail`, the passed and failed counts of tests and files, the exit code |
| `crop-overlap`, `word-align-speck` | Appended by hand in the spec runs of the two bugfixes, with the measured result of the gate at that step | | recipe id | as the gate lines |

### What the log shows and does not show

- A `props-on-save`, `catalog-gate` or `no-imitation` line was written by that script. It shows the script ran with a hook event on stdin. The script's own tests (`tools/hooks/*.test.ts`) pipe recorded events into it and write to a temporary folder, never to this file.
- The lines of `props-on-save` (with `error`), `catalog-gate` (`blocked`) and `no-imitation` (`blocked` and `pass`) dated 2026-11-24 20:07 UTC come from one headless `kiro-cli 3.6.0` self-test in this repository: an agent was asked to write four files, two writes were refused by the hooks (`src/steam/zz-hook-probe-voice.ts`, which speaks, and `content/catalog.json`), and two were allowed (`src/steam/zz-hook-probe-ok.ts` and `content/recipes/zz-hook-probe/agent/scribe.json`, which the `props-on-save` hook answered with `error`: the folder has no `source.json`). The four test files were deleted afterwards and no refused write left a file. The probe of record is kiro-cli 3.5.0 (`probe-3.5.0.md`); this self-test ran on 3.6.0.
- The `watch` line dated 2026-11-24 19:57 UTC is a dry run of the workflow's watch command, `npx tsx tools/steam-ingest/cli.ts gate --once`, piped with a `{cursor, config, workspacePath}` document by hand. It is not a workflow run.
- `tests-after-task` has no line. PostTaskExec did not fire headless (probe result 9), so nothing is claimed for it until a spec run in the IDE writes a line.
- A `catalog-gate` block covers write tools only. A shell command that writes the catalog file is not intercepted by it. Only `npm run catalog` is meant to write it.
- Agent permissions are a second control: `scribe` and `second-reader` cannot read each other's file, the gold reading, `merged.json`, `gate.json`, `fallback/` or any `transcription.md`, and they have no shell, web, MCP or subagent. That is enforced by the runtime (probe result 10, repeated on 3.6.0 for these two profiles) and writes no line.
