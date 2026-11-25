// GLSL ES 3.00 sources for the two passes. Both passes share one vertex shader.
// No colour literals live here: every colour arrives as a token uniform (R14.9).

import { TOI_SOFT } from './timeline.ts'
import { TRANS_GAMMA, TRANS_HI, TRANS_LO } from './transmission.ts'

/** Full-screen triangle from gl_VertexID. vUv has y = 0 at the top of the pane. */
export const VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

/** Shared noise helpers. Pass 2 re-uses `hash` for grain and beads. */
export const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`

export const FOG_SCALE = 3.2
export const FOG_TOP = 0.58
export const FOG_BOTTOM = 0.92
export const FOG_AMP = 0.38
export const FOG_PRE = 0.82

/**
 * Pass 1: the condensation film at a fraction of the canvas resolution into an RG8 texture.
 * R is the film's density d, G its height h (smooth lumps whose gradient refracts the room behind the glass, design §4).
 * It reads nothing from the note, so the film outside the hull is the same function as the film anywhere (v0 R6.2).
 */
export const FOG_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uTime;
uniform float uThicken;
in vec2 vUv;
out vec2 oFog;
${NOISE_GLSL}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
void main() {
  vec2 q = vUv * vec2(uSize.x / uSize.y, 1.0) * ${FOG_SCALE.toFixed(1)};
  vec2 drift = vec2(0.010, -0.006) * uTime;
  float n = fbm(q + drift + 0.35 * vec2(fbm(q * 0.7 - drift), fbm(q * 0.7 + 5.3)));
  float low = smoothstep(0.0, 1.0, vUv.y);
  float base = mix(${FOG_TOP.toFixed(2)}, ${FOG_BOTTOM.toFixed(2)}, low);
  float d = base + ${FOG_AMP.toFixed(2)} * (n - 0.5);
  d = mix(d * ${FOG_PRE.toFixed(2)}, d, uThicken);
  // Height of the film: two smooth octaves, slower than the density.
  vec2 hq = q * 1.7 + vec2(31.7, 8.3) + drift * 0.5;
  float h = 0.62 * vnoise(hq) + 0.38 * vnoise(hq * 2.1 + 9.1);
  oFog = vec2(clamp(d, 0.0, 1.0), h);
}
`

/** Luminance cap inside strokes, 0..1 (D14). Applied by scaling the colour, so the ember hue survives. */
export const STROKE_LUMA_MAX = 0.92
/** Largest channel inside a stroke, so a clipped red can never turn the ember yellow-white. */
export const STROKE_PEAK_MAX = 0.9

/** Write-on leading edge: feather = TOI_SOFT * FEATHER_K in toi units, about 9 texels along the hero's path (D15). */
export const FEATHER_K = 0.8

/** Film grain amplitude as a fraction of the film colour (D16). */
export const GRAIN_A = 0.07
export const FOG_MAX = 0.94
export const HEAD_R = 11.0
export const HEAD_A = 0.3
export const SWEEP_SOFT = 0.35

/** Room behind the glass (design §4): light of the pot, of the candle, of the floor, and the bokeh. */
export const POT_GAIN = 0.62
export const CANDLE_GAIN = 0.7
export const FLOOR_GAIN = 0.1
export const BOKEH_GAIN = 0.16
export const BOKEH_CELL_CSS = 72.0
/** Light the hand carries at no room light, and how much of the room light it adds on top (the ember inside a stroke). */
export const EMBER_BASE = 0.8
export const EMBER_GAIN = 0.9
/** Darkening of the meniscus band, where the clearing is half done. */
export const EDGE_SHADE = 0.3
/** Refraction offset of the room lookup, css px at the strongest film gradient (design §4: 1 to 3). */
export const REFRACT_MAX_CSS = 3.0
export const REFRACT_GAIN = 90.0

/** Film colour: base and density share, cool backscatter from the moon above, warm scatter from the pot and candle. */
export const FILM_BASE = 0.6
export const FILM_D = 0.36
export const COOL_A = 0.14
export const COOL_P = 1.4
export const WARM_POT = 0.2
export const WARM_CANDLE = 0.3

/** Droplet layers (design §5): cell css px, radius range css px, probability at full film. */
export const DROP_TINY = { cell: 7.0, rLo: 0.8, rHi: 1.3, prob: 0.16 }
export const DROP_MID = { cell: 15.0, rLo: 1.8, rHi: 3.4, prob: 0.13 }
export const DROP_LARGE = { cell: 38.0, rLo: 3.5, rHi: 6.5, prob: 0.07 }
export const RAIL_DROP_BOOST = 3.0

const f = (x: number): string => x.toFixed(3)

/**
 * Pass 2: composite at full canvas resolution.
 * Reads uChan (toi, hull), uInkTex (the continuous scan alpha) and uFog. The scan's RGB is never drawn:
 * the note enters only as ink alpha, time-of-ink and hull (v0 R7.5, R7.7).
 * Canvas pixels are clamped per channel to `uInk` as the last step (R4.1).
 */
export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 oColor;

uniform vec2 uRes;
uniform float uDpr;
uniform float uTime;
uniform float uU;
uniform float uThicken;
uniform float uHead;
uniform float uWipe;
uniform float uRefog;
uniform vec4 uGroupSrc[4];
uniform vec4 uGroupDst[4];
uniform int uGroupCount;
uniform vec2 uNoteSize;
uniform vec2 uHeadPos;
uniform int uHeadGroup;
uniform vec2 uFogTexel;
uniform vec3 uCandle;
uniform float uBloom;
uniform float uDetail;
uniform vec3 uBg;
uniform vec3 uInk;
uniform vec3 uBefore;
uniform vec3 uAfter;
uniform vec3 uRule;
uniform vec3 uGhost;
uniform vec3 uMoon;
uniform vec3 uNight;
uniform vec2 uPot;
uniform sampler2D uInkTex;
uniform sampler2D uChan;
uniform sampler2D uFog;

const float TRANS_LO = ${TRANS_LO.toFixed(3)};
const float TRANS_HI = ${TRANS_HI.toFixed(3)};
const float TRANS_GAMMA = ${TRANS_GAMMA.toFixed(3)};
const float TOI_SOFT = ${TOI_SOFT.toFixed(4)};
const float FEATHER_K = ${FEATHER_K.toFixed(2)};
const float FOG_MAX = ${FOG_MAX.toFixed(2)};
const float STROKE_LUMA_MAX = ${STROKE_LUMA_MAX.toFixed(2)};
const float STROKE_PEAK_MAX = ${STROKE_PEAK_MAX.toFixed(2)};
const float GRAIN_A = ${GRAIN_A.toFixed(2)};
const float HEAD_R = ${HEAD_R.toFixed(1)};
const float HEAD_A = ${HEAD_A.toFixed(2)};
const float SWEEP_SOFT = ${SWEEP_SOFT.toFixed(2)};
const float POT_GAIN = ${f(POT_GAIN)};
const float CANDLE_GAIN = ${f(CANDLE_GAIN)};
const float FLOOR_GAIN = ${f(FLOOR_GAIN)};
const float BOKEH_GAIN = ${f(BOKEH_GAIN)};
const float BOKEH_CELL = ${f(BOKEH_CELL_CSS)};
const float EMBER_BASE = ${f(EMBER_BASE)};
const float EMBER_GAIN = ${f(EMBER_GAIN)};
const float EDGE_SHADE = ${f(EDGE_SHADE)};
const float REFRACT_MAX = ${f(REFRACT_MAX_CSS)};
const float REFRACT_GAIN = ${f(REFRACT_GAIN)};
const float FILM_BASE = ${f(FILM_BASE)};
const float FILM_D = ${f(FILM_D)};
const float COOL_A = ${f(COOL_A)};
const float COOL_P = ${f(COOL_P)};
const float WARM_POT = ${f(WARM_POT)};
const float WARM_CANDLE = ${f(WARM_CANDLE)};
const float RAIL_BOOST = ${f(RAIL_DROP_BOOST)};
${NOISE_GLSL}

// How clear the glass is for a scan alpha: monotone and continuous over the whole range (transmission.ts is the twin).
float trans(float a) {
  float x = clamp((a - TRANS_LO) / (TRANS_HI - TRANS_LO), 0.0, 1.0);
  return pow(x * x * (3.0 - 2.0 * x), TRANS_GAMMA);
}

// Catmull-Rom magnification of the ink alpha in 5 bilinear taps (the 16-texel filter, corner taps dropped).
float inkCubic(vec2 npos) {
  vec2 tex = uNoteSize;
  vec2 c = floor(npos - 0.5) + 0.5;
  vec2 f = npos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 p0 = (c - 1.0) / tex;
  vec2 p3 = (c + 2.0) / tex;
  vec2 p12 = (c + w2 / w12) / tex;
  float s = textureLod(uInkTex, vec2(p12.x, p0.y), 0.0).r * (w12.x * w0.y)
          + textureLod(uInkTex, vec2(p0.x, p12.y), 0.0).r * (w0.x * w12.y)
          + textureLod(uInkTex, p12, 0.0).r * (w12.x * w12.y)
          + textureLod(uInkTex, vec2(p3.x, p12.y), 0.0).r * (w3.x * w12.y)
          + textureLod(uInkTex, vec2(p12.x, p3.y), 0.0).r * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return clamp(s / wsum, 0.0, 1.0);
}

// Samples the channel at a screen px position. Where group rects overlap (the stacked layout),
// the sample with the larger alpha wins, so one group never masks the other's ink (D9).
// Returns (alpha, toi, pressure, hull feather); grp is the winning group or -1.
vec4 sampleChan(vec2 fp, out int grp, out vec2 npos) {
  vec4 best = vec4(0.0);
  grp = -1;
  npos = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= uGroupCount) break;
    vec4 dst = uGroupDst[i];
    if (fp.x >= dst.x && fp.y >= dst.y && fp.x < dst.z && fp.y < dst.w) {
      vec2 f = (fp - dst.xy) / (dst.zw - dst.xy);
      vec2 np = mix(uGroupSrc[i].xy, uGroupSrc[i].zw, f);
      vec4 v = texture(uChan, np / uNoteSize);
      if (grp < 0 || v.r > best.r) {
        float hull = max(best.a, v.a);
        best = v;
        best.a = hull;
        grp = i;
        npos = np;
      } else {
        best.a = max(best.a, v.a);
      }
    }
  }
  return best;
}

// ---- The room behind the glass -------------------------------------------------------------------------------------
float flicker() {
  return 0.94 + 0.06 * sin(uTime * 5.1) * sin(uTime * 3.3 + 1.7);
}

float potAt(vec2 uv, float k) {
  float aspect = uRes.x / uRes.y;
  vec2 d = (uv - uPot) * vec2(aspect, 1.0);
  return exp(-dot(d, d) * k);
}

float candleAt(vec2 uv, float k) {
  float aspect = uRes.x / uRes.y;
  vec2 d = (uv - uCandle.xy) * vec2(aspect, 1.0);
  return exp(-dot(d, d) * k) * uCandle.z;
}

// Out-of-focus discs of the kitchen: only ever seen through clear glass and inside droplets.
float bokeh(vec2 cssPos, vec2 uv) {
  float cell = BOKEH_CELL;
  vec2 g = cssPos / cell;
  vec2 base = floor(g - 0.5);
  float low = smoothstep(0.3, 1.0, uv.y);
  float s = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = base + vec2(float(i), float(j));
      float h = hash(id + 3.7);
      if (h < 0.45) continue;
      vec2 c = (id + 0.5 + (vec2(hash(id + 11.1), hash(id + 23.9)) - 0.5) * 0.4) * cell;
      float r = cell * (0.16 + 0.14 * hash(id + 5.5));
      float d = length(cssPos - c);
      s += (1.0 - smoothstep(r * 0.72, r, d)) * (0.4 + 0.6 * hash(id + 31.0));
    }
  }
  return s * low;
}

// Room light at a pane uv (y down) and css position, without the bokeh.
float roomBase(vec2 uv) {
  float pot = potAt(uv, 3.0) * flicker();
  float cand = candleAt(uv, 16.0);
  float floorG = exp(-pow(uv.y - 1.0, 2.0) * 9.0);
  return POT_GAIN * pot + CANDLE_GAIN * cand + FLOOR_GAIN * floorG;
}

float roomLight(vec2 uv, vec2 cssPos) {
  float aspect = uRes.x / uRes.y;
  float near = 0.3 + 0.7 * potAt(uv, 2.0) + candleAt(uv, 6.0);
  return roomBase(uv) + BOKEH_GAIN * bokeh(cssPos, uv) * near;
}

// ---- Droplets as lenses ---------------------------------------------------------------------------------------------
// q is the offset from the droplet centre in radius units (y down).
vec3 lensColour(vec2 q, float Lb, float r2, vec3 filmC) {
  float inv = 0.5 - 0.5 * q.y; // a droplet inverts the scene: the warm light from below shows high in it
  vec3 c = filmC * 0.82 + uAfter * Lb * (0.25 + 0.9 * inv);
  vec2 a = q - vec2(-0.38, -0.42);
  vec2 b = q - vec2(0.36, 0.4);
  c += uMoon * 0.5 * exp(-dot(a, a) * 26.0);
  c += uAfter * 0.1 * exp(-dot(b, b) * 16.0);
  return mix(c, filmC * 0.45, smoothstep(0.6, 0.97, r2) * 0.75);
}

// One layer of jittered droplets: each cell holds at most one, radius at most 0.3 cell, so the 2x2 cells nearest the
// pixel hold every droplet that can cover it. Returns (colour, coverage).
vec4 dropLayer(vec2 p, float cellCss, float rLoCss, float rHiCss, float prob, float seed, float Lb, vec3 filmC) {
  float cell = cellCss * uDpr;
  vec2 g = p / cell;
  vec2 base = floor(g - 0.5);
  float bestN = 2.0;
  vec2 bestQ = vec2(0.0);
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = base + vec2(float(i), float(j));
      if (hash(id + seed) >= prob) continue;
      vec2 c = (id + 0.5 + (vec2(hash(id + seed + 17.3), hash(id + seed + 41.9)) - 0.5) * 0.36) * cell;
      float r = mix(rLoCss, rHiCss, hash(id + seed + 7.7)) * uDpr;
      vec2 dv = p - c;
      float nd = length(dv) / r;
      if (nd < bestN) {
        bestN = nd;
        bestQ = dv / r;
      }
    }
  }
  if (bestN >= 1.0) return vec4(0.0);
  float mask = 1.0 - smoothstep(0.82, 1.0, bestN);
  return vec4(lensColour(bestQ, Lb, bestN * bestN, filmC), mask * 0.92);
}

float vnoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2(i, 7.7)), hash(vec2(i + 1.0, 7.7)), u);
}

void main() {
  vec2 fragPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 css = fragPx / uDpr;
  vec2 cssSize = uRes / uDpr;
  float px = uDpr;

  // The film: density d, height h, and the height's gradient in screen px (y down). Pass 1 stored uv.y flipped.
  vec2 fuv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 fg = texture(uFog, fuv).rg;
  vec2 fgx = texture(uFog, fuv + vec2(uFogTexel.x, 0.0)).rg;
  vec2 fgy = texture(uFog, fuv - vec2(0.0, uFogTexel.y)).rg;
  float fogD = fg.x + (hash(fragPx + uTime) - 0.5) * 0.02;
  vec2 gradH = vec2(fgx.y - fg.y, fgy.y - fg.y);
  vec2 refr = gradH * REFRACT_GAIN;
  float rl = length(refr);
  refr *= min(1.0, REFRACT_MAX / max(rl, 1e-4));

  int gi;
  vec2 npos;
  vec4 ch = sampleChan(fragPx, gi, npos); // r alpha+shoulder, g toi, b pressure, a hull feather
  float hullF = ch.a;

  // 1. The hand. uU is -1 before writing, so wiped is 0 everywhere and nothing of the note exists.
  float wiped = clamp((uU - ch.g) / (TOI_SOFT * FEATHER_K), 0.0, 1.0);
  float wf = wiped * wiped * (3.0 - 2.0 * wiped);
  float aInk = gi >= 0 ? inkCubic(npos) : 0.0;
  // The glass is as clear as the scan is dark: a smooth monotone map, never a band (design §3).
  float T = trans(aInk) * wf;

  // 2. Cook's wipe: a soft front sweeps left to right. The hull stays clear, the rest re-fogs.
  float front = uWipe * (1.0 + SWEEP_SOFT) - vUv.x;
  float sweepC = clamp(front / SWEEP_SOFT, 0.0, 1.0) * step(0.0001, uWipe);
  float stay = max(1.0 - uRefog, hullF);
  float swept = sweepC * stay;

  // 3. Cold bloom of the haunting cue: the film densifies from the pane edges inward, the front wobbled by the film height.
  float edgeD = min(min(css.x, cssSize.x - css.x), css.y);
  float reach = 0.3 * min(cssSize.x, cssSize.y) * uBloom;
  float bloomM = uBloom * (1.0 - smoothstep(0.0, max(reach, 1.0), edgeD + (fg.y - 0.5) * 80.0));

  // 4. What the glass hides and what it shows.
  float opacity = clamp(fogD, 0.0, 1.0) * FOG_MAX;
  opacity = mix(opacity, 1.0, bloomM * 0.35);
  opacity *= (1.0 - 0.96 * T) * (1.0 - swept);

  float Lr = roomLight(vUv + refr / uRes, css + refr / px);
  vec3 seen = uBg + uAfter * Lr;
  // The hand: a clear stroke glows with the ember of the room behind it. Thin film (partly clear) glows less.
  float glow = pow(T, 0.7);
  float emberX = EMBER_BASE + EMBER_GAIN * Lr;
  float ember = 1.15 * (1.0 - exp(-1.3 * emberX)); // soft shoulder: near the pot the light saturates, it does not wash to white
  seen = mix(seen, uBg + uAfter * ember, glow);
  // The meniscus band, where the clearing is half done, is a little darker.
  seen *= 1.0 - EDGE_SHADE * 4.0 * T * (1.0 - T);

  // 5. The film, lit from inside the scene: cool from the moon above, warm from the pot and candle below.
  float potF = potAt(vUv, 2.2);
  float candF = candleAt(vUv, 9.0);
  vec3 film = uBefore * (FILM_BASE + FILM_D * fogD);
  film += uMoon * COOL_A * pow(1.0 - vUv.y, COOL_P);
  film += uAfter * (WARM_POT * potF * flicker() + WARM_CANDLE * candF) * (0.4 + 0.6 * fogD);
  float grain = hash(floor(fragPx / max(1.0, 0.8 * px)) + 91.7) - 0.5;
  film *= 1.0 + GRAIN_A * grain;
  film = mix(film, uGhost * 0.8, bloomM * 0.4);
  float edgeShade = 1.0 - smoothstep(0.0, 0.08 * min(uRes.x, uRes.y), min(min(fragPx.x, uRes.x - fragPx.x), fragPx.y));
  film = mix(film, film * vec3(0.94, 1.06, 1.0), edgeShade);

  vec3 col = mix(seen, film, clamp(opacity, 0.0, 1.0));

  // 6. Droplets on the glass, three scales, density following the film, none in cleared glass.
  if (uDetail > 0.5) {
    float Lb = roomBase(vUv);
    float keep = (1.0 - smoothstep(0.0, 0.35, T)) * (1.0 - swept);
    float dens = smoothstep(0.3, 0.9, fogD) * keep;
    float rail = 1.0 + (RAIL_BOOST - 1.0) * smoothstep(0.88, 0.98, vUv.y);
    vec4 dTiny = dropLayer(fragPx, ${f(DROP_TINY.cell)}, ${f(DROP_TINY.rLo)}, ${f(DROP_TINY.rHi)}, ${f(DROP_TINY.prob)} * dens, 5.3, Lb, film);
    vec4 dMid = dropLayer(fragPx, ${f(DROP_MID.cell)}, ${f(DROP_MID.rLo)}, ${f(DROP_MID.rHi)}, ${f(DROP_MID.prob)} * dens, 61.1, Lb, film);
    vec4 dLarge = dropLayer(fragPx, ${f(DROP_LARGE.cell)}, ${f(DROP_LARGE.rLo)}, ${f(DROP_LARGE.rHi)}, ${f(DROP_LARGE.prob)} * dens * rail, 23.9, Lb, film);
    col = mix(col, dTiny.rgb, dTiny.a);
    col = mix(col, dMid.rgb, dMid.a);
    col = mix(col, dLarge.rgb, dLarge.a);
  }

  // 7. Writing head: cold white at the toi frontier, capped. Never amber.
  if (uHead > 0.0 && gi >= 0) {
    vec4 hd = uGroupDst[uHeadGroup];
    if (fragPx.x >= hd.x && fragPx.y >= hd.y && fragPx.x < hd.z && fragPx.y < hd.w) {
      vec2 hp = mix(uGroupSrc[uHeadGroup].xy, uGroupSrc[uHeadGroup].zw, (fragPx - hd.xy) / (hd.zw - hd.xy));
      vec2 dv = hp - uHeadPos;
      float hg = exp(-dot(dv, dv) / (HEAD_R * HEAD_R));
      col = mix(col, mix(uGhost, uMoon, 0.5), hg * HEAD_A * uHead);
    }
  }

  // D14: inside strokes the colour is scaled (not each channel) so luminance stays at or under the cap and the --after hue survives.
  float strokeM = smoothstep(0.0, 0.5, T);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float peak = max(col.r, max(col.g, col.b));
  col *= mix(1.0, min(1.0, min(STROKE_LUMA_MAX / max(lum, 1e-4), STROKE_PEAK_MAX / max(peak, 1e-4))), strokeM);

  col = min(col, uInk);
  oColor = vec4(col, 1.0);
}
`
