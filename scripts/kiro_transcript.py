#!/usr/bin/env python3
"""Condensed, scrubbed transcript of one Kiro CLI session, from Kiro's own session store.

    python3 scripts/kiro_transcript.py <session-dir> <out.md> [--label turn-NN]

<session-dir> is ~/.kiro/sessions/<workspace-hash>/sess_<id> (session.json + messages.jsonl, written by kiro-cli).
Kept: the prompt, every assistant message (full text), every tool call (tool name + the first line of its command or
its path, cut at 200 chars), every hook invocation Kiro recorded, and the session's own metadata.
Dropped: tool OUTPUT (file contents, test logs), which is long and can hold anything. The workspace path becomes `.`;
any path outside the repository becomes `<outside-repo>`.
The output is meant to be leak-scanned before it is committed.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

HOME = os.path.expanduser('~')


WORKSPACE: str = ''


def scrub(s: str) -> str:
    """Workspace path → `.`; any other path outside the repository (the private planning folders beside it, the home
    folder) → `<outside-repo>`; credentials-looking assignments → `<scrubbed>`."""
    if WORKSPACE:
        s = s.replace(WORKSPACE + '/', './').replace(WORKSPACE, '.')
        s = s.replace(WORKSPACE.replace(HOME, '~') + '/', './').replace(WORKSPACE.replace(HOME, '~'), '.')
    s = re.sub(r'(?:~|' + re.escape(HOME) + r')/[^\s`\'")\]]*', '<outside-repo>', s)
    s = re.sub(r'(?<![\w.])(?:\.\./)+(?:specs|kiro-prompts|submission|logs|assets|_[a-z]+|project\.json|event\.json|CLAUDE\.md)\b[^\s`\'")\]]*', '<outside-repo>', s)
    return re.sub(r'(?i)(token|secret|password|api[_-]?key)=\S+', r'\1=<scrubbed>', s)


def first_line(v: object, n: int = 200) -> str:
    s = str(v).strip().splitlines()[0] if str(v).strip() else ''
    return (s[:n] + ' …') if len(s) > n or '\n' in str(v).strip() else s


def main() -> int:
    sdir, out = Path(sys.argv[1]), Path(sys.argv[2])
    label = sys.argv[sys.argv.index('--label') + 1] if '--label' in sys.argv else sdir.name
    meta = json.loads((sdir / 'session.json').read_text())
    global WORKSPACE
    WORKSPACE = (meta.get('workspacePaths') or [''])[0]
    lines = [f'# Kiro session transcript — {label}', '',
             f'- Session: `{meta["id"]}` · title (by Kiro): "{meta.get("title", "")}"',
             f'- Window (UTC): {meta.get("createdAt")} → {meta.get("lastModifiedAt")} · model: {meta.get("modelId")} · mode: {meta.get("agentMode")}',
             '- Source: kiro-cli session store (`session.json`, `messages.jsonl`), condensed by `scripts/kiro_transcript.py`: '
             'prompt, assistant text, tool calls (name + first line), hook invocations. Tool output is omitted.', '']
    calls = 0
    for raw in (sdir / 'messages.jsonl').read_text().splitlines():
        try:
            m = json.loads(raw)
        except json.JSONDecodeError:
            continue
        p = m.get('payload', {})
        t = p.get('type')
        ts = (m.get('timestamp') or '')[11:19]
        if t == 'user':
            text = p.get('content') or p.get('text') or ''
            if isinstance(text, list):
                text = '\n'.join(c.get('text', '') for c in text if isinstance(c, dict))
            lines += ['## Prompt', '', '```text', scrub(str(text)).strip(), '```', '', '## Session', '']
        elif t == 'assistant':
            text = p.get('content') or p.get('text') or ''
            if isinstance(text, list):
                text = '\n'.join(c.get('text', '') for c in text if isinstance(c, dict) and c.get('text'))
            text = scrub(str(text)).strip()
            if text:
                lines += [f'**{ts} Kiro:** ' + text.replace('\n', '\n> '), '']
        elif t == 'tool_call':
            calls += 1
            a = p.get('args', {}) or {}
            what = a.get('command') or a.get('path') or a.get('file_path') or ''
            lines.append(f'- `{ts}` **{p.get("toolName")}** `{scrub(first_line(what)).replace("`", "ˋ")}`')
        elif t == 'ContextualHookInvoked':
            name = p.get('hookName') or p.get('name') or json.dumps({k: v for k, v in p.items() if k != 'type'})[:160]
            lines.append(f'- `{ts}` ↳ hook invoked: {scrub(str(name))}')
    lines += ['', f'Tool calls: {calls}.', '']
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'wrote {out} ({calls} tool calls)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
