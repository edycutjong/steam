---
inclusion: fileMatch
fileMatchPattern: ["src/copy/**", "content/**/*.md", "README.md", "docs/**/*.md"]
---

# Copy and claims rules

## Numbers
- Every number in user-facing or judge-facing text must come from a script-produced file or a measured run log in this repo (`bench/`, `docs/kiro-evidence/`, test output).
- If it is not measured yet, write the marker ⟦MEASURED: what⟧ instead of a number.

## Wording
- Use plain truths such as "Not generated. Quoted."
- Never write "AI-powered".
- Never call the browser app "Kiro-powered". Kiro built it; it does not run in it.
- Label any accelerated playback on screen with its pace (×4, ×12).

## Kiro claims
- Claim only what `docs/kiro-evidence/hooks.log`, the `.kiro` folder or git history shows.
- Commits that change product code say who wrote them: `[kiro]` or `[claude-direct]`.
- Never present claude-direct code as Kiro's.

## Credit
- On every surface that shows the scan, credit: "Wellcome Collection, Public Domain Mark".
