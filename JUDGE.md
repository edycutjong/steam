# Her Hand in the Steam, for judges

> Cook Mode for one handwritten recipe from c. 1750 (Wellcome Collection MS.1810, p.23): at each step where the writer left a judgement, such as "till it Looks red & smooth", steam fogs a window and the writer's own scanned ink is wiped clear of it, quoted from the archive, never generated. It is for anyone who would rather cook from, or check a transcription against, the writer's own hand than a retyped copy. Typing a recipe up keeps the words but loses the hand and the page they came from; here every note links back to its region of the archive's scan.

**Video (2:21):** https://youtu.be/PWxFcwzVqFI · **Live:** https://steam.edycu.dev · Category: Costume Contest

## In the browser (~60 s)

No install, no account, no input needed. Desktop Chrome is best.

1. Open the [hero deep link](https://steam.edycu.dev/#/r/quinces-marmalade/cook?note=till-it-looks-red-smooth&pace=12&lead=6). Cook Mode opens on step 5 of 5, "…boil it till it Looks red & smooth…", with the pot at a visible ×12 pace.
2. Wait about 6 s (or press **Show the note**). The fog thickens and the writer's note is written out of it in the scan's own ink, about 5 s of writing (`WRITE_ON_MS` in `src/steam/timeline.ts`). The typed step stays on screen under the glass.
3. Press **The hand, quoted**. The glass wipes and a page opens with every note cut from the scan, each with its shelfmark and licence.
4. Press **verify at source ↗** under a note. The note's bounding box opens on Wellcome Collection's own image server (it may take in a little of the neighbouring lines).
5. Open the [edition](https://steam.edycu.dev/#/r/quinces-marmalade). The transcription marks with † each of the 5 places where the two Kiro readers disagree, with both readings shown. Press **Read the provenance** to expand the archive slip (institution, shelfmark, licence, IIIF manifest).
6. Optional: on step 1 (`?note=full-ripe`) drag across the glass, or press **Wipe the glass**: the fog closes and Cook Mode moves to the next step. Offline: after one visit, turn the network off and open the link again; it runs from the service worker's cache.

Every step with what to expect, the other deep links and the reduced-motion behaviour: [`DEMO.md`](DEMO.md).

## Design: what to look at

- **The haunting is the interface.** The fog thickening is the cue that a step with the writer's judgement has arrived; the lamp dips and the simmer goes quiet (once a first click or key has started the sound) to draw the eye; wiping the glass, by a drag or the **Wipe the glass** button, is how the cook says "seen" and moves on. Scary first, then one obvious thing to do.
- **One complete product, not a renderer demo.** Shelf → edition (transcription beside the scan, the readers' disagreements marked †) → Cook Mode → "The hand, quoted" → "verify at source" on the archive's own server; after one visit it also runs offline.
- **Nothing on the glass is faked.** The writing is the scan's own ink, never a font or a model; the type is self-hosted IM Fell English, Literata and DM Mono, and there is no handwriting font anywhere in the app.
- **It stays usable.** The typed step is always on screen under the glass, for reading and for screen readers; with reduced motion the canvas becomes a static pane (`e2e/cook-a11y.spec.ts`); on software GL the quality governor steps down to the static pane. Lighthouse accessibility is 100 on the app, the landing page and the deck.
- **Bounded, said plainly:** the animated renderer missed its own look gate at its last scored pass (6.5 of 7, see Honest limits).

## Kiro, impossible to miss

`git log --format=%s | grep -c '^\[kiro\]'` gives 304: the commits made in a Kiro session working through a spec's tasks, a bugfix spec or an agent workflow. Every other commit is labelled `[claude-direct]`, except 4 README-badge and image clean-up commits that carry no label (listed in [`docs/KIRO.md`](docs/KIRO.md)); none of the four came from Kiro. The builder was a Claude agent that wrote every prompt Kiro received; the full causal chain is [`docs/KIRO.md`](docs/KIRO.md).

| Kiro feature | Where | What it did | Evidence |
|---|---|---|---|
| Two custom agents, isolated | [`.kiro/agents/scribe.json`](.kiro/agents/scribe.json) (claude-opus-5.5), [`.kiro/agents/second-reader.json`](.kiro/agents/second-reader.json) (claude-sonnet-5.5) | Read the page's line strips separately; neither may read the other's file, the merge or the gate, and neither has shell, web or MCP. Where they disagree, both readings are kept and shown as † | [`agent/scribe.json`](content/recipes/quinces-marmalade/agent/scribe.json), [`agent/second.json`](content/recipes/quinces-marmalade/agent/second.json); against an eyes-only reference, scribe differs on 2 words and second-reader on 3: [`experiment-readers.json`](docs/kiro-evidence/evals/experiment-readers.json) |
| Workflow with a code gate | [`.kiro/workflows/ingest-recipe.workflow.json`](.kiro/workflows/ingest-recipe.workflow.json) | A `parallel` step runs both readers, then a `watch` step runs the deterministic gate (properties P1-P6) with no model turn. Run 1 failed the gate, run 2 stalled until the gate was fixed, run 3 passed (per `docs/KIRO.md`, on its first poll) | [`gate.json`](content/recipes/quinces-marmalade/gate.json) (P1-P6 pass); `watch` lines in [`hooks.log`](docs/kiro-evidence/hooks.log); [`docs/KIRO.md`](docs/KIRO.md) section 1 |
| Hook: `catalog-gate` | [`.kiro/hooks/catalog-gate.json`](.kiro/hooks/catalog-gate.json) → [`tools/hooks/catalog-gate.ts`](tools/hooks/catalog-gate.ts) | Refuses a write to the public catalog that lists a recipe failing the gate, hash or review checks | `catalog-gate · … · blocked:` lines in [`hooks.log`](docs/kiro-evidence/hooks.log); [`catalog-gate.test.ts`](tools/hooks/catalog-gate.test.ts) |
| Hooks that refuse `src/` writes | [`.kiro/hooks/no-imitation.json`](.kiro/hooks/no-imitation.json) → [`tools/hooks/no-imitation.ts`](tools/hooks/no-imitation.ts); [`.kiro/hooks/shell-gate.json`](.kiro/hooks/shell-gate.json), [`.kiro/hooks/src-scan-after-shell.json`](.kiro/hooks/src-scan-after-shell.json) | `no-imitation` refuses a write-tool write under `src/` that matches its patterns (`speechSynthesis`, a handwriting font or package); `shell-gate` refuses a shell command whose text visibly writes such code (a script run by name, or a path built from parts, is not seen before it runs); `src-scan-after-shell` reports one after the fact, since a headless after-hook cannot block | `no-imitation · … · blocked:` and `shell-gate · … · blocked:` lines in [`hooks.log`](docs/kiro-evidence/hooks.log); every committed line ever added to non-test files under `src/` (16,967 lines in 223 commits) matches none of `no-imitation`'s patterns, while the same rules fire 116 times on the test files that quote them: [`retro-scan.txt`](docs/kiro-evidence/hook-coverage/retro-scan.txt) |
| Bugfix spec `hook-coverage` | [`.kiro/specs/hook-coverage/`](.kiro/specs/hook-coverage/) | We measured our own hooks: they matched only Kiro's write tools, about 5% of the writes under `src/` as the session ledger's heuristic counts them (30 write-tool calls against 543 flagged shell commands; the rule has a documented false positive and misses). The spec added `shell-gate` and `src-scan-after-shell`; of three live probes, 2 were refused and 1 was caught after the write | [`sessions/before/ledger.md`](docs/kiro-evidence/sessions/before/ledger.md); [`docs/KIRO.md`](docs/KIRO.md) section 2 |
| Specs: 5 feature + 10 bugfix | [`.kiro/specs/`](.kiro/specs/) | Requirements, design and tasks for the renderer, the ingestion pipeline, Cook Mode and the offline shell; 8 of the 10 bugfix specs committed a failing test before the fix (e.g. `crop-overlap`, whose red test is kept: 5 expected-fail) | [`docs/EXPERIMENTS.md`](docs/EXPERIMENTS.md); [`cropOverlap.bug.test.ts`](src/ingest/cropOverlap.bug.test.ts) |
| Steering: 5 files | [`.kiro/steering/`](.kiro/steering/) | "Quoted, not generated": no synthetic voice, no handwriting font, no imitation, claim only what is in the repo, how to read an 18th-century hand | the hooks check the first two by pattern under `src/` (`speechSynthesis`; handwriting fonts and packages); "no imitation" is steering only |
| Sessions | [`docs/kiro-evidence/sessions/`](docs/kiro-evidence/sessions/) | 39 recorded Kiro sessions; 301 of the 304 `[kiro]` commits fall inside a session's time window | [`ledger.json`](docs/kiro-evidence/sessions/ledger.json), [`transcripts/`](docs/kiro-evidence/sessions/transcripts/) |

## Verify it yourself

```bash
git clone https://github.com/edycutjong/steam && cd steam && npm ci
npm run build && npm test        # Test Files 170 passed; Tests 1571 passed | 5 expected fail
npm run props                    # gate quinces-marmalade: pass (matches the committed gate.json)
git log --format=%s | grep -c '^\[kiro\]'   # 304
```

`python3 scripts/verify_provenance.py` (needs a connection, so it is not run in CI) re-fetches each note's region from the archive and compares it with the bundled crop: NCC .960 / .976 / .991 against a .90 threshold.

On every push GitHub Actions runs [CI](https://github.com/edycutjong/steam/actions/workflows/ci.yml) (the unit and property tests and `npm run props`), [E2E](https://github.com/edycutjong/steam/actions/workflows/e2e.yml) (114 Playwright tests), CodeQL, Security and Quality. [Deploy](https://github.com/edycutjong/steam/actions/workflows/deploy.yml) follows a green CI run on `main` and opens the hero deep link on the live site after each deploy.

## Honest limits

- One recipe is on the shelf, and the ingestion pipeline has run on that one page only. A judge cannot bring their own card.
- The reading's sign-off record is the builder's agent, not a person; a human sign-off is still owed.
- The write-on follows a traced path through the ink, so the order of strokes is ours, not the writer's.
- The manuscript gives no cooking times, so none is invented: each note arrives with its step.
- The renderer missed its own look gate (7/10) at its last scored pass (6.5 desktop, 6.5 phone).
- Kiro ran headless through `kiro-cli`; IDE-only features were not used, and no build-wide credit total was kept.

## Links

- Repository (MIT): https://github.com/edycutjong/steam
- Live: https://steam.edycu.dev · landing page: https://steam.edycu.dev/landing/ · deck: https://steam.edycu.dev/deck/
- Video: https://youtu.be/PWxFcwzVqFI
- [`README.md`](README.md) · [`DEMO.md`](DEMO.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md) · [`docs/KIRO.md`](docs/KIRO.md)
