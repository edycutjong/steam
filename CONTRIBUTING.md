# Contributing

1. `npm ci`
2. `npm run lint && npm run typecheck && npm run build && npm test && npm run props && npm run check:dist`
   (build before `npm test`, so the dist checks in `scripts/check-dist.test.ts` run instead of skipping)
3. `npm run e2e` (needs `npx playwright install chromium`)
4. `npm run budget` (gzip budget for the code the pages load; needs the build from step 2)

A pull request runs the same checks in GitHub Actions: CI (the steps above on Node 22 and 24), E2E, CodeQL, Security
(gitleaks, `npm audit`, dependency review) and Quality (Lighthouse CI + the bundle budget). Only `main` deploys, and
only after CI passes on it.

Small commits with real messages. Product code that came from a Kiro turn is marked `[kiro]` in the commit subject, everything else `[claude-direct]`. See `docs/KIRO.md`.

Two rules hold for every change: the hand stays quoted from the scan (no handwriting font, no generated stroke, no
synthetic voice), and a recipe reaches Cook Mode only through the ingestion gate (`npm run props`). Security problems go
to a private advisory, not an issue (`SECURITY.md`).

## Releases

Versions are cut by `.github/workflows/release.yml`, only after `CI` is green on `main`, and always on the commit that CI run
judged. The bump comes from the commit subjects since the last tag, in the Angular convention (the rules live in
`.github/scripts/next-version.sh`, which also runs locally as a dry run: `bash .github/scripts/next-version.sh`):

| Commit subject | Bump |
|---|---|
| `fix: ...`, `perf: ...` | patch (`0.1.0` to `0.1.1`) |
| `feat: ...` | minor (`0.1.1` to `0.2.0`) |
| any type with `!` (`feat!: ...`), or a `BREAKING CHANGE:` footer | major; while the version is `0.x`, minor |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `style:`, `build:`, `revert:`, or no type at all | no release |

Authorship prefixes are allowed in front of the type and are ignored when the bump is computed: `[kiro] `,
`[claude-direct] `, `kiro: ` and `claude-direct: ` (`[kiro] feat(shelf): ...` is a minor bump, `[claude-direct] docs: ...` is none). A prefix with no type after it cuts nothing.

Automatic cuts happen only while the repository variable `AUTO_RELEASE` is `true`; otherwise the run reports what it would
cut, and the owner can cut by hand (Actions > Release > Run workflow, with an optional dry run). After every run the workflow
keeps the README's release badge (`docs/badges/release.svg`) on the latest release, committing it as
`chore(release): badge vX.Y.Z`.
