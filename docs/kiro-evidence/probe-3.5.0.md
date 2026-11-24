# kiro-cli 3.5.0 probe — which hooks and agent features really fire headless

Run 2026-11-24 16:10–16:15 UTC on macOS, `kiro-cli 3.5.0`, `chat.agentEngine = "v3"`, every run
`kiro-cli chat --v3 --no-interactive --trust-all-tools` (run 3 adds `--agent reader-a`).
Workspace: a scratch folder (`/tmp/steam-probe`), not this repo, so no probe hook ever ran against product files.
Its exact configuration is in [`probe-3.5.0/workspace/`](probe-3.5.0/workspace/) (`dot-kiro/` = the probe's `.kiro/`).
Every hook was a shell command that appended the JSON it received on stdin to `hooks.log`.
Raw output per run: `probe-3.5.0/runN.out.txt` (Kiro's transcript, `[INFO]` transport lines removed) and
`probe-3.5.0/runN.hooks.log` (what the hooks wrote, unedited).

This probe gates the hook design: no hook JSON goes into this repo's `.kiro/hooks/` before this file exists, and a
trigger that did not fire here is not claimed anywhere.

## Results

| # | What was tested | Result | Evidence |
|---|---|---|---|
| 1 | **PreToolUse**, matcher `write` | **Fires** on `fs_write` and `str_replace`, before the tool runs. Receives `tool_name` + `tool_input.path` | run1.hooks.log lines 1, 3, 5 |
| 2 | **PreToolUse can block** (exit 2) | **Blocks.** The write to `content/blocked.json` did not happen; Kiro reported the hook's stderr ("probe: writes to blocked.json are refused by hook") | run1.hooks.log line 6, run1.out.txt |
| 3 | **PostToolUse**, matcher `write` | **Fires** after the tool, with `tool_response` | run1.hooks.log lines 2, 4 |
| 4 | **PostFileSave / PostFileCreate**, glob matchers (`content/**/*.json`, `**/*.json`, `*.json`, …) | **Never fired.** Only the hook with no matcher fired | run1.hooks.log (none), run2.hooks.log (`m5:None` only) |
| 5 | **PostFileSave / PostFileCreate**, regex matchers (`content/.*\.json$`) | **Fire** on agent creates and edits. Matchers are regular expressions tested against the absolute `file_path`; globs do not match | run3.hooks.log, run5.hooks.log, run8.hooks.log |
| 6 | **File Save on a manual save** (a file rewritten from outside Kiro twice, 16:14:36–38 UTC, while a Kiro session was running a shell wait) | **Does not fire.** The agent's own save of `content/agent.json` six seconds later fired both File hooks | run8.hooks.log (only `agent.json` lines) |
| 7 | **Stop** (Agent Stop) | **Fires** at the end of every turn, including each workflow step session | run1, run5 hooks logs |
| 8 | **Stop exit 1 → continue** (the "don't stop until green" loop) | **Kiro continued for exactly one more turn** and followed the hook's stderr. The continuation turn's own stop did **not** invoke the hook again (call counter stayed at 1), so one re-entry per prompt is what we observed, not a loop | run6.hooks.log (`call=1` only), run6.out.txt (two answers) |
| 9 | **PreTaskExec / PostTaskExec** (spec task hooks) | **Not reachable headless.** `/spec run probe` sent with `--no-interactive` is not treated as a slash command: the model read it as text and launched a workflow. Asking for "task 1 as a spec task" (run 2) made Kiro do the task directly. Neither task hook fired in any run | run2, run7 transcripts + hooks logs |
| 10 | **Agent `permissions`**: `reader-a` may write only `content/a.json` and may not read `content/b.json` | **Enforced even under `--trust-all-tools`** (deny wins over the session allow). Read of `b.json`: "Blocked by a permission rule (deny fs_read matching "content/b.json") … Source: agent-profile". Write of `b2.json`: "Blocked by a permission rule (deny fs_write matching "**")" | run3.out.txt |
| 11 | **Declarative workflow**: `parallel` (reader-a ∥ reader-b) → `watch` node, `handler: command`, `node tools/gate.mjs` | **Completed headless.** The first attempt failed validation on our own recipe (`parallel` needs `joinPolicy` + `branches`, not `policy` + `steps`); fixed, the run completed: each reader ran in its own session (different `session_id`), each was denied the other's file, and the watch node's command reached `terminal-state` on its first poll with payload `{"a":true,"b":true,"verdict":"both-readers-present"}` | run4.out.txt (validation errors), run5.out.txt, run5.hooks.log (`watch-gate cursor=null a=true b=true`) |
| 12 | File hooks inside workflow steps | **Fire** for each step session's agent writes (same as a chat session) | run5.hooks.log |
| — | PreToolUse on an MCP tool (`@iiif/fetch_region`) | **Not probed** here: the probe had no MCP server. It is probed when the IIIF server exists, before the rights-firewall hook is written | — |

**Hook trigger types that fired headless: 5 of 7 tested** (PreToolUse incl. blocking, PostToolUse, PostFileCreate,
PostFileSave, Stop). Not fired headless: PreTaskExec, PostTaskExec. Agent permissions and the workflow `watch`/`command`
node both worked.

## Consequences for this repo's `.kiro/`

1. File-trigger hooks use **regex** matchers on the absolute path (e.g. `content/recipes/.*/agent/.*\.json$`), never globs.
2. File Save hooks also fire for writes made inside workflow steps, so any hook on a gate input must be idempotent
   (the gate's input-hash lock makes a repeat run a no-op).
3. "Tests after every spec task" (PostTaskExec) cannot be demonstrated headless. It is only claimed if it is seen firing
   in the IDE or the interactive `/spec run` view, and only from what `hooks.log` records.
4. The Stop gate gives one continuation turn per prompt in 3.5.0 headless, not an open loop; a counter of 3 re-entries
   is not observable here and is not claimed.
5. Headless instructions are plain prompts: slash commands such as `/spec run` and `/workflow run` are interpreted
   by the model, not by the CLI. Workflows are started by asking for `run_workflow` on a saved recipe.
