# Design: cook-mode

Status: requirements-first spec, step 2 of 3 (requirements, then design, then tasks).
Scope: the one flow, shelf → edition view → Cook Mode → the steam reveal → wipe → "The hand, quoted". Section numbers of `requirements.md` are written R1 to R27.

## 0. Inputs, facts, and what this spec does not claim

### 0.1 What exists (read from the repository)

| Thing | Where | What this design takes from it |
|---|---|---|
| Steam renderer | `src/steam/` (`SteamPane`, `StaticPane`, `SteamRenderer`, `timeline.ts`, `assets.ts`, `params.ts`) | `SteamRenderer.startReveal()`, `wipe()` (accepted only while holding), `onState`, `onContextLost`; `RevealClock` in `StaticPane`; `revealState` phases `fogged → thickening → writing → holding → wiped`; `WRITE_ON_MS` 5000, `WIPE_MS` 1400, `THICKEN_MS` 1200. `SteamPane` reads the P1a spike from `public/hero/` (`NOTE_STEM`), reads `text`, reads `?t`, `?lead` (ms), `?fps` from `location.search` first and the hash query second. |
| Bundle | `public/recipes/quinces-marmalade/` | `recipe.json` (zod `RecipeBundle`), `page.jpg` (1601×2052), `note-<id>.png` / `.toi.png` / `.json`. Note JSON carries `shownText`, `span`, `step`, `groups[{line, rect, coreBand, t, inkPx, words}]`, `size`, `pageBox`, `verifyUrl` (percent form), `verifyApproximate`, `alignmentBy`. |
| Catalog | `content/catalog.json` | `[{id, title, gateSha256}]`, written only by `npm run catalog`. It is not under `public/`. |
| Gate and review | `content/recipes/<id>/gate.json`, `review.json` | `gateSha256` binds the sign-off. `source.json` is not a gate input (`gate.inputs` is `alignment, lines, ownershipReview, page, scribe, second, transcription`), so `source.json` may gain a field without invalidating the review. |
| Fixture manifest | `fixtures/wellcome-manifest-b18419665.trimmed.json` | Canvas `…/b18419665_MS_1810_0033.JP2`, `width` 3695, `height` 4737; image service `https://iiif.wellcomecollection.org/image/b18419665_MS_1810_0033.JP2`. |
| Tokens and fonts | `src/index.css`, `src/steam/tokens.ts` | `--bg --ink --muted --before --after --fault --rule --paper --ghost --moon --night`; IM Fell English, Literata, DM Mono. The values are read from the CSS; this spec writes no hex. |

### 0.2 Facts used from the ingest runs

- The three notes and their steps: `full-ripe` (step 1), `when-tender` (step 4), `till-it-looks-red-smooth` (step 5, the hero). The recipe has 5 steps and 12 lines (`L00` title to `L11`).
- Every note's `checkAt` is `{seconds: 0, source: "step-entry", basis: "the manuscript gives no time; the note arrives with its step"}`. The manuscript gives no times, so at any pace every quinces note appears on arrival at its step (R11.5). The pace changes the timer and the badge, and would change a cited or cook-set time.
- Readers: `scribe` and `second-reader`. The bundle lists 5 reader disagreements (`transcription.disagreements`) and the merged lines carry 5 `†[` markers.
- `review.json` (`reviewedBy`: "Claude Code builder agent (autopilot P1b), not a human", `reviewedAt`: "2026-11-25") and `ownership.reviewed[].reviewer` ("Kiro (agent), turn-18", "Kiro (agent), turn-18, Kiro (agent), turn-21") are shown exactly as recorded (R3.6, R3.7). `alignment: "curator"` is an internal value and is never shown; the person-facing line is "Word boundaries chosen by Kiro (agent), turn-24" (R3.8).
- `verifyApproximate` is true on all three notes: the page was straightened by 1.6° before reading, so the note's `pageBox` is in the straightened frame and the percentage `verifyUrl` was computed from the mapped-back bounding box.
- `public/hero/` is the P1a spike. It must go (R15.9). The `StaticPane` images `pane-*.webp` are not committed today; `npm run static-panes` makes them. R15.10 commits them per note.

### 0.3 Discrepancies found while writing (reported, not fixed here)

1. The brief said "6 marked disagreements". The bundle, `gate.json`, `merged.json` and the merged text all hold 5; `review.json`'s free-text note says "6 reader disagreements". The app reads the count from `transcription.disagreements.length` and never hard-codes it (R3.5). The note text in `review.json` is not shown anywhere in the app. The owner should correct that sentence in a re-review.
2. The brief said the page is "scaled from the 1600-px frame". The page frame of this recipe is 1601×2052 (`fixtures/p0033.jpg`). The scale uses the frame in the bundle, per axis (R21.4).
3. The catalog is outside `public/`. The app imports it at build time (§2.1).
4. `SteamPane` reads `lead` in milliseconds from the URL, and Cook Mode's `lead` is in seconds. `SteamGlass` never reads the URL (R15.2), so the two cannot meet.

### 0.4 Honest limits

- Check times: none is cited, so nothing in the product claims a cooking time. A "reveal at a time" exists in code and tests, and shows in the UI only when the cook sets a time on their own device.
- The first reveal pops the fog density at the moment the reveal starts (the renderer's "Show the note" path begins the write-on at once with no thickening). That look belongs to the later renderer spec. The lamp dip of the cue (R16.1) covers the same instant. Not claimed to be hidden.
- `derive` blocks the main thread (96 ms unthrottled, 353 ms at 4× throttle). Until `steam-renderer` task 39 moves it to a worker, Cook Mode prepares notes before the first reveal and never during a write-on (R15.11, R26.3).
- Static path waiting: under reduced motion the pane's own clock still takes 5 s to reach `holding`, so Wipe is disabled for that long (R14.2). Shortening it is a renderer-spec change.

## 1. Module layout and data flow

```
src/app/
  router.ts          pure. parseRoute / formatRoute                               (R1)
  useRoute.ts        hashchange subscription
  App.tsx            shell: route → screen, bundle store, announcer, audio unlock, focus rule
  Shelf.tsx          S1                                                            (R4)
  Edition.tsx        S2: Facsimile, Transcription, TimingStepper, ProvenanceDisclosure (R5-R8)
  Cook.tsx           S3: PaneStage, StepPanel, CountUpTimer, FlameKnob, WipeControl, MuteButton (R9-R19)
  Quoted.tsx         S6                                                            (R20)
  NotFound.tsx
  components/        ArchiveSlip, ReadingText, Facsimile, TimingStepper, StepPanel, CountUpTimer,
                     FlameKnob, WipeControl, MuteButton, PaneStage
  facsimile.ts       pure zoom/pan reducer                                         (R5.3)
  app.css cook.css   tokens only
src/cook/
  scheduler.ts       pure state machine, elapsedMs, nextDueWall, controlFor, snapshot (R12)
  plan.ts            bundle + overrides → Plan; paneNoteFor
  timing.ts          formatElapsed, ember window, checkLabel, formatDuration         (R8, R10)
  drag.ts            pure drag recognizer                                          (R14.4)
  session.ts         snapshot zod schema, validity rule                            (R18.2-18.3)
  revealGate.ts      effect gate: apply once when the pane is ready                (R15.7)
  announce.ts        pure composer of live-region messages                         (R23.3)
  cue.ts             cueEnvelope, brownNoise, constants                            (R16)
  audio.ts           Web Audio engine behind an injected factory                   (R16)
  wakelock.ts        thin wrapper                                                  (R17)
  clock.ts           Clock { now() } and the sleep/resume wakeups
src/data/
  schema.ts          RecipeBundle additions                                        (R21)
  provenance.ts      resolveNote, displayableNotes, regionOf, regionUrl             (R21, R22)
  reading.ts         parseReading, quoteSegments, plainText, primaryText            (R6, R20)
  catalog.ts         import catalog, fetch + validate bundles, cookable checks      (R2)
  store.ts           IndexedDB wrapper with memory fallback                         (R18)
src/copy/strings.ts  every fixed string
src/steam/           SteamGlass (extracted), SteamPane, StaticPane (per-note images)  (R15)
public/recipes/<id>/panes/<noteId>-<kind>-<state>.webp                               (R15.10)
```

Data flow in Cook Mode:

```
route + bundle + overrides ──▶ plan ──▶ scheduler.reduce(plan, state, event) ──▶ {state, effects}
      ▲                                      ▲                                         │
      │            events: start/deepLink/restore, tick, sleep, resume,                │
      │            setPace, show, wipe  ◀── Clock + visibility + controls              ▼
   store.ts ◀── snapshot on every change                      effects: reveal / advance / finish
                                                                          │
                          RevealGate ◀── reveal ──────────────────────────┤
                             │ applies once when the pane is ready         │
                             ▼                                             ▼
              SteamGlass controller.startReveal()                 announce + persist + route
              + cue (lamp dip, simmer duck) + marks
```

The scheduler knows nothing about the pane. The UI turns effects into pane commands. That is the whole contract.

## 2. Data

### 2.1 Catalog and bundle loading (`catalog.ts`, R2)

```ts
import catalogJson from '../../content/catalog.json'          // Vite JSON import, build time
export async function loadShelf(fetchJson = fetch): Promise<{ recipes: LoadedRecipe[]; rejected: Rejection[] }>
```

- `Catalog.safeParse(catalogJson)`. Failure gives `{recipes: [], rejected: [{id: '*', reason}]}` and the shelf error state.
- For each entry, `fetch('/recipes/<id>/recipe.json')`, then `RecipeBundle.safeParse`, then `checkCookable(bundle, entry)`:
  1. `bundle.id === entry.id`; 2. `bundle.gateSha256 === entry.gateSha256`; 3. every `note.step` is in `steps`; 4. no two notes share a step; 5. every `groups[].line` is in `lines`; 6. `steps[].lineIdx` are in `lines`.
- `LoadedRecipe = {bundle, notes: DisplayableNote[], withheld: {noteId, reason}[]}` where `notes = displayableNotes(bundle)` (R22.4). One `console.warn` line per rejection.
- Results are cached in a module `Map`. `Promise.allSettled` over the entries, so one failure does not hide the others.
- `content/catalog.json` is imported, not fetched, because `npm run catalog` writes it to `content/` and copies only the recipe folders to `public/`. A fetch would need a second copy, which would need a second writer (R35.5 of `ingest-pipeline`).

Single note per step (R2.3): `Plan.steps[i].note` is one note or none. A bundle with two notes on one step is not shown rather than half-supported. No current recipe has it. Supporting several notes per step would need a queue inside the state machine and a larger Wipe table; that is left out on purpose (§15).

### 2.2 Bundle additions (R21)

New fields, all added at catalog time:

```ts
// Source gains (source.json, optional there; required in a bundle)
canvas: { id: string, width: number, height: number }          // IIIF canvas id, size from the manifest
// Source.frame already exists as an optional field; a bundle always carries it
frame:  { width, height, scaleX, scaleY }                      // lines.json frame when source.json has none: 1601×2052 for quinces

// BundleNote gains
verifyBox: [x, y, w, h]                                        // page-frame px, deskew-aware, clipped; the rectangle verifyUrl turns into percent

// RecipeBundle gains
review: { reviewedBy: string, reviewedAt: string }             // absent only when readers are ["fallback"]
```

Where each comes from:

| Field | Written by | Reads | Touches a gate input? |
|---|---|---|---|
| `source.canvas` | new `steam-ingest canvas <id> [--from-fixture]` → `source.json` | the manifest (live, or the recorded fixture) | no: `source.json` is not a gate input |
| `source.frame` (bundle) | `buildRecipeBundle` | `lines.json` `frame` | no (read only) |
| `notes[].verifyBox` | `verifyRegion()` in `src/ingest/bundle.ts`, the function `verifyUrl()` is rebuilt on | `pageBox`, frame, `deskewDeg`, `deskewApplied` | no |
| `review` | `buildRecipeBundle` from `review.json` | `reviewedBy`, `reviewedAt` | no (the catalog already requires `review.json`) |

`verifyUrl()` is refactored to call `verifyRegion()` and format its result, so the percentage URL and `verifyBox` come from one computation (R21.3). A test regenerates the bundle and compares `gateSha256`.

### 2.3 The IIIF region (`provenance.ts`, R21.4 to R21.6)

```ts
export interface Region { x: number; y: number; w: number; h: number }          // canvas px, integers
export function regionOf(bundle: RecipeBundle, note: BundleNote): Region | null
export function regionUrl(bundle: RecipeBundle, note: BundleNote): string | null // {imageService}/{x},{y},{w},{h}/full/0/default.jpg
export function parseRegionUrl(url: string): { service: string; region: Region } | null
```

```
sx = canvas.width  / frame.width            sy = canvas.height / frame.height
[vx, vy, vw, vh] = note.verifyBox
x0 = clamp(floor(vx·sx), 0, W)      y0 = clamp(floor(vy·sy), 0, H)
x1 = clamp(ceil((vx+vw)·sx), 0, W)  y1 = clamp(ceil((vy+vh)·sy), 0, H)
region = { x: x0, y: y0, w: x1−x0, h: y1−y0 }       // null when w < 1 or h < 1
```

Floor and ceiling make the crop a superset of the scaled box, by less than 2 px per axis. The percentage URL names the same box with 4-decimal percentages, so each edge agrees within 1 canvas px plus the rounding of the percentage, which is at most 1e-6 × the canvas side (0.004 px on the 3695×4737 canvas) (R21.6). The first version of this sentence said "within 1 canvas px" flat. The P8.4 property found a canvas 1 px wide where the gap was 1.0016, so the bound is stated with its rounding term.

Worked example (recomputed by the task's test, not trusted from here): the hero note's committed `verifyUrl` is `…/pct:17.3617,77.2801,78.3701,10.7617/full/0/default.jpg`. On the 3695×4737 canvas that is x 641.51, y 3660.76, right 3537.29, bottom 4170.54, so the region is `641,3660,2897,511` and the link is `https://iiif.wellcomecollection.org/image/b18419665_MS_1810_0033.JP2/641,3660,2897,511/full/0/default.jpg`.

### 2.4 Provenance resolution (R22)

```ts
export const LICENCES = ['pdm', 'cc0', 'cc-by'] as const
export type Resolved =
  | { ok: true; manifest: string; canvas: string; region: Region; licence: string; regionUrl: string }
  | { ok: false; reason: string }
export function resolveNote(bundle, note): Resolved
export function displayableNotes(bundle): { notes: BundleNote[]; withheld: { noteId: string; reason: string }[] }
```

`resolveNote` checks, in order, and returns the first failing reason: manifest is https; `canvas.id` non-empty; `canvasIndex` integer; `note.provenance` agrees with `source` in the six fields; licence id in `LICENCES`; `regionOf` non-null; `parseRegionUrl(regionUrl)` equals `{service: imageService, region}`. There is no network call: "resolves to its source" means a reconstructible, checkable address, as the product's provenance rule states. Re-fetching crops from the archive is the job of `scripts/verify_provenance.py`, not of the app.

### 2.5 Reading marks (`reading.ts`, R6, R9, R20)

```ts
export type Segment = { kind: 'text'; text: string } | { kind: 'mark'; a: string; b: string }
export function parseReading(line: string): Segment[]                 // splits on †[a|b]; total, never throws
export function joinReading(segs: Segment[]): string                  // inverse: text, or †[a|b]
export function primaryText(segs: Segment[]): string                 // marks → a
export function plainText(segs: Segment[]): string                   // marks → "a (the second reader reads b)", empty b → "nothing"
export function quoteSegments(bundle, note): Segment[]               // the note's words, from groups[].words, with marks kept whole
```

`parseReading` uses the grammar of `ingest-pipeline` R15 (`†[a|b]`, `a` and `b` contain no `|`, `]` or `†`). A line with a stray `†` that does not form a marker is kept as text.

`quoteSegments`: for each group in order, take the line's display text (`corrected ?? merged`), tokenise its **primary** text on single spaces (the scribe's tokens, the index space of `words.from` and `words.to`), map each token to the segment it came from, and take tokens `from..to` (`'line'` takes all). A mark that any chosen token touches is included whole (the ingest forbids a quote that splits one, R17.6). Groups join with one space. `words: 'line'` is the whole line.

### 2.6 Store (`store.ts`, R18)

```ts
export interface Store {
  getSession(recipeId): Promise<Snapshot | null>;  putSession(s: Snapshot): Promise<void>;  deleteSession(recipeId): Promise<void>
  getTiming(recipeId): Promise<Record<string, number>>;  putTiming(recipeId, noteId, seconds): Promise<void>;  deleteTiming(recipeId, noteId): Promise<void>
  getSetting<T>(key): Promise<T | undefined>;  putSetting(key, value): Promise<void>
  readonly persistent: boolean                                         // false in the memory fallback
}
export function openStore(factory = indexedDB): Promise<Store>
```

IndexedDB `steam`, version 1, stores `sessions`, `timing`, `settings`. `openStore` returns the in-memory implementation when `indexedDB` is missing, the open throws, or a transaction fails; `persistent` is then false (R18.8). Tests use `fake-indexeddb`.

## 3. Routes (`router.ts`, R1)

```ts
export type Route =
  | { name: 'shelf' }
  | { name: 'edition'; id: string }
  | { name: 'cook'; id: string; pace: 1 | 4 | 12; note: string | null; lead: number | null; fps: boolean }
  | { name: 'quoted'; id: string }
  | { name: 'pane'; id: string; noteId: string; query: string }       // renderer harness (R15.8)
  | { name: 'notFound' }
export function parseRoute(hash: string): Route
export function formatRoute(r: Route): string
```

- `parseRoute` strips a leading `#`, splits the query at the first `?`, matches `^/$`, `^/r/(id)$`, `^/r/(id)/cook$`, `^/r/(id)/quoted$`, `^/pane/(id)/(noteId)$`. Anything else is `notFound`. A trailing slash is accepted. The id pattern is `RecipeId`; the note id pattern is the same.
- Query: `URLSearchParams`; `pace` accepted only as `1`, `4` or `12`; `lead` accepted when `Number.isFinite` and `0 ≤ n ≤ LEAD_MAX_S`; `note` accepted when it matches the note-id pattern; `fps` accepted as `1`. Everything else is dropped. `formatRoute` writes the non-default values only, in the fixed order `note`, `pace`, `lead`, `fps`.
- The router subscribes to `hashchange`. `location.search` is never read by routes (R1.7). The harness hands `SteamPane` an empty search and the hash query.
- A route change focuses the screen `<h1>` (`tabindex="-1"`), except Cook Mode, which focuses the Wipe control once ready (R14.9).

## 4. The scheduler (`scheduler.ts`, R12 and R13)

### 4.1 Types

```ts
export type Pace = 1 | 4 | 12
export interface PlanStep { note: { id: string; checkAtMs: number } | null }
export interface Plan { steps: PlanStep[] }                           // length N ≥ 1
export interface PaceSeg { atWall: number; pace: Pace }

export interface SchedState {
  status: 'idle' | 'running' | 'finished'
  stepIndex: number
  initialStep: number
  stepStartWall: number
  lastWall: number                                                     // greatest wall time seen; −Infinity while idle
  asleep: boolean
  paceHistory: PaceSeg[]                                               // since stepStartWall; [0].atWall === stepStartWall
  holdUntilWall: number | null                                         // deep link only, initial step only
  revealed: string[]                                                   // note ids, whole session
}

export type SchedEvent =
  | { type: 'start'; wallMs: number; pace: Pace }
  | { type: 'deepLink'; wallMs: number; stepIndex: number; leadMs: number; pace: Pace }
  | { type: 'restore'; wallMs: number; snapshot: Snapshot; pace?: Pace }
  | { type: 'tick' | 'sleep' | 'resume' | 'show' | 'wipe'; wallMs: number }
  | { type: 'setPace'; wallMs: number; pace: Pace }

export type SchedEffect =
  | { type: 'reveal'; noteId: string; stepIndex: number; cause: 'scheduled' | 'show' | 'wipe'; wallMs: number }
  | { type: 'advance'; stepIndex: number; wallMs: number }
  | { type: 'finish'; wallMs: number }

export const initialState: SchedState
export function reduce(plan: Plan, s: SchedState, e: SchedEvent): { state: SchedState; effects: SchedEffect[] }
export function elapsedMs(s: SchedState, wallMs: number): number
export function nextDueWall(plan: Plan, s: SchedState): number | null
export function noteState(plan: Plan, s: SchedState): 'none' | 'pending' | 'revealed'
export function controlFor(plan: Plan, s: SchedState): Control
export function toSnapshot(s: SchedState, recipeId: string): Snapshot
```

### 4.2 Algorithm

```
reduce(plan, s, e):
  if s.status == idle:
      if e is start | deepLink | restore: return begin(plan, e)
      return { s, [] }                                   // nothing happens before the first event
  if e is start | deepLink | restore: return clampOnly(s, e.wallMs)    // only the first event may start
  if s.status == finished: return clampOnly(s, e.wallMs)
  w = max(e.wallMs, s.lastWall); s = { ...s, lastWall: w }
  switch e.type:
    tick:     return due(plan, s, w)
    sleep:    r = due(plan, s, w); return { r.state with asleep: true, r.effects }
    resume:   return due(plan, { ...s, asleep: false }, w)
    setPace:  r = s.asleep ? { s, [] } : due(plan, s, w)           // reveals due at the old pace come first
              return { setPaceAt(r.state, w, e.pace), r.effects }
    show:     r = due(plan, s, w)
              if awake and noteState(r.state) == pending: reveal(r.state, 'show')   // appended to r.effects
              return
    wipe:     if asleep: return { s, [] }
              r = due(plan, s, w)
              if noteState(r.state) == pending: r = reveal(r.state, 'wipe')         // shown before the step changes
              return advance(plan, r, w)                                            // advance, or finish on the last step

due(plan, s, w):
  if s.asleep or noteState(plan, s) != pending: return { s, [] }
  if s.holdUntilWall != null and w < s.holdUntilWall: return { s, [] }
  if elapsedMs(s, w) < note.checkAtMs: return { s, [] }
  return reveal(s, 'scheduled')

reveal(s, cause):   s.revealed += note.id; effects += reveal {note.id, cause}
advance(plan, r, w):
  if stepIndex == N − 1: status = finished; effects += finish
  else: stepIndex += 1; stepStartWall = w; paceHistory = [{ atWall: w, pace: currentPace }]; holdUntilWall = null
        effects += advance;  then due(plan, state, w)          // arrival: a step-entry note reveals now

begin(plan, e):
  start:    stepIndex 0, holdUntilWall null
  deepLink: stepIndex clamp(e.stepIndex, 0, N−1), holdUntilWall = e.wallMs + max(0, e.leadMs)
  restore:  stepIndex, stepStartWall, paceHistory, revealed from the snapshot (ids not in plan dropped), holdUntilWall null
  status running, initialStep = stepIndex, lastWall = max(e.wallMs, last paceHistory atWall)
  then due(plan, state, lastWall)                                  // arrival, or a note that fell due while the page was closed
```

`setPaceAt` coalesces: when the last segment starts at `w` it is replaced, and a segment that repeats the previous pace is not added, so equal events never grow the history.

`elapsedMs(s, w)`: `w' = max(w, s.lastWall)`; the sum over segments `i` of `pace_i × (end_i − atWall_i)`, with `end_i` the next segment's `atWall` or `w'`. An idle or finished state gives 0 and the final value.

`nextDueWall(plan, s)`: null unless `running`, awake, with a pending note. Otherwise `need = note.checkAtMs − elapsedMs(s, s.lastWall)`; `t = s.lastWall + max(0, need) / currentPace`; the result is `max(t, holdUntilWall ?? −∞, s.lastWall)`. The UI sets one `setTimeout` for it; a tick at that wall time emits the reveal (K-property, §13).

Notes on the choices:

- **Why `wipe` reveals a pending note first.** The Wipe control never sends `wipe` for a pending note (it sends `show`, §4.4), so the path is unreachable from the UI. It exists so that no caller, test or future control can advance past a note. P7 covers it as a case.
- **Why sleeping blocks reveals.** A hidden page cannot show a reveal, and a reveal emitted into a hidden page would be applied to a pane that is not drawing. Holding it until `resume` gives "once, when I unlock" (R12.7).
- **Why `setPace` ticks first.** Time before the change is at the old pace. Doing the tick first keeps a reveal that fell due before the change at its own moment.
- **Why the hold is wall time.** A deep link's lead-in is a courtesy delay for a watcher, not a cooking time. Scaling it by 12 would make it 0.8 s.
- **Why `lastWall` is `−Infinity` when idle.** A wall time before the first event has nothing to clamp to. JSON cannot carry `−Infinity`; the idle state is created, never serialised (only running states are snapshotted).

### 4.3 Snapshot (`session.ts`, R18)

```ts
export const Snapshot = z.strictObject({
  v: z.literal(1), recipeId: RecipeId, stepIndex: z.number().int().min(0),
  stepStartWall: z.number().finite(),
  paceHistory: z.array(z.strictObject({ atWall: z.number().finite(), pace: z.union([z.literal(1), z.literal(4), z.literal(12)]) })).min(1),
  revealed: z.array(RecipeId),
})
export function snapshotValid(s: Snapshot, plan: Plan, recipeId: string, nowWall: number): boolean
```

`snapshotValid`: same recipe; `stepIndex < N`; `paceHistory[0].atWall === stepStartWall` and `atWall` non-decreasing; `revealed` all in the plan and without repeats; `nowWall − stepStartWall ≤ SESSION_MAX_AGE_MS` and `≥ 0`.

### 4.4 The Wipe table (`controlFor`, R14)

```ts
export interface Control { label: string; action: 'show' | 'wipe'; leavesCook: boolean }
```

| `noteState` | last step? | `label` | `action` | `leavesCook` |
|---|---|---|---|---|
| none | no | Next step | wipe | no |
| pending | either | Show the note | show | no |
| revealed | no | Wipe the glass | wipe | no |
| revealed or none | yes | The hand, quoted | wipe | yes |

The UI adds the pane's `writing` flag: while the revealed note is being written the control keeps its label, sets `aria-disabled`, and sends nothing (R14.2). Labels come from `src/copy/`.

### 4.5 `plan.ts`

```ts
export function buildPlan(bundle: RecipeBundle, notes: BundleNote[], overrides: Record<string, number>): Plan
export function effectiveCheckAt(note: BundleNote, overrides: Record<string, number>): CheckAt      // R8.1
export function paneNoteFor(plan: Plan, stepIndex: number): string | null                           // R15.5
```

`checkAtMs = effectiveCheckAt(note, overrides).seconds × 1000`. `paneNoteFor` returns the step's note, else the first note of a later step, else the last note of the plan, else `null`.

## 5. Timer, check labels and formatting (`timing.ts`, R8 and R10)

```ts
export function formatElapsed(ms: number): string                     // 0:07, 12:03, 1:02:09; floors to whole seconds; ms < 0 → 0:00
export function formatDuration(seconds: number): string               // "30 s", "2 min", "2 min 30 s"
export function checkLabel(c: CheckAt): string                        // R8.2
export const EMBER_WINDOW_S = 10
export function emberActive(plan, s, wallMs): boolean                 // pending reveal and 0 < wall left ≤ 10 s
```

`emberActive` uses `nextDueWall`: `left = nextDueWall − wallMs`, active when `0 < left ≤ EMBER_WINDOW_S × 1000`. A note due now (`left ≤ 0`) is not an ember moment, it is a reveal.

The display wakes at most every 250 ms (`setTimeout`), at `visibilitychange`, `pageshow`, `focus` and `resume`. Each wake computes `elapsedMs(state, clock.now())`. Nothing accumulates between wakes, so a throttled or frozen page shows the right value as soon as it wakes.

## 6. Cook Mode screen (`Cook.tsx`)

### 6.1 State hook `useCookSession`

```ts
const { plan, state, dispatch, notes, caption } = useCookSession({ bundle, loaded, route, store, clock })
```

- Start: `route.note` displayable → `deepLink` with `stepIndex = note.step − 1`, `leadMs = (route.lead ?? 10) × 1000`, `pace = route.pace`; else a valid snapshot (and no `note`) → `restore`; else `start`. A `note` that is not displayable gives `start` and the caption of R19.5.
- `dispatch(event)` reads `clock.now()` itself for UI events, calls `reduce`, stores the state in a ref plus a `useReducer` tick for render, persists the snapshot (R18.2), and hands `effects` to `applyEffects`.
- A single `useWakeups` effect owns the timers: `setTimeout` to `min(nextDueWall, now + 250)`; listeners for `visibilitychange` (hidden → `sleep`, visible → `resume`), `pageshow` and `focus` (→ `tick`), and `pagehide` (save). Every wake dispatches `tick` at `clock.now()`. All are removed on unmount (R26.4).
- `applyEffects`: `reveal` → `gate.enqueue(effect)`; `advance` → set `outgoing` pane (R15.6), compose the announcement, restart the timer; `finish` → delete the snapshot, navigate to `#/r/:id/quoted`.

### 6.2 `PaneStage`

Holds the live pane and, for 600 ms after a wipe, the outgoing one.

```
PaneStage { stepIndex, plan, notes, gate, params, reducedMotion }
  noteId = paneNoteFor(plan, stepIndex)
  current  = <SteamGlass key={noteId} ...>      one at a time
  outgoing = previous pane, kept until: its phase is 'wiped' and WIPE_MS has passed, then crossfaded out (opacity, 600 ms) and unmounted
```

`SteamGlass` reports `onState(RevealState)` and `onReady`. `PaneStage` publishes `phase` to the screen (for `aria-disabled` and the e2e attribute) and calls `gate.setReady(noteId)`.

### 6.3 `revealGate.ts` (R15.7)

```ts
export function createRevealGate(apply: (e: RevealEffect) => void): {
  enqueue(e: RevealEffect): void          // applies now if its pane is ready and nothing is blocking, else waits
  setReady(noteId: string | null): void   // the pane of noteId is ready, or none is
  setBlocked(b: boolean): void            // the outgoing pane is still sweeping
  readonly pending: readonly RevealEffect[]
}
```

Each effect is applied at most once; effects apply in enqueue order; an effect for a note whose pane never becomes ready stays pending (the UI shows the failed-scan state of R15.12 and drops it). `apply` calls `controller.startReveal()` on the pane, fires the cue (§8) and sets `cook:reveal:<noteId>`.

### 6.4 Announcer (`announce.ts`, R23.3)

```ts
export function compose(ctx: { kind: 'arrive' | 'wipe' | 'resume' | 'deepLink'; stepIndex; stepCount; stepText: string; note?: { span: string } | null; pace?: Pace }): string
```

One call per batch of changes produces one string, set once into the live region with a short clear first, so that a repeated identical string is still announced. Strings come from `src/copy/`. Plain step text is `plainText(parseReading(...))` (R23.3).

### 6.5 Controls row and layout

DOM order equals visual order: pane stage, caption, "Step n of N", step text, timer, flame knob, controls row. The row reads Back, Wipe, Mute from left to right, because R14.3 puts the Wipe control at the centre of the row; the first draft listed it as (Wipe, Back, Mute), which would make the DOM order differ from the visual order. The pane region carries the drag handler (`touch-action: none`) and the badge. The archive slip sits under the pane when the note state is `revealed` for the current step.

CSS: `.steam-root` gains `--glass-h` (default `100dvh` so `SteamPane` is unchanged). Cook Mode sets `--glass-h: 55dvh` on phones; on desktop the stage is `width: min(60vw, 1100px)`, centred. The upper sash and rails scale inside the stage with the existing custom properties. This is a layout change only; the pane's colours, fog and reveal are untouched.

### 6.6 Test hooks

Marks (`performance.mark`): `cook:ready`, `cook:reveal:<noteId>`, `cook:write-on:<noteId>`. Attributes on the Cook root: `data-step`, `data-step-count`, `data-note-state` (`none | pending | writing | held | wiping`), `data-pace`, `data-ready`, `data-wake`, `data-started-at-step`, `data-revealed` (comma list). They exist for tests; none carries a claim to a user.

## 7. The steam window (R15)

### 7.1 Extracting `SteamGlass`

Today `SteamPane` owns loading, the renderer, the `StaticPane` fallback, the state callback and the chrome. The change is a split:

```
SteamGlass(props)    sash + rails + canvas|StaticPane + load error      ← renderer lifecycle moves here
SteamPane            SteamGlass + foot (credit, button, fps, live region) ← unchanged behaviour, harness route only
```

Props of `SteamGlass`: `stem`, `paneDir`, `noteId`, `params: SteamParams`, `controllerRef`, `onState`, `onReady`, `initial: 'fogged' | 'held'`. No `window.location` access. `SteamPane` keeps `parseParams` and passes the result in. Existing tests and e2e specs keep their meaning; only the note they load changes (§7.3).

### 7.2 Driving the pane

| Moment | Call |
|---|---|
| Cook creates a pane | `params = {t: null, lead: Infinity, fps}`: `revealStart = t0 + Infinity`, so `revealState(−Infinity)` is `fogged` and the note is hidden (R1.1 of `steam-renderer`) |
| Reveal effect applied | `controllerRef.current.startReveal()` |
| Wipe pressed while held | `controllerRef.current.wipe()` then `dispatch(wipe)` |
| Restored note | `params.lead = −WRITE_ON_MS`, `initial: 'held'`: the first frame is already `holding` |
| Reduced motion, no WebGL2, lost context | `StaticPane` serves the same controller (`startReveal`, `wipe`) from its own `RevealClock` |

`wipe()` on the renderer is accepted only in `holding`, which is the state the Wipe control requires anyway (R14.2). The scheduler `wipe` event is dispatched in the same handler, and the pane then runs its sweep while the stage keeps it as `outgoing`.

### 7.3 Switching from the spike to the bundle

- `NoteMeta.text` becomes `shownText`. The bundle's note JSON has extra keys (`alignment`, `words` in groups, `span`, `step`, `trace`, …), which the schema strips as it did for the spike's. `loadNoteAssets` adds two checks against the bundle: JSON `noteId` equals the id and `size` equals the bundle note's `size`.
- `NOTE_STEM` and the `/hero` constants go. The harness route computes `stem = /recipes/<id>/note-<noteId>`.
- Files that name `public/hero` or load the pane at `/`: `src/steam/assets.ts` (`NOTE_STEM` doc), `src/steam/StaticPane.tsx` (`HERO_DIR`), `src/steam/SteamPane.tsx` (`NOTE_STEM`), `src/steam/assets.test.ts`, `src/steam/derive.test.ts`, `src/steam/hero.coverage.test.ts`, `e2e/helpers/pane.ts` (`HERO`, `openPane`), `e2e/steam-phone.spec.ts` (the three `pane-groups-*.webp` URLs, `page.goto('/?lead=0')`), `e2e/steam-timing.spec.ts` (`page.goto('/')`), `scripts/render-static-panes.ts` (`OUT_DIR`, `?t=`, `?lead=`), `scripts/measure-steam.ts` (`/?fps=1`). They move to the bundle's `till-it-looks-red-smooth` and to `/#/pane/quinces-marmalade/till-it-looks-red-smooth` with the same parameters in the hash query. The note is not identical to the spike's (two groups, different rects), so numbers that were pinned to the spike (layout rects, coverage) are re-measured and re-pinned in the task, with the new value written from the run, never adjusted to pass.
- `hero.coverage.test.ts` wraps its suites in `describe.skipIf(!existsSync(...))`. Once `public/hero/` is gone those suites would skip without a word. The task points them at the bundle and removes the `skipIf`, so a missing file fails.
- A guard test fails if `public/hero` exists or any file in `src/`, `e2e/` or `scripts/` contains `hero/` as a path.
- Measured in task 31 (renderer specs through the harness): the bundle's hero has thinner core bands than the spike (25 and 20 note px, against 35 and 34). On phones the renderer keeps 16 CSS px of core band, which forces group 1 to scale 0.8, so its ink runs −1 to 371 px on the 370 px pane at 390×844 and −16 to 356 px on the 340 px pane at 360×800 (`fits` false). The renderer spec chose the core band over the fit, and R24.4 forbids Cook Mode from overriding it, so this is reported as an open item for the renderer spec rather than hidden. The specs now assert the band, and that only the forced group overflows.
- The harness route remounts when its hash query changes, because a `page.goto` that changes only the hash does not reload the page.

### 7.4 `StaticPane` per note

```
public/recipes/<id>/panes/<noteId>-<kind>-<state>.webp      kind: page | groups      state: fogged | held | wiped
```

`StaticPane` takes `paneDir` and `noteId` and builds the image URLs from them. `scripts/render-static-panes.ts` loops over the catalog's displayable notes and captures each through the harness route, as it captured the hero before. The images are committed (Vercel runs no Playwright). With three notes there are 18 images.

### 7.5 Preparing notes (R15.11)

```ts
interface Prepared { assets: NoteAssets; derived: Derived }
prepare(noteId): Promise<Prepared>      // loadNoteAssets + derive, cached in a Map for the session
```

Order: the pane's current note before `cook:ready`; the other notes in the order of the plan, started from `requestIdleCallback` (or a 0 ms timer where it is missing), and each waits while any pane is in `writing`. `SteamGlass` accepts a `prepared` prop so that it does not decode twice. This is the interim answer until `derive` runs in a worker; when it does, the "not while writing" rule can go.

### 7.6 A note that cannot load (R15.12)

`loadNoteAssets` throws `AssetError`. The pane shows the existing fogged `StaticPane` with `fogOnly`, the stage shows "The scan of this note could not be loaded." and under it the note's `span` with markers in body type as a transcription. The reveal gate drops the effect (the scheduler has recorded the reveal; the product shows the failure, never a silent skip). The Wipe table is unchanged.

## 8. Cue, audio and wake lock (R16, R17)

### 8.1 Envelope (`cue.ts`)

```ts
export const LAMP_DIP_MS = 900          // total, one dip
export const LAMP_MIN = 0.35            // brightness factor at the bottom of the dip (1 = normal)
export const SIMMER_GAIN = 0.12         // level of the simmer
export const SIMMER_DUCK = 0.05         // fraction of SIMMER_GAIN at the bottom of the duck
export const CUE_COOLDOWN_MS = 3000
export function cueEnvelope(tMs: number): { lamp: number; simmer: number }
```

Shape: `lamp` falls from 1 to `LAMP_MIN` over the first 200 ms, holds 100 ms, rises back to 1 over the last 600 ms (smoothstep each way); `simmer` falls to `SIMMER_DUCK` over 300 ms, holds until 600 ms, and rises back to 1 by 2100 ms. Both are exactly 1 for `t ≤ 0` and `t ≥` their end, within `[min, 1]`, with one minimum. The values are starting values chosen by eye and ear, and the tests pin the shape (bounds, single minimum, endpoints), not the numbers. The lamp overlay is a full-screen `--bg` layer with `opacity = 1 − lamp` and `pointer-events: none`, driven by `requestAnimationFrame` for 900 ms. Under reduced motion the same single dip runs (R16.2).

### 8.2 Brown noise

```ts
export function brownNoise(n: number, seed: number): Float32Array
```

Seeded white noise (a small integer PRNG, no `Math.random`), `y[i] = (y[i−1] + 0.02·w[i]) / 1.02`, then the first and last 2048 samples crossfaded (equal power) so that the loop has no click, then scaled to a peak of 0.9. Length `2 × sampleRate`. Deterministic, so the property test can check bounds, the mean, seam continuity and the 1/f² tilt (energy below 200 Hz above energy above 2 kHz). The first draft of this section said the mean is within 0.05 of zero and the seam step no larger than the median step. Both were guesses and both fail: a random walk's mean over 8 192 samples reaches 0.104 (measured over 1 200 seed/size pairs), and one step of a walk exceeds the median step half the time. The checks are now a mean within 0.15 and a seam step within 5 × the RMS step (measured largest: 1.84 ×), which still catch a click or a DC offset.

### 8.3 Engine (`audio.ts`)

```ts
export interface AudioDeps { createContext: () => AudioContext | null }
export function createAudio(deps: AudioDeps, store: Store): {
  unlock(): void                          // first gesture: create + resume the context, start the loop unless muted
  setMuted(m: boolean): void
  duck(): void                            // runs cueEnvelope on the gain
  readonly state: 'locked' | 'playing' | 'muted' | 'unavailable'
  subscribe(cb): () => void
}
```

`App.tsx` installs one-shot `pointerdown`, `keydown` and `touchend` listeners at start; the first one calls `unlock()` and removes all three. Before it, `createContext` is never called (R16.4). The graph is `AudioBufferSourceNode(loop) → BiquadFilter(lowpass) → GainNode → destination`. `duck()` schedules `gain.gain` ramps from the envelope. `visibilitychange` suspends and resumes the context (R16.7). With no `AudioContext`, `state = 'unavailable'` and the Mute control is disabled with its reason (R16.6).

### 8.4 Wake lock (`wakelock.ts`)

```ts
export function createWakeLock(nav: Pick<Navigator, 'wakeLock'> | undefined): { acquire(): Promise<void>; release(): void; readonly status: 'held' | 'refused' | 'unsupported' }
```

`acquire` is called on mount and on `visibilitychange` to visible. It does nothing without `wakeLock`. A rejection sets `status = 'refused'` and is not retried until the next visibility change. The status goes to `data-wake` only.

## 9. Persistence in practice (R18)

- Save points: after every dispatch that changed `paceHistory`, `stepIndex` or `revealed`, and on `visibilitychange` hidden and `pagehide`. Writes are not awaited by the UI; a failed write flips `store.persistent` to false and shows the muted line of R18.8 once.
- Timing overrides are read once when the session starts (`getTiming`), and by the edition view. The stepper writes immediately.
- `introSeen` is set when a shelf button or card link is used. `muted` is set by the Mute control.
- "Start again" and the shelf buttons call `deleteSession(id)` and then navigate, in that order, awaiting the delete so the new route cannot restore the old session.

## 10. Screens

### 10.1 Shelf

```
<main>
  <h1>Recipes in a hand</h1>
  <p class="intro">Every note you'll see is the writer's own hand, photographed. Nothing is generated.</p>
  <ul>
    <li class="card">
      <div class="mat"><img src="/recipes/<id>/page.jpg" loading="lazy" width=1601 height=2052 alt="The manuscript page, MS.1810 p.23"></div>
      <h2><a href="#/r/<id>">To make Marmalade of Quinces</a></h2>
      <ArchiveSlip/>
      <button>Cook it</button> <button>Watch it at ×12</button>
    </li>
  </ul>
</main>
```

The thumbnail is the bundle's `page.jpg` (572 KB, cached for the edition view). A smaller derivative would need another ingest output and a second hash; it is deferred. On a 390×844 viewport the first card shows its title, slip and both buttons above the fold, so the thumbnail is height-capped (about 40 dvh) with `object-fit: contain`.

### 10.2 Edition view

Two columns at 1025 px and wider (`grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)`), stacked below, the scan 40 vh.

- `Facsimile`: viewport `div` (`role="img"` with the alternative text, focusable), an inner transform layer holding the `<img>`, three buttons. The pure reducer `zoomPan(state, action)`:

  ```ts
  interface ZoomState { scale: number; x: number; y: number }          // x, y = translation of the image in viewport px
  type ZoomAction = { type: 'zoomAt'; factor: number; cx: number; cy: number } | { type: 'pan'; dx: number; dy: number }
                  | { type: 'reset' } | { type: 'resize'; w: number; h: number }
  ```

  Invariants (K4): `1 ≤ scale ≤ MAX_ZOOM`; with the image fitted to the viewport width at scale 1, the transformed image always covers the viewport (`x ≤ 0`, `x + W·scale ≥ W`, and the same for y when the image is taller than the viewport); `zoomAt` keeps the image point under `(cx, cy)` fixed unless a clamp had to move it; `reset` returns `{1, 0, 0}`.
- `ReadingText`: renders a `Segment[]`; marks become `<span role="group" aria-label aria-describedby="disagree-desc">`. One hidden `<p id="disagree-desc">` holds the description (R6.4).
- Transcription list: `<ol>` is not used (the numbers start at 00); a `div role="list"` of rows with the gutter number, the glyph cell and the text.
- Moment label: a `<button>` inside the judgement row, `aria-expanded` for the stepper. `TimingStepper` holds `Earlier`, value, `Later`, basis, `Reset`; changes go to `store.putTiming` and the live region.
- `ProvenanceDisclosure`: `<button aria-expanded aria-controls>` and a region with the expanded slip (R3.4).

### 10.3 Quoted

One `<article>` per note: `<img alt>` of the note PNG on `--paper` at the width the page gives (max 960 px, never above 2× its pixel size), `ReadingText` of `quoteSegments`, "Step n", the slip, the link, the approximate-region line. After the list: the credit line, "Cook again", the link back.

## 11. Accessibility and responsiveness

- One live region `role="status"` in `App.tsx`, shared by all screens (Cook Mode uses it as R9.4 says). A second `aria-live="polite"` region is not created. Messages are set through one function so that there is a single ordering.
- Focus ring: `:focus-visible { outline: 2px solid var(--ghost); outline-offset: 3px }`. Buttons are `--ink` outlines on `--bg`, `--rule` fill on press (no `--after`).
- Contrast is computed in a test from the CSS token values: `--ink` and `--muted` against `--bg` (≥ 4.5:1), `--after` against `--bg` (≥ 3:1 for the large timer).
- Reduced motion: a `useReducedMotion` hook (the one in `SteamPane`, moved to a shared file) selects `StaticPane`, removes transitions, and keeps the lamp dip.
- Sizes: CSS custom properties per breakpoint (`--step-size: 24px` to 1024 px, `34px` from 1025 px; `--timer-size: 44px | 64px`; `--title-size: 34px | 56px`). Tablet uses the phone arrangement with a larger window and the phone's text size, which is at least the required 24 px.
- No fixed pixel width on a container; `min-width: 0` on grid children; the controls row wraps at 360 px.

## 12. E2E plan (R27)

All specs run against the production build (`npm run build`, `vite preview`) with software GL, as the renderer specs do. Shared helper `e2e/helpers/cook.ts`: `openShelf`, `markTime(name)` (reads `performance.getEntriesByName`), `liveText`, `regionUrlFor(noteId)` (reads `public/recipes/…/recipe.json` and applies the same formula from the test's own copy of the arithmetic, so the page's code is not checking itself), and the axe runner.

| Spec case | R |
|---|---|
| Main flow with the deep link, reveal ≤ 10 s after `cook:ready`, hero verify URL | R27.1, R19, R20, R21 |
| Watch at ×12 through every Wipe row | R27.2, R14, R11 |
| Reduced motion | R27.3, R23.1 |
| Keyboard only | R27.4, R23.2, R14.9 |
| Sleep with `page.clock` | R27.5, R12.7 |
| Restore after reload | R27.6, R18 |
| Phone 390×844 | R27.7, R24 |
| Invalid bundle, withheld note | R27.8, R2, R22 |
| Renderer specs through the harness | R27.9, R15.8 |

The sleep case uses a **cook-set** check time, because no manuscript time exists: the test writes an override into IndexedDB (60 s), starts a session, fast-forwards the browser clock past it, fires `visibilitychange`, and expects exactly one `cook:reveal:*` mark. It tests the mechanism and claims no cooking time.

## 13. Correctness Properties

P7 and P8 are the two named in the product's success metrics (`npm test`). K1 to K9 support them. Each is stated for all inputs of its kind. "Test" names the fast-check file; the property test checks the implementation against an independent statement written in the test, not against a copy of the implementation.

### P7. Each note is revealed exactly once (R12, R13)

*For all* plans (1 to 8 steps, at most one note per step, check times 0 to 3 600 s) *and for all* sessions of up to 200 events from `start | deepLink | restore | tick | sleep | resume | setPace | show | wipe` with arbitrary wall times (non-decreasing runs with occasional decreases) *and* arbitrary paces:

1. **At most once.** No note id appears in two `reveal` effects, over the whole session and across a `restore` (the snapshot's `revealed` counts as already revealed).
2. **Exactly once when visited.** After the flush (`resume` if asleep, then `tick` at a wall time beyond every due time and hold), every note on a step from the initial step to the final step has exactly one `reveal`. Notes on steps before a deep link's initial step have none.
3. **Never early.** A `scheduled` reveal at wall `w` has `elapsedMs(state, w) ≥ checkAtMs` and, for the initial step of a deep link, `w ≥ startWall + leadMs`. A `show` reveal comes from a `show` event on a pending note. A `wipe` reveal comes from a `wipe` event on a pending note and is followed by `advance` or `finish` in the same event.
4. **Never skipped.** Each `advance` and `finish` is preceded, in the same event or earlier, by the reveal of the note of the step it leaves.
5. **Asleep means silent.** No effect is emitted while `asleep`; a reveal due during sleep is emitted by the first awake event at or after the due time.
6. **Order and monotonic timer.** `stepIndex` never decreases and rises by exactly 1 per `advance`; within a step `elapsedMs` never decreases for non-decreasing and decreasing wall inputs alike.
7. **Pace-scaled.** The wall time of a `scheduled` reveal is the least wall time at which a model integral of `pace × dt` over the generated history reaches the check time, within the event's wall step.
8. **Deep link.** With a step-entry note on the initial step, the first awake event at or after `startWall + leadMs` reveals it, and none earlier does.
9. **`show` makes the schedule a no-op.** After `reveal {cause: 'show'}` no `scheduled` reveal of that note follows.
10. **Wipe table.** Each row of §4.4 is a named case: the label and action of `controlFor` for the generated state equal the table, performing the prescribed action on a pending note never advances, and on a revealed note advances exactly one step (or finishes on the last).
11. **Only the first event starts.** `start`, `deepLink` and `restore` after the first event, and any event after `finish`, leave the state equal to the input but for `lastWall`.

Test: `src/cook/scheduler.prop.test.ts`, with the oracle and the generators in the test file. Validates R12.1 to R12.11, R13.1 to R13.11, R14.1, R14.7.

### P8. Every displayed note resolves to its source (R21, R22)

*For all* bundles derived from the real quinces bundle by random edits (licence id, manifest, canvas id, canvas size, frame, `verifyBox`, `provenance` fields, deleted fields):

1. A note is in `displayableNotes(bundle)` if and only if `resolveNote` is ok, which holds if and only if R22.2 holds, evaluated by an independent predicate in the test.
2. For a displayable note, `parseRegionUrl(regionUrl)` returns exactly `{service: imageService, region}`; `region` is four integers, `w, h ≥ 1`, inside the canvas.
3. The region contains the scaled `verifyBox`, and exceeds it by less than 2 canvas px on each edge, except where it is clipped to the canvas.
4. Each region edge is within 1 canvas px of the percentage form of the note's `verifyUrl` times the canvas size, plus the 4-decimal rounding of that percentage (at most 1e-6 × the canvas side; see §2.3).
5. No displayable note has a licence id outside `pdm`, `cc0`, `cc-by`.
6. The sets of note ids offered by the shelf's count, the edition view, the plan, and the quoted list are all equal to the displayable ids.

Test: `src/data/provenance.prop.test.ts`. Validates R21.4 to R21.7, R22.1 to R22.4, R20.5.

### K1. Routes round-trip (R1)

*For all* routes `r` of the five kinds built from valid ids and values, `parseRoute(formatRoute(r))` equals `r` with defaults filled in; *for all* strings `s`, `parseRoute(s)` does not throw and returns a route whose `formatRoute` re-parses to itself; every invalid query value yields the default. Test: `src/app/router.prop.test.ts`. Validates R1.2 to R1.4.

### K2. Reading marks are lossless (R6, R9, R20)

*For all* strings built from words and zero or more `†[a|b]` markers: `joinReading(parseReading(s)) = s`; the number of `mark` segments equals the number of `†[` in `s`; `primaryText` equals the string with each marker replaced by `a`. *For the real bundle*: for every step with no `corrected` line, `primaryText` of the step's joined lines equals `steps[n-1].text`; for every displayable note, `primaryText(quoteSegments(bundle, note))` equals `note.span` up to the trailing `, . ; :` that `span` omits. Test: `src/data/reading.prop.test.ts`. Validates R6.6, R9.2, R20.4.

### K3. The step clock (R10)

*For all* pace histories and non-decreasing wall times, `elapsedMs` equals the independent sum of `pace × dt`; *for all* sequences of wall times including decreases, the sequence of `elapsedMs` outputs from `reduce` is non-decreasing; `formatElapsed` of `n` ms parses back to `floor(n/1000)` seconds and is monotone; `emberActive` is true exactly when a reveal is pending and the wall time left is in `(0, 10 s]`, at every pace. Test: `src/cook/timing.prop.test.ts`. Validates R10.2 to R10.5.

### K4. Zoom and pan (R5)

*For all* sequences of `zoomAt`, `pan`, `resize` and `reset`: `1 ≤ scale ≤ MAX_ZOOM`; the image covers the viewport; `zoomAt` keeps the point under the cursor fixed unless clamped; `reset` is `{1, 0, 0}`; the reducer is deterministic. Test: `src/app/facsimile.prop.test.ts`. Validates R5.3, R5.4.

### K5. Session snapshots (R18)

*For all* running scheduler states, `Snapshot.parse(toSnapshot(state, id))` succeeds and `restore` of it at a wall time ≥ `lastWall` gives a state with the same `stepIndex`, `stepStartWall`, `paceHistory`, `revealed`; elapsed at that wall time is unchanged; no `reveal` is emitted for a note in `revealed`; `snapshotValid` rejects every snapshot in a set of malformed variants (wrong recipe, step out of range, history not starting at `stepStartWall`, unknown note id, repeated id, older than `SESSION_MAX_AGE_MS`). Test: `src/cook/session.prop.test.ts`. Validates R18.2 to R18.7.

### K6. The cue and the noise (R16)

*For all* `t`: `cueEnvelope(t).lamp ∈ [LAMP_MIN, 1]` and `.simmer ∈ [SIMMER_DUCK, 1]`; both are exactly 1 at and before 0 and after their end; each has one minimum (non-increasing then non-decreasing); the gain applied never exceeds `SIMMER_GAIN`. *For all* seeds and lengths ≥ 8192: `brownNoise` is deterministic, within [−1, 1], has a mean within 0.15 of zero, a loop seam step within 5 × the RMS step (§8.2), and more energy below 200 Hz than above 2 kHz. The audio engine never calls its context factory before `unlock()`. Test: `src/cook/cue.prop.test.ts`. Validates R16.1 to R16.4, R16.8.

### K7. The reveal gate (R15.7)

*For all* interleavings of `enqueue`, `setReady` and `setBlocked`: each effect is applied at most once; effects apply in enqueue order; an effect is applied when and only when its note's pane is ready and nothing blocks; after the last `setReady(note)` and `setBlocked(false)` every enqueued effect for a ready note has been applied exactly once. Test: `src/cook/revealGate.prop.test.ts`. Validates R15.7, R12.8 (the UI half of P7).

### K8. Check labels and overrides (R8)

*For all* `checkAt` values and overrides: `effectiveCheckAt` is the override when present else the bundle's; the label names its source (`with its step`, `cited:`, `set by you`); `formatDuration` is monotone in seconds and re-parses; the stepper never leaves `[0, TIMING_MAX_S]`, moves by exactly `TIMING_STEP_S` unless clamped, and `Reset` restores the bundle's value. *For the real bundle*: every note is `step-entry` with 0 s. Test: `src/cook/timing.prop.test.ts` (second block). Validates R8.1 to R8.7.

### K9. The drag recognizer (R14)

*For all* pointer paths: a path whose horizontal travel is shorter than `DRAG_MIN_PX` or than 25% of the pane width, or that takes longer than 2 s, never fires (vertical travel does not count); a path that meets both fires exactly once, at the first sample where it does; a path with one sample (a tap) never fires; two fires within 400 ms are collapsed to one by the debounce. Test: `src/cook/drag.prop.test.ts`. Validates R14.4, R14.6.

## 14. Failure handling

| Failure | Behaviour | R |
|---|---|---|
| Catalog invalid | Shelf error state, no card | R2.1 |
| Bundle fetch or schema fails | Recipe not shown, one `console.warn` | R2.3 |
| Gate hash differs between catalog and bundle | Recipe not shown | R2.3 |
| Note fails P8 | Note withheld; step has no note; edition says so | R2.4, R7.6 |
| Missing `canvas` or `verifyBox` | Schema fails; recipe not shown | R21.7 |
| Note files fail to load | Failed-scan state with typed transcription, reveal dropped | R15.12 |
| WebGL2 missing, context lost, reduced motion | `StaticPane`, same controller | R15, R23.1 |
| IndexedDB unavailable | Memory store, one muted line, no restore | R18.8 |
| Wake lock refused or missing | Silent | R17 |
| `AudioContext` missing | Mute disabled with its reason; lamp dip still runs | R16.6 |
| Unknown `note` in the deep link | Start at step 1 with the caption | R19.5 |
| Wall clock steps back | Clamped, timer holds | R12.5, R10.3 |
| Page asleep through a due time | One reveal on resume | R12.7 |
| Snapshot invalid or stale | Discarded, fresh session | R18.3 |
| Unknown route or recipe | "Not on the shelf" screen | R1.4 |

## 15. Deferred (not in this spec)

- Upload and in-browser ingestion, and the upload card.
- More than one note on a step (needs a queue in the state machine and a larger Wipe table). A bundle with two is not shown (R2.3).
- A step-back control. A revealed note is never re-revealed in a session, so going back would show a pane that cannot reveal again.
- A thumbnail derivative of the page for the shelf.
- "Show this note on the page": a frame on the facsimile at the note's `verifyBox`. The data exists (R21.2); the interaction is left out.
- A shorter static wait under reduced motion, in-place pane swap (`SteamRenderer.setNote`), the fog continuity at the swap, the reveal's thickening: all renderer-spec work.
- Cited check times: no recipe has one. The code path is tested with generated plans and with the device override.
- The deep-link lead-in budget of the 0:18 cold open is measured by `bench/cook.json` and the take sheet, not decided here.

## 16. Decisions made where the request was open

1. **Lead-in counts from session start.** The `deepLink` event is dispatched when the bundle has validated, and the hold of `lead` seconds runs from that wall time. The reveal is applied at the later of hold end and pane readiness. So a default hold ends no later than 10 s after the screen is interactive (R19.3, R19.4), and a given `lead` is a minimum from session start. A reader who wants `lead` counted from `cook:ready` would change one line (the dispatch point) and lose the strict "≤ 10 s" bound.
2. **Wipe during the write-on is ignored, not queued.** It matches `SteamPane` today and avoids a screen change that the cook asked for seconds earlier (R14.2).
3. **No-note steps keep a fogged pane of the next or last note** (R15.5) instead of adding a note-less renderer mode. It rests on R1.1 of `steam-renderer`, which an e2e check re-asserts on a no-note step.
4. **Line numbers are the zero-based indices** of `lines.json` (R6.1), so the numbers match `transcription.md`, the note groups and the verify records.
5. **One note per step** (R2.3).
6. **`review.notes` is not shown** (§0.3). Only `reviewedBy` and `reviewedAt` are, verbatim.
7. **Thumbnails reuse `page.jpg`** (§10.1).
8. **Tablet text size** is the phone's 24 px minimum, with the larger window; the brief gives no tablet figure.
9. **`SESSION_MAX_AGE_MS` is 12 h**, `LEAD_MAX_S` 120, `TIMING_STEP_S` 30, `TIMING_MAX_S` 10 800, `DRAG_MIN_PX` 96. They are UI limits, not cooking times, and each is a named constant with a test.
10. **First-visit line.** Prominent until the visitor leaves the shelf for a recipe, then standing and muted (R4.2).
11. **The in-house router** is about 60 lines of pure code; a router library would bring dependencies for five routes.
12. **jsdom is not added.** Component tests use `happy-dom` per file where a DOM is needed, and `fake-indexeddb` for the store.
