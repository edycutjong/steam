#!/usr/bin/env python3
"""Fails while any placeholder is left in judge-facing text. Exit 0 = ready, 1 = something left, 2 = a named file is missing.

Scans, per file: any unresolved marker  ⟦MEASURED …⟧ / ⟦IF …⟧ / ⟦IF-BUILT …⟧ (or an unbalanced ⟦ ⟧), placeholder URLs/words
(youtu.be/xxx, youtube.com/watch?v=xxx, TODO, TBD, FIXME, lorem ipsum, 'paste here', '<your …>', '[link]'), and empty headings
(a heading followed directly by another heading or the end of the file).

Usage:
  python3 scripts/check_submission_readiness.py                      # README.md DEMO.md ARCHITECTURE.md docs/*.md that exist
  python3 scripts/check_submission_readiness.py FILE...              # exactly these files (e.g. a drafted Devpost text)
  python3 scripts/check_submission_readiness.py --fields FILE H1 H2  # FILE must have a non-empty section for every named heading
"""
from __future__ import annotations

import re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLACEHOLDERS = [
    r"youtu\.be/x{2,}", r"youtube\.com/watch\?v=x{2,}", r"\bTODO\b", r"\bTBD\b", r"\bFIXME\b", r"lorem ipsum", r"paste (it )?here",
    r"<your[^>]*>", r"\[link\]", r"\[url\]", r"https?://example\.(com|org)", r"\bxxx+\b",
]


def default_files() -> list[Path]:
    names = [ROOT / "README.md", ROOT / "DEMO.md", ROOT / "ARCHITECTURE.md"]
    names += sorted((ROOT / "docs").glob("*.md"))
    return [p for p in names if p.exists()]


def scan(p: Path) -> list[str]:
    text = p.read_text(encoding="utf-8")
    out: list[str] = []
    for i, line in enumerate(text.splitlines(), 1):
        for m in re.finditer(r"⟦[^⟧]*⟧?", line):
            out.append(f"{p.name}:{i}: unresolved marker {m.group(0)[:60]!r}")
        if line.count("⟦") != line.count("⟧") and not re.search(r"⟦", line):
            out.append(f"{p.name}:{i}: stray ⟧")
        for pat in PLACEHOLDERS:
            if re.search(pat, line, re.I):
                out.append(f"{p.name}:{i}: placeholder /{pat}/")
    heads = [(i, len(m.group(1)), m.group(2)) for i, l in enumerate(text.splitlines()) if (m := re.match(r"^(#{1,6})\s+(.*)$", l))]
    lines = text.splitlines()
    for k, (i, lvl, title) in enumerate(heads):
        end = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        if not any(l.strip() for l in lines[i + 1:end]) and (k + 1 == len(heads) or heads[k + 1][1] <= lvl):
            out.append(f"{p.name}:{i + 1}: empty section {title!r}")
    return out


def section(text: str, heading: str) -> str | None:
    lines = text.splitlines()
    for i, l in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+(.*)$", l)
        if m and heading.lower() in m.group(2).lower():
            lvl, body = len(m.group(1)), []
            for l2 in lines[i + 1:]:
                m2 = re.match(r"^(#{1,6})\s", l2)
                if m2 and len(m2.group(1)) <= lvl:
                    break
                body.append(l2)
            return "\n".join(body).strip()
    return None


def main(argv: list[str]) -> int:
    problems: list[str] = []
    if argv and argv[0] == "--fields":
        f = Path(argv[1])
        if not f.exists():
            print(f"missing {f}", file=sys.stderr); return 2
        text = f.read_text(encoding="utf-8")
        for h in argv[2:]:
            s = section(text, h)
            if not s:
                problems.append(f"{f.name}: field {h!r} is {'missing' if s is None else 'empty'}")
        files = [f]
    else:
        files = [Path(a) for a in argv] if argv else default_files()
        for f in files:
            if not f.exists():
                print(f"missing {f}", file=sys.stderr); return 2
    for f in files:
        problems += scan(f)
    for p in problems:
        print(p)
    print(f"{len(files)} file(s) scanned, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
