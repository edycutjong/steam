#!/usr/bin/env python3
"""Experiment 2 (one reader vs two readers), measured on the recorded agent readings of Quinces p.23.

Question: when the readings are scored against the frozen eyes-only reading (fixtures/gold-readings.json, written
before any Kiro reader ran on this page), how many of the scribe's word errors does each safeguard put in front of a
human: (a) the scribe alone, through the tokens it marks `uncertain`; (b) the two-reader diff, through the
disagreements in merged.json; (c) both together.

Inputs (all committed): content/recipes/<id>/agent/scribe.json, agent/second.json, merged.json, fixtures/gold-readings.json.
Output: docs/kiro-evidence/evals/experiment-readers.json (+ a table on stdout). Deterministic; no network, no model.

Rules, stated before reading the result:
- Line k of the gold reading is body line k+1 of an agent reading (line 0 is the title, which gold does not hold).
- The margin number "(N.26)" is not in the gold body text; it is stripped from the agent line before comparing.
- An "error" is a word position where the scribe's word differs from the gold word (exact string compare,
  after collapsing whitespace), aligned with difflib on the word lists.
- A safeguard "catches" an error when it flags that same line + word string (uncertain token of the scribe,
  or the scribe side `a` of a disagreement).
- The gold reading was made by the builder's agent by eye, not by a human; it is an independent check, not truth.
"""
from __future__ import annotations

import difflib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RID = sys.argv[1] if len(sys.argv) > 1 else 'quinces-marmalade'
REC = ROOT / 'content' / 'recipes' / RID
OUT = ROOT / 'docs' / 'kiro-evidence' / 'evals' / 'experiment-readers.json'
MARGIN = re.compile(r'^\(N[^)]*\)\s*')


def load(p: Path):
    return json.loads(p.read_text(encoding='utf-8'))


def words(s: str) -> list[str]:
    return s.split()


def errors(agent_lines: dict[int, str], gold: list[str]) -> list[dict]:
    out = []
    for k, g in enumerate(gold):
        i = k + 1
        a = MARGIN.sub('', agent_lines.get(i, ''))
        aw, gw = words(a), words(g)
        sm = difflib.SequenceMatcher(a=aw, b=gw, autojunk=False)
        for tag, a0, a1, b0, b1 in sm.get_opcodes():
            if tag == 'equal':
                continue
            out.append({'line': i, 'agent': ' '.join(aw[a0:a1]), 'gold': ' '.join(gw[b0:b1]), 'op': tag})
    return out


def main() -> int:
    scribe = load(REC / 'agent' / 'scribe.json')
    second = load(REC / 'agent' / 'second.json')
    merged = load(REC / 'merged.json')
    gold = [ln['text'] for ln in load(ROOT / 'fixtures' / 'gold-readings.json')['lines']]

    s_lines = {ln['i']: ln['text'] for ln in scribe['lines']}
    r_lines = {ln['i']: ln['text'] for ln in second['lines']}
    s_err, r_err = errors(s_lines, gold), errors(r_lines, gold)

    uncertain = {(ln['i'], u['token']) for ln in scribe['lines'] for u in ln.get('uncertain', [])}
    diff = {(d['line'], d['a']) for d in merged['disagreements']}

    def caught(e: dict, flags: set) -> bool:
        return any((e['line'], tok) in flags for tok in e['agent'].split()) if e['agent'] else False

    rows = []
    for e in s_err:
        rows.append({**e, 'uncertain': caught(e, uncertain), 'diff': caught(e, diff)})
    n = len(rows)
    res = {
        'recipe': RID,
        'goldBy': load(ROOT / 'fixtures' / 'gold-readings.json')['by'],
        'goldLines': len(gold),
        'scribeErrors': n,
        'secondReaderErrors': len(r_err),
        'scribeUncertainTokens': len(uncertain),
        'diffFlags': len(diff),
        'caughtByUncertainOnly': sum(1 for r in rows if r['uncertain']),
        'caughtByDiff': sum(1 for r in rows if r['diff']),
        'caughtByEither': sum(1 for r in rows if r['uncertain'] or r['diff']),
        'missedByBoth': [r for r in rows if not (r['uncertain'] or r['diff'])],
        'scribeErrorRows': rows,
        'secondReaderErrorRows': r_err,
        'command': 'python3 scripts/experiment_readers.py ' + RID,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(res, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f"scribe errors vs gold: {n} | second-reader errors: {len(r_err)}")
    print(f"flagged by scribe 'uncertain' alone: {res['caughtByUncertainOnly']}/{n} ({len(uncertain)} tokens flagged)")
    print(f"flagged by the two-reader diff:      {res['caughtByDiff']}/{n} ({len(diff)} disagreements)")
    print(f"flagged by either:                   {res['caughtByEither']}/{n}")
    for r in rows:
        print(f"  L{r['line']}: scribe '{r['agent']}' vs gold '{r['gold']}' · uncertain={r['uncertain']} diff={r['diff']}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
