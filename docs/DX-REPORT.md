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
