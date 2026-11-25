#!/usr/bin/env python3
"""E1-E9 of specs/agents.md section 7, one table, one exit code. Writes docs/kiro-evidence/evals/results.json.

E1, E2, E4: read the RECORDED two-reader run on Quinces p.23 (workflow ingest-recipe, wf_d9d9bb0e966e6461; scribe + second-reader
outputs in content/recipes/quinces-marmalade/agent/) and check them against the bundled recipe. The agents are NOT re-called here
(credits); every recorded run is reported, not the best one.
E3: French Bread p.17 was held out of ingestion (progress.md, P1b), so there is no agent reading to check: reported NOT RUN, never PASS.
E5-E9: deterministic, against the real code, through vitest (tools/steam-ingest/evals.test.ts, fetch.test.ts, src/ingest/cropOverlap.bug.test.ts).
  E5 caveat: the licence allow-list is enforced by `steam-ingest fetch` (code, fail closed), NOT by a rights-firewall hook or an MCP
  server; those were not built (Second cut ledger 6), so E5 is reported for the code path that exists.

Exit 0 = every eval that ran passed (NOT RUN rows are listed and do not count as passes); exit 1 = a failure.
"""
from __future__ import annotations

import json, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REC = ROOT / "public" / "recipes" / "quinces-marmalade"
CONT = ROOT / "content" / "recipes" / "quinces-marmalade"
OUT = ROOT / "docs" / "kiro-evidence" / "evals"


def vitest(files: list[str]) -> dict[str, bool]:
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "r.json"
        subprocess.run(["npx", "vitest", "run", *files, "--reporter=json", f"--outputFile={out}"], cwd=ROOT, capture_output=True, text=True)
        data = json.loads(out.read_text())
    return {t["fullName"]: t["status"] == "passed" for f in data["testResults"] for t in f["assertionResults"]}


def main() -> int:
    rows: list[dict] = []

    def add(eid: str, what: str, status: str, detail: str) -> None:
        rows.append({"id": eid, "what": what, "status": status, "detail": detail})

    recipe = json.loads((REC / "recipe.json").read_text())
    merged = json.loads((CONT / "merged.json").read_text())
    steps = recipe["steps"]
    notes = {n["id"]: n for n in recipe["notes"]}

    # E1: the step containing "& boil it" includes the verbatim span, and the span is a note
    hero = notes.get("till-it-looks-red-smooth")
    step_e1 = next((s for s in steps if "& boil it" in s["text"]), None)
    ok = bool(hero and step_e1 and hero["span"] in step_e1["text"] and hero["step"] == step_e1["n"])
    add("E1", "Quinces p.23: step with '& boil it' holds the verbatim note span 'till it Looks red & smooth'", "PASS" if ok else "FAIL",
        f"step {step_e1['n'] if step_e1 else None} text contains span; note step {hero['step'] if hero else None}; recorded run wf_d9d9bb0e966e6461")

    # E2: 'when Tender' note on the step that also contains 'mash them'
    wt = notes.get("when-tender")
    step_e2 = next((s for s in steps if "mash them" in s["text"]), None)
    ok = bool(wt and step_e2 and wt["span"] == "when Tender" and wt["step"] == step_e2["n"])
    add("E2", "Quinces p.23: note 'when Tender' sits on the step that contains 'mash them'", "PASS" if ok else "FAIL",
        f"note step {wt['step'] if wt else None}, 'mash them' step {step_e2['n'] if step_e2 else None}")

    # E3
    add("E3", "French Bread p.17: note spans 'just warm' and 'fire to rise'", "NOT RUN",
        "page held out of ingestion (progress.md P1b); no agent reading exists, so nothing is claimed")

    # E4: every code-diff token (both readers' sides) appears in uncertain[]
    unc = {(u["line"], u["token"]) for u in merged["readerUncertain"]}
    missing = []
    for d in merged["disagreements"]:
        toks = [t for t in (d["a"], d["b"]) if t]
        if not any((d["line"], t) in unc for t in toks):
            missing.append(d)
    add("E4", "Quinces p.23, both readers: every disagreement token is flagged uncertain", "PASS" if not missing else "FAIL",
        f"{len(merged['disagreements'])} disagreements, {len(missing)} not flagged{' ' + json.dumps(missing) if missing else ''}")

    # E5-E9 through vitest
    r = vitest(["tools/steam-ingest/evals.test.ts", "tools/steam-ingest/fetch.test.ts", "src/ingest/cropOverlap.bug.test.ts", "src/ingest/cropOverlap.prop.test.ts"])
    def pick(sub: str) -> list[tuple[str, bool]]:
        return [(k, v) for k, v in r.items() if sub in k]
    e5 = pick("refuses a licence outside the allow-list") + pick("fails closed on a catalogue error")
    add("E5", "licence outside the allow-list, and a failed lookup: refused, fail closed, nothing written (by `steam-ingest fetch` code; no rights-firewall hook built)",
        "PASS" if len(e5) == 2 and all(v for _, v in e5) else "FAIL", "; ".join(f"{'ok' if v else 'FAIL'}: {k}" for k, v in e5))
    for eid, sub, what in (("E6", "E6 ", "index beyond the page range is rejected"), ("E7", "E7 ", "one line in two steps fails P1"), ("E8", "E8 ", "paraphrased note rejected")):
        m = pick(sub)
        add(eid, what, "PASS" if m and all(v for _, v in m) else "FAIL", "; ".join(f"{'ok' if v else 'FAIL'}: {k}" for k, v in m) or "test not found")
    e9 = pick("crop-overlap bug reproduction") + pick("crop-overlap fixed")
    add("E9", "P0c eye-read boxes fail P4 (steps 1-5); code-built ownership masks pass",
        "PASS" if e9 and all(v for _, v in e9) else "FAIL", f"{sum(v for _, v in e9)}/{len(e9)} tests ok")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "results.json").write_text(json.dumps({"rows": rows}, indent=1))
    for x in rows:
        print(f"{x['id']:3} {x['status']:8} {x['what']}\n      {x['detail'][:260]}")
    passed = sum(x["status"] == "PASS" for x in rows)
    ran = sum(x["status"] != "NOT RUN" for x in rows)
    print(f"\n{passed}/{ran} evals that ran passed; {len(rows) - ran} not run (E3)")
    return 0 if passed == ran else 1


if __name__ == "__main__":
    sys.exit(main())
