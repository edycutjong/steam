# DX report: friction with Kiro itself

Dated entries, newest last, plain facts.

## 2026-11-24

- `kiro-cli chat --v3 --no-interactive "/usage"` (kiro-cli 3.5.0) was answered by the model, not run as a command, so credit balance cannot be read headless. Evidence: one probe, `specs/killtest/p0b/usage-probe.txt` in the project kitchen. Consequence: credit caps in this project are allocations counted per turn, not read balances.

## 2026-11-25

- Probe (`docs/kiro-evidence/probe-3.5.0.md`, 8 runs): headless, 5 of 7 hook triggers fired (Pre/Post Tool Use incl. an exit-2 block, Post File Create, Post File Save, Stop). Pre/Post Task Execution did not fire: slash commands are not parsed in a headless prompt. File Save fires on an agent's save and never on a manual save. Claims in this repo about hooks come from `docs/kiro-evidence/hooks.log` only.
- Workflows were off by default; `kiro-cli settings chat.enableWorkflows true` was needed before the `ingest-recipe` workflow would run.
- turn-13: one HTTP 429 `USER_REQUEST_RATE_EXCEEDED` mid-turn; Kiro retried and finished it.
- turn-14: the run exceeded the harness's foreground limit and was backgrounded; two tasks (static pane images, one hooks.log line) were left open by Kiro, with reasons.
- turn-29, first attempt: exit 1 after 22 s with `ModelRegistryUnavailableError` (server side, no model turn). A plain retry worked.
- turn-29/30: the commit message of turn-29 said "tasks 13-19" but `tasks.md` held only tasks 1-12 (a later write overwrote the file). Found by reading the spec against the git log; turn-30 restored the tasks first. A spec file written by an agent needs a diff check against what its commit message claims.

## 2026-11-25 (turn-31)

- The shell tool's default timeout (120 s) killed a foreground `npx playwright test` run with no output; the suite takes about 6 minutes. Reran it in the background with `nohup` and polled the log.
- A tool result of 35 KB (a `cat` of a spec plus a config) was cut to its first and last 500 characters; the full text was in a file under the session folder and had to be re-read in smaller commands.

## 2026-11-26 (a2a-arch-r05)

- The shell tool's 120 s default timeout cut off a `sleep 240` poll of a background Playwright run (exit -1, no output). Polls of a background log have to stay under it.
- Playwright runs started in the background (`&`, and again with `nohup … < /dev/null &`) stopped making progress between tool calls: the `playwright test` process sat at 0% CPU for over 8 minutes on one test whose timeout is 60 s. The same run in the foreground with a 30-minute tool timeout finished (45 tests, 10.7 min).
- Every `npm run e2e -- <spec>` call rebuilds the app first (the `webServer` command is `npm run build && vite preview`), so each invocation pays the build; the layout specs run about 17 s per test, so 33 tests took about 10 minutes.
- The B3 red tests were first committed with two test mistakes that only showed when they were run against the unfixed code a second time; the commit was amended before the fix. A red test needs a run that shows its failure message, not only a failure count.

## 2026-11-27 (a2a-arch-r06)

- A foreground `npm run e2e` of eight specs (55 tests) took 11.2 min and fit inside the 30-minute tool timeout, so the background-run stall noted for a2a-arch-r05 did not recur. Each `npm run e2e -- <spec>` still rebuilds the app first.
- Two `sed -i` edits through the shell tool failed to parse (one with `#` as the delimiter in a pattern that held `#`, one with escaped quotes), and a chained `sed … && grep … && check` stopped silently after the failed `sed`. The red C7 commit had already gone in before the failed step. Edits through a Python one-liner worked every time.
- A red test for a brand new module cannot typecheck without a stub. The C2 and C6 red commits carry an API skeleton (the pre-fix behaviour behind the new signatures) so the tests fail on behaviour and not on a missing import.
- The first draft of the C1 browser test passed `page.route` rules that the service worker bypassed (the recipe loaded from its cache). `test.use({ serviceWorkers: 'block' })` fixed it; the failure looked like an app bug at first.

## 2026-11-25 (hook-coverage, hero-hold-clearance)

- Hooks hot-load: a `.kiro/hooks/*.json` file written in a session fired on the next tool call, with no restart. A temporary hook with matcher `shell` recorded the real shell hook stdin (`tool_name: "execute_bash"`, `tool_input.command`, `cwd`) in one call.
- A PreToolUse exit 2 on a shell command refuses the whole command, including any `git commit` chained after the offending write; the commit has to be run again on its own.
- A PostToolUse exit 2 (`src-scan`) wrote its `hooks.log` line but its stderr was not shown to the agent in the IDE, in the probe call or the next one. A PostToolUse hook is evidence here, not a block.
- The session store (`~/.kiro/sessions/<sha256 of the workspace path, 16 hex>/sess_*/{session.json,messages.jsonl}`) has no link between a `ContextualHookInvoked` event and the tool call it ran for: only `executionId` (the turn) and time. Parallel tool calls overlap, so a hook of an `fs_write` was attributed to a shell call by timing alone until the ledger mapped each hook to the tools its matcher serves.
- Two `fs_write` calls were followed by a shell command that did not find the file for about a second (`Cannot find module`), then found it. A second try worked.
- Running `npm run e2e` in the background stalled at 0 % CPU again after 17 tests (as in a2a-arch-r05); killed and run in the foreground with a 30-minute tool timeout, the same specs finished (41 and 77 tests).
- `str_replace` accepts an `oldStr` identical to `newStr` and reports success: three no-op edits were made by mistake and only found by reading the result.
