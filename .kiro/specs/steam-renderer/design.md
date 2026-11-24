# Design: steam-renderer

Status: design-first spec, step 1 of 3 (design, then requirements, then tasks).
Scope: the signature reveal only. A sash-window pane above a lit pot. The writer's scanned handwriting is wiped out of condensation along a traced left-to-right path. No shelf, no Cook Mode, no audio.

## 0. Inputs, constraints, and what this spec does not claim

Inputs (already in the repo, produced by the P1a ingestion spike):

| File | Format | Meaning |
|---|---|---|
| `public/hero/note-looks-red-smooth.png` | RGBA 1251×177 | RGB = scan pixels. A = ink alpha inside the code-built ownership mask. 32 px transparent margin on every side. |
| `public/hero/note-looks-red-smooth.toi.png` | RGB 1251×177 | R = ink alpha. G = reveal time 0..255, normalised 0..1 over the whole note (left to right per line, line 1 then line 2). B = pressure (local ink density). |
| `public/hero/note-looks-red-smooth.json` | JSON | `noteId, text, source, size, pageBox, groups[{line, rect, coreBand, t, inkPx}]`. It also carries spike-only keys (`provisional`, `p3`, `splitDetail`, …). |

Group data used by the renderer:
- Group A, "till it Looks": rect (781,32)-(1219,93), coreBand y 46..81, t in [0, 0.485].
- Group B, "red & smooth,": rect (31,85)-(496,145), coreBand y 109..143, t in [0.485, 1].
- The rects overlap in y (85..93) but not in x, so the two groups never overlap on screen in any layout.

Constraints taken from the steering (`product.md`, `tech.md`, `structure.md`, `honesty.md`):
- Show the writer's hand only as scan pixels. No handwriting font, no vector tracing, no figure or hand drawn.
- The write-on is "a traced left-to-right path computed from the ink". The UI never calls it the writer's pen order.
- Static site. No runtime model, no server.
- Colours only from the design tokens. The shader receives them as uniforms read once from CSS custom properties.
- Fonts: DM Mono for the fps overlay only. Body font for the button and caption.
- Every surface that shows the scan credits "Wellcome Collection, Public Domain Mark".
- Any number shown to a user or judge comes from a measured file. The fps overlay is a live measurement, not a claim.

Honest limits (recorded here so the build does not overclaim):
- The note JSON says `p3: "fail"` and `provisional`. The renderer is a demonstration of the reveal. It does not show the note as a gate-passing recipe. The pane carries no "verified" wording.
- The full provenance block (shelfmark, page, date, licence, IIIF "verify at source" link) belongs to the later edition view. This spec shows only the one-line credit required by `honesty.md`. See section 11.

## 1. Module layout

```
src/steam/
  timeline.ts     pure. clock -> RevealState
  layout.ts       pure. pane size + meta -> placements
  derive.ts       pure. CPU one-time derivation: channel texture + head path
  assets.ts       load PNGs + JSON, zod-validate meta
  shaders.ts      GLSL ES 3.00 sources (strings)
  renderer.ts     WebGL2 class
  SteamPane.tsx   React: sash frame, upper sash, canvas, button, live region, credit
  StaticPane.tsx  fallback
  params.ts       pure. parse ?t ?lead ?fps
  tokens.ts       read CSS custom properties -> linear-free sRGB floats
src/App.tsx       renders <SteamPane/> full screen
```

`derive.ts`, `params.ts`, and `tokens.ts` are additions to the layout the brief listed. `derive.ts` keeps the per-pixel work that would otherwise cost extra texture reads out of the shader. The files share no state.

## 2. Timing constants and timeline

All times are milliseconds. The reveal clock `t` is time after reveal start. Negative means before.

```ts
export const LEAD_MS      = 2500;   // default lead-in from first presented frame to reveal start
export const THICKEN_MS   = 1200;   // fog thickens during [-THICKEN_MS, 0). Must be <= LEAD_MS.
export const WRITE_ON_MS  = 5000;   // exact write-on duration. Hard limit 6000.
export const WIPE_MS      = 1400;   // cook's wipe sweeps the whole pane clear
export const REFOG_MS     = 20000;  // after the wipe, fog returns outside the feathered hull
export const HEAD_FADE_MS = 250;    // writing head fade-in at t=0 and fade-out at t=WRITE_ON_MS
export const TOI_SOFT     = 0.012;  // softness of the wipe front in toi units (about 60 ms)
```

A compile-time assertion (type-level or a test) enforces `WRITE_ON_MS <= 6000` and `THICKEN_MS <= LEAD_MS`.

### 2.1 Types

```ts
export type Phase = 'fogged' | 'thickening' | 'writing' | 'holding' | 'wiped';

export interface RevealState {
  phase: Phase;
  u: number;          // reveal clock in toi units. -1 before writing. 0..1 while writing. 1 after.
  thicken: number;    // 0..1 extra condensation before the reveal. 1 from t >= 0.
  head: number;       // 0..1 writing-head intensity
  wipe: number;       // 0..1 sweep progress, 0 until the wipe
  refog: number;      // 0..1 fog return outside the hull, 0 until the wipe sweep ends
}

export function revealState(tMs: number, wipeAtMs: number | null): RevealState;
```

### 2.2 Boundaries (t in ms after reveal start; W = WRITE_ON_MS)

| Interval | phase | u | thicken | head |
|---|---|---|---|---|
| t < -THICKEN_MS | fogged | -1 | 0 | 0 |
| -THICKEN_MS ≤ t < 0 | thickening | -1 | smoothstep((t+THICKEN_MS)/THICKEN_MS) | 0 |
| 0 ≤ t < W | writing | t / W | 1 | ramp in over HEAD_FADE_MS, ramp out over the last HEAD_FADE_MS |
| t ≥ W and (wipeAt null or t < wipeAt) | holding | 1 | 1 | 0 |
| wipeAt ≠ null and t ≥ wipeAt | wiped | 1 | 1 | 0 |

- `u` is linear in `t`, so the write-on lasts exactly `WRITE_ON_MS` and the toi map is the only thing that shapes the path.
- `wipeAt` is accepted only if `wipeAt >= WRITE_ON_MS`. Otherwise it is treated as `WRITE_ON_MS`. A wipe never cuts the write-on short.
- `wipe = clamp((t - wipeAt)/WIPE_MS, 0, 1)`. `refog = easeOut(clamp((t - wipeAt - WIPE_MS)/REFOG_MS, 0, 1))`.
- `u` is monotone non-decreasing in `t`. `phase` order is monotone for a fixed `wipeAt`. Holding never lowers `u` and never raises fog over the note.
- NaN or non-finite `t` is treated as `-Infinity` (state `fogged`).

### 2.3 Clock source (renderer side, not in `timeline.ts`)

- `t0` = `performance.now()` at the first presented frame after all assets are uploaded.
- Reveal start = `t0 + lead`, where `lead = ?lead` if given, else `LEAD_MS`.
- Live clock: `t = performance.now() - revealStart`. This is absolute time, so a sleeping tab or a long frame cannot stretch the reveal.
- `?t=<ms>` freezes `t` at that value. The fog drift time also freezes at `t`, so a frame is reproducible. Frozen mode renders a continuous loop of identical frames (or one frame, see 9).
- The "Show the note" press sets `revealStart = now` (skips the rest of the lead-in). A replay after a wipe resets `wipeAt = null` and sets `revealStart = now + THICKEN_MS`, so the fog thickens first.

## 3. Layout (`layout.ts`, pure)

```ts
export type LayoutKind = 'page' | 'groups';

export interface GroupPlacement {
  index: number;
  src: [number, number, number, number];   // source rect in note px: group rect inflated by MARGIN_PX, clamped to size
  dst: [number, number, number, number];   // destination rect in CSS px inside the lower pane
  scale: number;                           // CSS px per note px, per group
  coreBandCssPx: number;                   // (coreBand[1]-coreBand[0]) * scale
}

export interface Layout {
  kind: LayoutKind;
  groups: GroupPlacement[];                // ordered by t[0]
  fits: boolean;                           // every group's inked rect plus PAD_PX lies inside the pane
}

export const MARGIN_PX       = 32;   // transparent margin in the input PNGs
export const PAD_PX          = 16;   // minimum CSS px between inked rect and pane edge
export const MIN_CORE_CSS_PX = 16;
export const PHONE_MAX_W     = 640;  // pane width at or below this uses 'groups'
export const GROUP_GAP_CSS   = 28;   // vertical gap between stacked groups

export function chooseLayout(paneW: number): LayoutKind;
export function computeLayout(kind: LayoutKind, paneW: number, paneH: number, meta: NoteMeta): Layout;
```

**page** (desktop): one uniform scale `s = min((paneW - 2*PAD_PX) / noteW, (paneH * 0.5) / noteH, S_MAX)` with `S_MAX = 1.25`. The note keeps its original geometry, centred in the pane, so the two groups sit where they sat on the page.

**groups** (phone): the groups are stacked in `t` order, centred horizontally and vertically as a block. Each group gets its own scale: `s_i = min((paneW - 2*PAD_PX) / rectW_i, S_MAX)`. If `coreBand_i * s_i < MIN_CORE_CSS_PX`, set `s_i = MIN_CORE_CSS_PX / coreBand_i` and `fits = false`. For the supplied data at 390 px: s_A = 342/438 = 0.78 (core band 27 px), s_B = 342/465 = 0.735 (core band 25 px). At 360 px: 0.71 and 0.67 (about 25 and 23 px). Both are at least 16 and both fit.

All output is a pure function of its inputs. The renderer re-runs it on resize and on layout-kind change. A `dst` rect is the group's inflated `src` rect scaled by `s_i`, so the 32 px margin scales with it.

## 4. Assets (`assets.ts`)

```ts
export interface NoteAssets {
  meta: NoteMeta;
  note: ImageBitmap;      // RGBA, premultiplyAlpha:'none', colorSpaceConversion:'none'
  toi: ImageData;         // RGB. Raw bytes are needed on the CPU for derive.ts
  noteData: ImageData;    // RGBA bytes of the note, needed for derive.ts luma
}
export async function loadNoteAssets(baseUrl: string, signal?: AbortSignal): Promise<NoteAssets>;
```

zod schema (strip unknown keys, so spike-only keys do not fail validation):

```ts
const Rect = z.tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int()])
  .refine(r => r[2] > r[0] && r[3] > r[1]);
export const NoteMeta = z.object({
  noteId: z.string().min(1),
  text: z.string().min(1),
  source: z.string().min(1),
  size: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  pageBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  groups: z.array(z.object({
    line: z.number().int(),
    rect: Rect,
    coreBand: z.tuple([z.number().int(), z.number().int()]).refine(b => b[1] > b[0]),
    t: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).refine(t => t[1] > t[0]),
    inkPx: z.number().int().nonnegative(),
  })).min(1),
}).superRefine(/* every rect inside size; coreBand inside rect y-range; groups' t ranges sorted and non-overlapping */);
```

Cross-checks after decode: both PNGs are exactly `meta.size`. Any failure throws `AssetError` with the failing field. The UI then shows nothing but the fogged pane and the caption "The note could not be loaded." No partial reveal.

## 5. Derived data (`derive.ts`, pure, runs once at load)

Input: `toi` bytes, `noteData` bytes, `size`. Output, all preallocated typed arrays:

```ts
export interface Derived {
  chan: Uint8Array;        // RGBA, size w*h*4
  head: Float32Array;      // HEAD_BINS * 2: smoothed frontier centroid (x,y) in note px, per toi bin
  headBins: number;        // 256
}
```

`chan` channels:
- R = channel alpha: ink alpha (from toi.R, which equals the note's A inside the mask) dilated by `DILATE_PX = 2` with a disc, then blurred by a separable box blur of radius `SOFT_PX = 2`. This is what makes the stroke read as a finger-wiped channel and not a sharp glyph. Peak is clamped to 1.
- G = toi propagated into dilated pixels: each dilated pixel takes the toi of the nearest ink pixel inside the radius (ties to the lower toi). One read in the shader then gives a consistent time for the whole channel width.
- B = pressure (toi.B), propagated the same way, then blended 88/12 with the scan's darkness (1 - luma of `noteData`) so pen pressure variation survives. No scan colour is carried, only this scalar.
- A = hull feather. Hull = ink alpha dilated by `HULL_DILATE_PX = 6`. Feather = `1 - smoothstep(0, HULL_FEATHER_PX, d)` where `d` is the distance outside the dilated hull and `HULL_FEATHER_PX = 24`. Total reach past the ink is 30 px, which fits inside the 32 px margin. A feather at least 24 px past the dilated hull is required, so the margin is the binding limit. Distance is computed with a two-pass chamfer transform (3-4 weights) on a `Float32Array` allocated once.

`head`: for each of 256 toi bins, the ink-alpha-weighted centroid of pixels with that bin, then smoothed with a 7-bin moving average. Empty bins copy the previous bin. At runtime the renderer does an array lookup by `u`, with no allocation.

Distances, radii, and feather are in note pixels and scale with the layout. In phone layout a feather of 24 note px is about 17 CSS px at scale 0.7. Requirement R6 states the feather in note px.

## 6. GPU resources (`renderer.ts`)

```ts
export interface RendererAssets { meta: NoteMeta; note: ImageBitmap; derived: Derived; }
export interface RendererOptions { dprCap: 2; frozenT: number | null; lead: number; showFps: boolean; }

export class SteamRenderer {
  static create(canvas: HTMLCanvasElement, assets: RendererAssets, layout: Layout, opts: RendererOptions): SteamRenderer | null; // null if WebGL2 unavailable
  setClock(tMs: number): void;       // set the reveal clock directly (frozen / test)
  play(): void;                      // start rAF loop from the live clock
  startReveal(): void;               // "Show the note": reveal starts now
  wipe(): void;                      // cook's wipe. Sets wipeAt = current t, accepted only in holding
  resize(cssW: number, cssH: number, layout: Layout): void;
  onContextLost(cb: () => void): void;
  dispose(): void;                   // stop rAF, delete textures, FBO, programs, VAO; remove listeners
}
```

Textures and buffers (all created once at `create`, none per frame):

| Name | Format | Size | Filter | Use |
|---|---|---|---|---|
| `texNote` | RGBA8, not premultiplied | note size | LINEAR, CLAMP | scan luma and alpha |
| `texChan` | RGBA8 | note size | LINEAR, CLAMP | R channel alpha, G toi, B pressure, A hull feather |
| `texFog` | R8 | ceil(W/4) × ceil(H/4) | LINEAR, CLAMP (REPEAT on x) | fog density from pass 1 |
| `fboFog` | framebuffer on `texFog` | | | pass 1 target |
| `vao` | one full-screen triangle | | | both passes |

Only two programs. Pass 1 and pass 2 share the vertex shader. No per-frame JS allocation: uniform values go through preallocated `Float32Array`s and `uniform*v` calls, and the frame callback is a single bound method stored once.

Canvas size: `cssW * min(devicePixelRatio, 2)` by `cssH * min(devicePixelRatio, 2)`, floored. The canvas covers the lower pane only. `ResizeObserver` drives `resize`.

### 6.1 Uniforms

Pass 1: `uSize` (fog px), `uTime` (s), `uThicken`, `uRefog`, `uWipe`.

Pass 2:
- `uRes`, `uDpr`, `uTime`
- `uU` (reveal clock in toi units, -1 before writing), `uThicken`, `uHead`, `uWipe`, `uRefog`
- `uGroupSrc[2]` (vec4, in note px), `uGroupDst[2]` (vec4, in canvas px), `uGroupCount`, `uNoteSize`
- `uHeadPos` (vec2 note px), `uHeadGroup` (int)
- tokens as vec3: `uBg, uInk, uBefore, uAfter, uRule, uGhost, uMoon, uNight`
- `uPot` (vec2, pot centre in pane UV, below the bottom edge)
- sampler units: `uNote`, `uChan`, `uFog`

## 7. Shader pseudocode (GLSL ES 3.00, in `shaders.ts`)

### 7.1 Vertex (shared)

```glsl
#version 300 es
out vec2 vUv;                       // 0..1, y = 0 at the top of the pane
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);   // fullscreen triangle
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
```

### 7.2 Pass 1: fog field (quarter resolution)

```glsl
precision highp float;
uniform vec2  uSize;  uniform float uTime, uThicken;
in vec2 vUv; out float oDensity;

float hash(vec2 p) { /* cheap integer-free hash */ }
float vnoise(vec2 p) { /* value noise, quintic fade */ }
float fbm(vec2 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p*2.03 + 17.1; a *= .5; } return s; }

void main() {
  vec2 q = vUv * vec2(uSize.x / uSize.y, 1.0) * FOG_SCALE;            // FOG_SCALE = 3.2
  vec2 drift = vec2(0.010, -0.006) * uTime;                           // slow drift, units per second
  float n = fbm(q + drift + 0.35 * vec2(fbm(q * 0.7 - drift), fbm(q * 0.7 + 5.3)));   // domain warp
  float low = smoothstep(0.0, 1.0, vUv.y);                            // denser low in the pane
  float base = mix(FOG_TOP, FOG_BOTTOM, low);                         // 0.58 .. 0.92
  float d = base + FOG_AMP * (n - 0.5);                               // FOG_AMP = 0.38
  d = mix(d * FOG_PRE, d, uThicken);                                  // FOG_PRE = 0.82: thinner before thickening
  oDensity = clamp(d, 0.0, 1.0);
}
```

The fog drift uses `uTime`. It never depends on the note, so fog outside the hull is the same function as fog anywhere else (no patch).

### 7.3 Pass 2: composite (full resolution)

```glsl
precision highp float;
in vec2 vUv; out vec4 oColor;
// uniforms listed in 6.1

const float FOG_MAX = 0.94;       // fog never reaches 1.0, the pot's glow always bleeds faintly
const float CH_GAIN = 0.55;       // ember light added inside a clear channel
const float RIM_K   = 7.0;        // edge-gradient gain for the ghost rim
const float HEAD_R  = 11.0;       // writing-head radius, note px
const float HEAD_A  = 0.42;       // writing-head peak alpha. Cold white. Never amber.
const float STREAK_A = 0.55;      // specular streak alpha cap, colour = ink token
const vec3  CLAMP_C = uInk;       // per-channel ceiling for the final colour

vec3 kitchen(vec2 uv) {           // what the fog hides: dark room and the pot's warm light from below
  float d = distance(uv * vec2(uRes.x / uRes.y, 1.0), uPot * vec2(uRes.x / uRes.y, 1.0));
  float pot = exp(-d * d * 3.2);
  float flick = 0.94 + 0.06 * sin(uTime * 5.1) * sin(uTime * 3.3 + 1.7);   // faint, no per-frame alloc
  vec3 c = uBg + uAfter * pot * 0.62 * flick;
  c += uAfter * 0.05 * exp(-pow(uv.y - 1.0, 2.0) * 9.0);                   // rail-adjacent warmth
  return c;
}

// Returns .x = clear amount 0..1 of the channel at this pixel, .y = hull feather, .z = pressure, .w = toi
vec4 sampleNote(vec2 fragPx, out int gi) {
  for (int i = 0; i < 2; i++) {                                            // unrolled, uGroupCount <= 2
    vec4 dst = uGroupDst[i];
    if (all(greaterThanEqual(fragPx, dst.xy)) && all(lessThan(fragPx, dst.zw))) {
      vec2 f = (fragPx - dst.xy) / (dst.zw - dst.xy);
      vec2 nuv = (mix(uGroupSrc[i].xy, uGroupSrc[i].zw, f)) / uNoteSize;   // note px -> 0..1
      gi = i;
      return texture(uChan, nuv);                                          // the single toi read
    }
  }
  gi = -1; return vec4(0.0);
}

void main() {
  vec2 fragPx = gl_FragCoord.xy; fragPx.y = uRes.y - fragPx.y;
  float fogD = texture(uFog, vUv).r;                                       // bilinear from quarter res
  fogD += (hash(fragPx + uTime) - 0.5) * 0.02;                             // grain hides banding

  int gi; vec4 ch = sampleNote(fragPx, gi);          // r alpha, g toi, b pressure, a hull feather
  float hullF = ch.a;

  // 1. Wipe-on. u < 0 before writing, so wiped == 0 everywhere: nothing of the note exists yet.
  float wiped = clamp((uU - ch.g) / TOI_SOFT, 0.0, 1.0);
  float depth = 0.85 + 0.15 * ch.b;                                         // pressure deepens the channel a little
  float clearM = ch.r * wiped * depth;                                      // 0..1 clear amount in the stroke

  // 2. Cook's wipe: a soft front sweeps left to right and clears the whole pane.
  float front = uWipe * (1.0 + SWEEP_SOFT) - vUv.x;                         // SWEEP_SOFT = 0.35
  float sweepC = clamp(front / SWEEP_SOFT, 0.0, 1.0) * step(0.0001, uWipe);
  // Inside the hull the clear is latched. Outside it fades back as uRefog goes 0 -> 1.
  float stay = max(1.0 - uRefog, hullF);
  float fogOpacity = fogD * FOG_MAX * (1.0 - clearM) * (1.0 - sweepC * stay);

  // 3. Beads on the bottom rail, specular streak, edge tint (all in the glass, see 7.4)
  vec3 behind = kitchen(vUv);
  behind += uAfter * CH_GAIN * clearM * (0.55 + 0.45 * potGlow(vUv));       // ember light through the channel

  vec3 fog = uBefore * (0.78 + 0.22 * fogD);
  fog = mix(fog, glassEdgeTint(fog, vUv), edgeMask(vUv));                   // slight green-grey tint at the edges
  vec3 col = mix(behind, fog, fogOpacity);

  // 4. Cold wet rim from the channel's own edge gradient (screen-space derivatives, no extra taps)
  float c = ch.r * wiped;
  float rim = clamp(length(vec2(dFdx(c), dFdy(c))) * RIM_K * uDpr, 0.0, 1.0) * (1.0 - clearM * 0.6);
  col = mix(col, uGhost, rim * 0.85);

  // 5. Writing head: cold-white glow at the toi frontier. Distance in note px. No amber.
  if (uHead > 0.0 && gi == uHeadGroup) {
    vec2 npos = mix(uGroupSrc[gi].xy, uGroupSrc[gi].zw, (fragPx - uGroupDst[gi].xy) / (uGroupDst[gi].zw - uGroupDst[gi].xy));
    float h = exp(-dot(npos - uHeadPos, npos - uHeadPos) / (HEAD_R * HEAD_R));
    col = mix(col, mix(uGhost, uMoon, 0.5), h * HEAD_A * uHead);
  }

  col = addBeadsAndStreak(col, vUv, fogD);                                  // 7.4
  col = min(col, CLAMP_C);                                                  // per-channel ceiling: no pixel exceeds --ink
  oColor = vec4(col, 1.0);
}
```

Notes on the pseudocode:
- `sampleNote` returns zeros outside the group rects. There the shader runs the same fog expression with `clearM = 0`, `hullF = 0`, so outside the groups the fog matches the rest of the pane exactly (R6).
- Before the cook's wipe, `hullF` has no effect on the output (`sweepC = 0`). Nothing reveals the bounding box. The hull only matters after the wipe, where it holds the note clear while fog returns around it.
- The write-on changes only `clearM`, which is shaped by the ink alpha. The scan's RGB is not drawn anywhere on top of the fog. `texNote` is read only for pressure-independent luma used in `depth` if the derive step does not bake it. (Open choice, see section 12. Default: bake it, do not read `texNote` in the shader.)
- The writing head is cold white (`uGhost`/`uMoon` mix). The per-channel clamp at the end keeps a blue-leaning head from exceeding `--ink`, because `--ghost` and `--moon` blue channels are above ink's blue.

### 7.4 Glass details (functions in pass 2)

- `edgeMask(uv)`: `smoothstep` falloff from the pane's left, right, and top edges, about 8% of the shorter side. `glassEdgeTint` nudges the fog colour toward green-grey by scaling `uBefore.g` by 1.06 and `uBefore.r` by 0.94. This derives from `--before`. It adds no new colour token.
- Specular streak: a diagonal soft band across the top third. Intensity `streak = smoothstep(...) * 0.5`. Colour is `uInk`, alpha `min(streak, STREAK_A)`. Blended with `mix(col, uInk, alpha)`.
- Beads on the bottom rail: the bottom 7% of the pane, a cell hash on a grid of about 14 CSS px, jittered. A bead is a small disc where `hash(cell) > 0.62`. It darkens its rim slightly with `uBg`, adds a pinprick highlight at its upper left that is capped at `uGhost * 0.6`, and shows a small lens of `kitchen()` inside. Its density falls with distance from the rail. It uses `fogD` so beads sit in the fog.
- No border is drawn in the shader. The pane edge is only the CSS sash bar.

## 8. React components

### 8.1 `SteamPane.tsx`

Structure (DOM order):

```
<section class="steam-root" aria-label="Steamed window">
  <div class="sash sash--upper">       night sky (--night) + moon, pure CSS
    <div class="moon"/>
  </div>
  <div class="rail rail--meeting"/>    --rule wood
  <div class="sash sash--lower">
    <canvas class="steam-canvas" aria-hidden="true"/>
    <div class="bead-rail"/>           CSS only if StaticPane is active; WebGL draws its own beads
  </div>
  <div class="rail rail--bottom"/>     --rule wood. The beads in the shader sit on this rail's top edge.
  <p class="credit">…</p>
  <button class="wipe-btn">…</button>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true"/>
  <div class="fps" hidden|shown/>
</section>
```

- Sash frame: the frame around the lower pane is four `--rule` bars, drawn as CSS gradients (a faint vertical grain made from `--rule` mixed toward `--bg`, a lighter top lip). No `border: 1px solid` anywhere, and no `box-shadow` outline that reads as a card edge.
- Upper sash: `--night` with a low full moon in `--moon`. Moon peak opacity 0.96 over `--night`, so its luminance stays at or below the `--ink` luminance (see 10.3). The upper sash stays clear and unfogged.
- Layout split: the upper sash gets 36% of `100dvh` on desktop and 24% on phone. The lower pane gets the rest minus the rails.
- Button: `<button>` with `min-width: 48px; min-height: 48px`, in practice 56 px tall and wide text. Label by phase: `Show the note` (fogged or thickening, and after a wipe), `Wipe the glass` (holding). During writing it is `aria-disabled="true"` with the label `Writing…`. The text is the body font. It sits below the sash in the bottom rail zone, never over the note.
- Keyboard: `Space` (and Enter via the native button) triggers the same action. A document-level `keydown` for `Space` is attached only when the focus is not inside another interactive element, and calls `preventDefault` to stop page scroll.
- Live region: text `The writer's note, handwritten: till it Looks red & smooth` is set once when the reveal starts (phase leaves `thickening` for `writing`, or the user presses Show). It is cleared on replay and set again. It is built from `meta.text`, not hard-coded, so the spoken text and the shown text cannot diverge. (The announced words are the transcription from the note JSON, which the spike read and the later gate may correct. The pane does not call it verified.)
- Credit caption: one line in the body font, `--muted`, under the lower pane: "Wellcome Collection, Public Domain Mark". Required by `honesty.md` because the pane shows the scan.
- FPS overlay (`?fps=1`): DM Mono, `--muted` text on `--bg`, top-right of the lower pane. Shows the rolling mean fps, the minimum frame time in ms, and the count of frames over 18.2 ms. The overlay updates by writing `textContent` of one pre-created text node at 4 Hz.

State: `phase` for the button label and live region is derived from `revealState` sampled by the renderer at 10 Hz via a callback. The canvas never causes React re-renders per frame.

### 8.2 `StaticPane.tsx`

Used when `SteamRenderer.create` returns null, when the `webglcontextlost` handler fires and does not recover within 2 s, or when `matchMedia('(prefers-reduced-motion: reduce)')` matches.

- Two pre-rendered images of the same lower pane, produced by the real renderer in a build script (`scripts/render-static-panes.ts`, Playwright, `?t=-1` fogged and `?t=<WRITE_ON_MS + 100>` held): `public/hero/pane-<layout>-fogged.webp` and `-held.webp`, for `page` and `groups` layouts.
- The held image shows the note clear with the ember light, the rim, and the feathered fog, exactly as the held frame of the live renderer. No text-coloured layer is composed by CSS.
- CSS crossfade: `held` image opacity 0 → 1 over 600 ms (`transition: opacity 600ms ease-out`), triggered at the same moment as the live reveal start (LEAD_MS after load, or at the press of the button). There is no spatial motion, so it complies with `prefers-reduced-motion`.
- Same sash frame, upper sash, button, live region, credit, and `?t` / `?lead` handling as the live path. With `?t`, the held image opacity is 1 if `t >= WRITE_ON_MS` or `t` is within the writing phase for reduced-motion (a static reveal "of the same note at the same moment" means the held frame), otherwise 0.
- The button still toggles: Show shows the held image, Wipe the glass fades to a cleared pane image (`pane-<layout>-wiped.webp`), Show again replays.

## 9. URL parameters (`params.ts`)

| Param | Parse | Effect |
|---|---|---|
| `t` | finite number, ms | Freeze the reveal clock at `t` after reveal start. Negative means before. Overrides `lead`. Wipe is unavailable while frozen. |
| `lead` | finite number ≥ 0, ms | Lead-in before auto-start. Default `LEAD_MS`. Ignored when `t` is set. |
| `fps` | `1` | Show the fps overlay. |

Invalid or missing values fall back to defaults. Parameters are read from the hash route's query (`#/?t=…`) and from `location.search`, search first. In frozen mode the renderer draws on a rAF loop (so fps can be measured) with `uTime = t/1000`; the output is identical frame to frame.

## 10. Non-functional budgets

### 10.1 Performance

- At least 55 fps average, zero frames under 55 fps (no frame interval over 18.2 ms at 60 Hz), on desktop and on a Pixel 5 profile with 4× CPU throttling. Measured with Playwright using `?fps=1` and a CDP trace, written to `bench/`. Never assumed.
- Fog pass: quarter resolution, 4 fbm octaves with one domain warp (3 fbm evaluations, 12 noise lookups).
- Composite: one `texture(uChan)`, one `texture(uFog)`, no loops over ink, no branching on noise.
- Canvas pixel count: lower pane only, DPR capped at 2. Pixel 5 portrait lower pane about 390×500 CSS px, so about 0.78 MP at DPR 2.
- Per frame JS: one `performance.now()`, one `revealState`, about 20 `uniform*` calls, two draw calls. No object, array, or closure creation in the frame callback.
- Texture upload only at `create`, `derive` is paid once at load (about 220 k pixels). If derive takes over 50 ms on the throttled phone it runs in a Web Worker (decision in section 12).

### 10.2 Budgets table

| Budget | Value |
|---|---|
| fps average | ≥ 55 |
| frames under 55 fps | 0 |
| fog resolution | 1/4 per axis |
| DPR cap | 2 |
| per-frame allocations | 0 |
| draw calls per frame | 2 |
| texture reads per pixel (pass 2) | 2 (`uChan`, `uFog`) |
| write-on duration | exactly 5000 ms (limit 6000) |
| first presented frame to reveal start | LEAD_MS = 2500 ms by default |
| hull feather | ≥ 24 note px past the dilated hull |
| phone core band | ≥ 16 CSS px |
| button | ≥ 48×48 CSS px |
| specular streak | alpha ≤ 0.55 of `#EFE7DA` |
| any composite pixel | not brighter than `#EFE7DA` |

### 10.3 Brightness definition

"Not brighter than `--ink`" is checked two ways:
1. In the shader, per channel: `min(col, uInk)`, so the canvas cannot exceed `#EFE7DA` in R, G, or B.
2. On captured full-page frames: relative luminance of every pixel is ≤ luminance of `#EFE7DA` (about 231.7 on the 0..255 Rec.709 scale). The CSS moon uses `--moon` at opacity 0.96 over `--night` to stay under that limit. (`--moon` luminance is about 232.1, 0.4 above ink, so the attenuation is needed.)

### 10.4 Failure handling

- WebGL2 missing, shader compile or link failure, or framebuffer incomplete: `create` returns null and `StaticPane` renders. The shader error is logged once to the console.
- `webglcontextlost`: stop rAF, `preventDefault`. On `webglcontextrestored`: rebuild resources and resume at the current `t`. If not restored in 2 s, fall back to `StaticPane`.
- `dispose()` is idempotent and is called on unmount.

## 11. Deferred (explicitly not in this spec)

- The full provenance block (shelfmark, page, date, licence, "verify at source" IIIF region link) and the gate (P1-P6) belong to the edition view. This pane shows only the one-line credit.
- Shelf, Cook Mode, step engine, audio, timers, `checkAt`, the second-reader disagreement display.
- The product rule "where the two readers disagree, show both" does not apply here because this pane shows one note and no reading comparison.

## 12. Open choices, with defaults

| Question | Default |
|---|---|
| Does the shader read `texNote`? | No. Luma is baked into `chan.B` by `derive.ts` (pressure blended with 12% luma). `texNote` stays loaded for the static-pane render script and future use. If a later review finds the channel too flat, one extra read of `texNote.rgb` is allowed within budget. |
| Run `derive` in a Worker? | Only if measured over 50 ms on the Pixel 5 profile. Pure function either way, so the move costs nothing. |
| Crossfade length in StaticPane | 600 ms, opacity only. |
| Pot position | Below the pane, centred, `uPot = (0.5, 1.18)`. Does not move. |
