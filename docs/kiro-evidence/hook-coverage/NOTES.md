# hook-coverage: what changed, the red-to-green tests, the live probes, before and after

Spec: `.kiro/specs/hook-coverage/bugfix.md`. Commits: `git log --oneline 35d2672^..7869b7a` and `09faffe` (H5 evidence). Every file of the spec was written with `fs_write` or `str_replace`; the shell was used to run tests, git, and the ledger CLI (a program, not a redirect).

## What changed

| Item | Files | Red → green |
|---|---|---|
| H1 | `tools/hooks/shell-writes.ts` (the one rule `analyzeShell`, a small shell lexer, stated at the top of the file), `tools/evidence/session-ledger.ts`, `docs/kiro-evidence/sessions/{ledger.json,ledger.md,before/}` | `tools/hooks/shell-writes.test.ts` (62 tests) and `tools/evidence/session-ledger.test.ts` (red together: 54 of 77 failed with the skeletons): "counts a heredoc write to src/x.ts as one shell write that no hook saw". A second red (`7524a88`) was added while running the ledger on the real store: a `ContextualHookInvoked` event of a parallel `fs_write` was attributed to a shell call by timing alone (5 shell calls in the store). Fix: `HOOK_TOOLS` in the ledger maps each hook to the tools its matcher serves. |
| H2 | `.kiro/hooks/shell-gate.json`, `tools/hooks/shell-gate.ts`, `tools/hooks/catalog-rule.ts` (the sentence `catalog-gate` and `shell-gate` share; `catalog-gate.ts` imports it, its output is unchanged), `tools/hooks/recorded.ts` (`preShell`, `pipeToNode`), `docs/kiro-evidence/hook-coverage/shell-event.json` | `tools/hooks/shell-gate.test.ts`, 45 tests, red 29 of 45 with the allow-all skeleton. |
| H3 | `.kiro/hooks/src-scan-after-shell.json`, `tools/hooks/src-scan.ts`, `runsCatalogCommand` and `commandWords` in `shell-writes.ts` | `tools/hooks/src-scan.test.ts`, 21 tests, red 15 of 21 with the judge-nothing skeleton. |
| H4 | `.kiro/steering/structure.md` section "Editing files"; `docs/kiro-evidence/README.md` (two `<who>` rows, two folder rows, the sentence "covers write tools only" replaced by what the probes showed) | n/a |
| H5 | `docs/kiro-evidence/hooks.log` (lines below) | n/a |
| H6 | `docs/kiro-evidence/sessions/ledger.{json,md}` re-run at the end | n/a |

The recorded shell event (`shell-event.json`) was captured in this session by a temporary hook with matcher `shell` (it wrote its stdin once, then was deleted). Shape: `tool_name: "execute_bash"`, `tool_input: {command, description, cwd, run_in_background, timeout}`, `cwd` the workspace root, `hook_event_name: "PreToolUse"`. Finding: a hook file written during a session is live for the next tool call; no restart was needed.

Test totals at the end: vitest 169 files, 1544 passed, 5 expected fail; typecheck clean; lint 0 errors; build green.

## Speed (measured with `/usr/bin/time -p`, 5 runs each, macOS, Node 22.22)

| Command | Wall time |
|---|---|
| `echo '{}' \| node tools/hooks/no-imitation.ts` | 0.05 s |
| `echo '{}' \| npx tsx tools/hooks/no-imitation.ts` (how the older hooks start) | 0.37 s (one run, `time`) |
| `node tools/hooks/shell-gate.ts` with a command that targets `src/` | 0.06 s |
| `node tools/hooks/src-scan.ts` on this repository (three `git` calls) | 0.11 s |

Both new hooks start with `node`: Node 22.22 runs `.ts` files directly and prints no warning (the tests assert empty stderr). Over the 106 shell calls of this session this adds about 0.17 s per call.

## The live probes (H5), in this session, no sub-session needed

The hooks were already active (hot-loaded). Each probe is the exact command shape, and the `hooks.log` line it produced.

| | Command shape | Result | `hooks.log` line |
|---|---|---|---|
| (a) | `cat > src/steam/zz-shell-probe.ts <<'E'` with `speechSynthesis.speak(new SpeechSynthesisUtterance(t))` in the body | Refused before it ran: the tool answered "intercepted by PreToolUse hooks", showed the rule text, and the file was not created. The same command also held a `git commit`, which did not run either and was repeated. | `2026-11-25T20:50:00.300Z · shell-gate · src/steam/zz-shell-probe.ts · blocked: speechSynthesis (line 1), SpeechSynthesisUtterance (line 1)` |
| (b) | `echo '{}' > content/<the catalog>` | Refused with the `catalog-gate` sentence (`Use npm run catalog …`). `content/<the catalog>` is byte-identical to HEAD (`git diff --quiet HEAD`). | `2026-11-25T20:50:06.863Z · shell-gate · content/catalog.json · blocked: a shell command writes the catalog; only npm run catalog writes it` |
| (c) | `python3 -c` that builds the path with `os.path.join('s'+'rc', …)` and writes the word as `'speech'+'Synthesis'` into `src/steam/zz-shell-probe2.ts` | The pre gate did not see it (no literal path or word in the command): the command ran and wrote the file, as expected. The post hook did see the file. | `2026-11-25T20:50:09.840Z · src-scan · src/steam/zz-shell-probe2.ts · fail speechSynthesis (src/steam/zz-shell-probe2.ts:1)`; after the file was deleted: `2026-11-25T20:50:25.584Z · src-scan · src/ · pass (0 files)` |

A finding the spec did not predict: the `src-scan` exit 2 was not shown to the agent. After probe (c), neither that tool result nor the next command carried a message; only the log line shows the fail. So in this client a PostToolUse exit 2 writes evidence and does not reach the agent. The pre gate (probe a, b) does. `src-scan` is therefore a log and a net, not a block. The test of the process (`node tools/hooks/src-scan.ts` exits 2 with the finding on stderr) is green; what the client does with that is outside the repository.

Probe files deleted: `git status` shows no `zz-` file, `git ls-files src | grep zz-` is empty.

Other lines the live hooks wrote while the spec ran: `src-scan … pass (N files)` lines (7 in total at the end, one per change of verdict, none per command), and `2026-11-25T21:23:22.104Z · shell-gate · src/steam/layout.ts · pass (… the content is not in the command text; src-scan judges the file after)`, written for a `git checkout <rev> -- src/steam/layout.ts` that restored a file for a measurement. Of 80 shell-gate invocations in this session, 3 wrote a line (the probes and that restore): the no-spam rule holds.

## Before and after for this session (`sessions/before/ledger.json` taken 03:42 local, `sessions/ledger.json` at the end)

| This session, `sess_cc50a90b` | before the hooks | at the end |
|---|---|---|
| Tool calls | `execute_bash` 23, `fs_write` 8, `str_replace` 8 | `execute_bash` 106, `fs_write` 28, `str_replace` 34, `read_file` 3 |
| Write-tool calls under `src/` | 0 | 6 (`src/steam/layout.ts`, `layout.test.ts`, `layout.clearance.test.ts`) |
| Shell writes under `src/` by the rule | 1 | 3 |
| Shell writes under `src/` with a hook event during the call | 0 | 2 (probe (a), the `git checkout` restore) |
| Hook invocations | `catalog-gate` 16, `no-imitation` 16 (and the temporary recorder, 2) | `catalog-gate` 62, `no-imitation` 62, `shell-gate` 80, `src-scan-after-shell` 71, recorder 2 |

The three shell writes at the end by the rule: probe (a) (refused, never ran), the `git checkout` restore, and one analysis script run early in the session that only read the session store. That last one is a false positive of the rule: the script quoted `src/` as a string and named write APIs inside regular expressions, so "a script that names a write API and a path under src/" matched. It is also the "1" in the before column. The rule is a heuristic with known false positives of that kind and known misses (listed at the top of `shell-writes.ts`); the ledger numbers are counts by that rule, not exact. I did not change the rule after the before ledger was taken.

All sessions (39), by the rule: write-tool calls under `src/` 30 before, 36 after; shell writes under `src/` 543 before (368 non-test), 545 after (370); with a hook event 0 before, 2 after. This is lower than the figure "about 700 `execute_bash` commands under `src/`" in the spec brief because the rule counts a command only when it shows a write; the brief counted commands that mention `src/`. Both say the same thing: the shell writes outnumber the write-tool writes by a factor of 15 to 18 (545/36 and 543/30). In the three sessions named in the spec (cook-mode-qa-r1, a2a-arch-r05, a2a-arch-r06) the ledger counts 16, 40 and 24 shell writes under `src/` (non-test 12, 18, 13) against 0, 0 and 0 write-tool calls under `src/` (their `fs_write` calls were on `.kiro/specs/*/bugfix.md`).

## What the hooks still do not cover

- A script file run by name (`node scripts/x.ts`) that writes `src/`: not seen before, seen after by `src-scan` (the log line only, see probe c).
- `find … -exec` and `xargs` writers; a path built from parts that is not named `src`.
- `sed -i 's/speechSynthesis//' src/x.ts` (a removal) is refused, because the replacement text names the word. Use `str_replace`, whose `newStr` does not.
- `src-scan` judges the added lines of the whole working tree after each command, so a violation written by an earlier command is still reported until it is removed.
- A `catalog-gate` verification of the content (gate pass, hashes, `review.json`) applies to write tools only; the shell is refused outright, because `npm run catalog` is the one writer.

## By hand

- `node tools/evidence/session-ledger.ts` rewrites the ledger from your own session store (`--workspace`, `--out`).
- Pipe the recorded event: `node tools/hooks/shell-gate.ts < docs/kiro-evidence/hook-coverage/shell-event.json` (exit 0, no output, no log line).
- In a Kiro session of this folder run `cat > src/steam/zz.ts <<'E'` with the speech API in the body: the tool is refused and one `shell-gate` line appears in `docs/kiro-evidence/hooks.log`.
