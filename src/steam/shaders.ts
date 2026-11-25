// GLSL ES 3.00 sources for the two passes. Both passes share one vertex shader.
// No colour literals live here: every colour arrives as a token uniform (R14.9).

import { RUN_RAMP_CSS, RUN_WAVE1_CSS, RUN_WAVE2_CSS } from './drips.ts'
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
/** Old wipes: count, width in pane heights, density they remove (at most 0.12), height they add; broad density variation amplitude. */
export const OLD_WIPES = 3
export const OLD_WIPE_W = 0.014
export const OLD_WIPE_DENSITY = 0.1
export const OLD_WIPE_HEIGHT = 0.1
export const BROAD_AMP = 0.16

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
// Old wipes (look pass 2): where someone swept the glass earlier and it has re-fogged. Static and seeded: three swipes of
// three fingers each, as long arcs of large radius, broken along their length. Returns 0..1, how much thinner the film is there.
float oldWipes(vec2 p) {
  float m = 0.0;
  for (int i = 0; i < ${OLD_WIPES}; i++) {
    float fi = float(i);
    float aspect = uSize.x / uSize.y;
    vec2 c = vec2((0.1 + 0.8 * hash(vec2(fi, 3.1))) * aspect, 0.15 + 0.9 * hash(vec2(fi, 5.7)));
    float R = 0.7 + 0.9 * hash(vec2(fi, 9.3));
    vec2 dv = p - c;
    float a = atan(dv.y, dv.x);
    float th = 6.2832 * hash(vec2(fi, 13.9));
    float da = abs(mod(a - th + 3.1416, 6.2832) - 3.1416);
    float hw = 3.1416 * (0.1 + 0.1 * hash(vec2(fi, 17.3)));
    float win = 1.0 - smoothstep(hw * 0.5, hw, da);
    float brokenAlong = smoothstep(0.2, 0.55, vnoise(vec2(a * 5.0 + fi * 7.0, fi * 3.3)));
    float r = length(dv);
    for (int k = 0; k < 3; k++) {
      float e = (r - R - 0.034 * float(k) - 0.01 * sin(a * 3.0 + fi)) / ${OLD_WIPE_W.toFixed(3)};
      m = max(m, win * brokenAlong * exp(-e * e) * (0.65 + 0.35 * hash(vec2(fi, float(k) + 21.0))));
    }
  }
  return m;
}

void main() {
  vec2 q = vUv * vec2(uSize.x / uSize.y, 1.0) * ${FOG_SCALE.toFixed(1)};
  vec2 drift = vec2(0.010, -0.006) * uTime;
  float n = fbm(q + drift + 0.35 * vec2(fbm(q * 0.7 - drift), fbm(q * 0.7 + 5.3)));
  float low = smoothstep(0.0, 1.0, vUv.y);
  float base = mix(${FOG_TOP.toFixed(2)}, ${FOG_BOTTOM.toFixed(2)}, low);
  float wipes = oldWipes(vUv * vec2(uSize.x / uSize.y, 1.0));
  // Larger-scale density variation: patches the eye reads as years of cooking on the one pane.
  float broad = vnoise(vUv * vec2(uSize.x / uSize.y, 1.0) * 1.15 + 7.7) - 0.5;
  float d = base + ${FOG_AMP.toFixed(2)} * (n - 0.5) + ${BROAD_AMP.toFixed(2)} * broad - ${OLD_WIPE_DENSITY.toFixed(2)} * wipes;
  d = mix(d * ${FOG_PRE.toFixed(2)}, d, uThicken);
  // Height of the film: two smooth octaves, slower than the density.
  vec2 hq = q * 1.7 + vec2(31.7, 8.3) + drift * 0.5;
  float h = 0.62 * vnoise(hq) + 0.38 * vnoise(hq * 2.1 + 9.1);
  h += ${OLD_WIPE_HEIGHT.toFixed(2)} * wipes;
  oFog = vec2(clamp(d, 0.0, 1.0), clamp(h, 0.0, 1.0));
}
`

/** Luminance cap inside strokes, 0..1 (D14). Applied by scaling the colour, so the ember hue survives. */
export const STROKE_LUMA_MAX = 0.92
/** Largest channel inside a stroke, so a clipped red can never turn the ember yellow-white. */
export const STROKE_PEAK_MAX = 0.93

/** Write-on leading edge: feather = TOI_SOFT * FEATHER_K in toi units, about 9 texels along the hero's path (D15). */
export const FEATHER_K = 0.8

/** Film grain amplitude as a fraction of the film colour (D16). */
export const GRAIN_A = 0.07
export const FOG_MAX = 0.94
export const HEAD_R = 11.0
export const HEAD_A = 0.26
/** The head's added luminance never exceeds this: a cold fingertip glow, never a white hotspot (R5.1). */
export const HEAD_MAX_LUMA = 0.28
/** Breath: samples along the head's path, bins between them, falloff per sample, radius css px, density and cooling. */
export const TRAIL_N = 6
export const TRAIL_STEP = 12
export const TRAIL_FALLOFF = 0.78
export const BREATH_R_CSS = 34.0
export const BREATH_DENSITY = 0.22
export const BREATH_COOL = 0.3
export const SWEEP_SOFT = 0.35

/** Room behind the glass (design §4): light of the pot, of the candle, of the floor, and the bokeh. */
export const POT_GAIN = 0.62
export const CANDLE_GAIN = 0.7
export const FLOOR_GAIN = 0.1
export const BOKEH_GAIN = 0.16
export const BOKEH_CELL_CSS = 72.0
/**
 * A cleared stroke is a window (look pass 3, design section 15): it shows the room behind the glass. The room is a dark
 * gradient with the pot's and the candle's glow and out-of-focus discs at two scales; the lookup is bent by the edge normal.
 */
export const WINDOW_REFRACT_CSS = 3.0
export const WINDOW_REFRACT_K = 26.0
export const WINDOW_FLOOR = 0.2
export const WINDOW_GRAD = 0.3
export const WINDOW_BOKEH_COARSE = 1.3
export const WINDOW_BOKEH_FINE = 1.5
export const WINDOW_FINE_CELL_CSS = 22.0
export const WINDOW_SHOULDER = 1.25
/** Meniscus: highlight width (css px, at dpr 1), strength, shade on the far side, and the direction of the lamp and candle (y down). */
export const MENISCUS_PX = 1.0
export const MENISCUS_A = 0.6
export const FAR_SHADE = 0.12
export const LAMP_DIR = [0.28, 0.96] as const
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
/** The sill gathers a few more large droplets, not a row of glowing beads; they are smaller and take less of the room's light. */
export const RAIL_DROP_BOOST = 1.6
export const RAIL_SHRINK = 0.3
export const LENS_WARM = 0.6

/** Wet edge (design §6.1): blur lod of the ink for the lip and the normal, lip density and brightness, cold rim strength, bead size. */
export const INK_LOD_BLUR = 1.0
export const LIP_DENSITY = 0.04
export const LIP_BRIGHT = 0.13
/** Pen pressure (the scan's own ink darkness): below PRESSURE_LO a stroke is a hairline (dim, cool), above PRESSURE_HI it is a full stroke (clear and warm). */
export const PRESSURE_LO = 0.3
export const PRESSURE_HI = 0.95
export const PRESSURE_DIM = 0.85
/** Warm light scattered into the film around written strokes: blur lod, strength. */
export const HALO_LOD = 3.0
export const HALO_GAIN = 0.05
export const BEAD_SPACING_CSS = 9.0
export const BEAD_R_CSS = { lo: 1.2, hi: 2.4 }

/** Running water (design §6.2). */
export const RUN_MAX = 6
export const RUN_REFOG_S = 45.0

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
uniform vec2 uTrail[6];
uniform vec4 uRunA[6];
uniform vec4 uRunB[6];
uniform vec4 uRunC[6];
uniform int uRunCount;
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
const float WINDOW_REFRACT = ${f(WINDOW_REFRACT_CSS)};
const float WINDOW_REFRACT_K = ${f(WINDOW_REFRACT_K)};
const float WINDOW_FLOOR = ${f(WINDOW_FLOOR)};
const float WINDOW_GRAD = ${f(WINDOW_GRAD)};
const float WINDOW_BOKEH_COARSE = ${f(WINDOW_BOKEH_COARSE)};
const float WINDOW_BOKEH_FINE = ${f(WINDOW_BOKEH_FINE)};
const float WINDOW_FINE_CELL = ${f(WINDOW_FINE_CELL_CSS)};
const float WINDOW_SHOULDER = ${f(WINDOW_SHOULDER)};
const float MENISCUS_A = ${f(MENISCUS_A)};
const float FAR_SHADE = ${f(FAR_SHADE)};
const vec2 LAMP_DIR = normalize(vec2(${f(LAMP_DIR[0])}, ${f(LAMP_DIR[1])}));
const float REFRACT_MAX = ${f(REFRACT_MAX_CSS)};
const float REFRACT_GAIN = ${f(REFRACT_GAIN)};
const float FILM_BASE = ${f(FILM_BASE)};
const float FILM_D = ${f(FILM_D)};
const float COOL_A = ${f(COOL_A)};
const float COOL_P = ${f(COOL_P)};
const float WARM_POT = ${f(WARM_POT)};
const float WARM_CANDLE = ${f(WARM_CANDLE)};
const float INK_LOD = ${f(INK_LOD_BLUR)};
const float LIP_DENSITY = ${f(LIP_DENSITY)};
const float LIP_BRIGHT = ${f(LIP_BRIGHT)};
const float PRESSURE_LO = ${f(PRESSURE_LO)};
const float PRESSURE_HI = ${f(PRESSURE_HI)};
const float PRESSURE_DIM = ${f(PRESSURE_DIM)};
const float HALO_LOD = ${f(HALO_LOD)};
const float HALO_GAIN = ${f(HALO_GAIN)};
const float BEAD_SPACING = ${f(BEAD_SPACING_CSS)};
const float BEAD_R_LO = ${f(BEAD_R_CSS.lo)};
const float BEAD_R_HI = ${f(BEAD_R_CSS.hi)};
const float RUN_REFOG_S = ${f(RUN_REFOG_S)};
const float RUN_K1 = ${(2 * Math.PI / RUN_WAVE1_CSS).toFixed(5)};
const float RUN_K2 = ${(2 * Math.PI / RUN_WAVE2_CSS).toFixed(5)};
const float RUN_RAMP = ${f(RUN_RAMP_CSS)};
const vec2 MOON_DIR = vec2(-0.35, -0.94);
const float HEAD_MAX_LUMA = ${f(HEAD_MAX_LUMA)};
const float TRAIL_FALLOFF = ${f(TRAIL_FALLOFF)};
const float BREATH_R = ${f(BREATH_R_CSS)};
const float BREATH_DENSITY = ${f(BREATH_DENSITY)};
const float BREATH_COOL = ${f(BREATH_COOL)};
const float RAIL_BOOST = ${f(RAIL_DROP_BOOST)};
const float RAIL_SHRINK = ${f(RAIL_SHRINK)};
const float LENS_WARM = ${f(LENS_WARM)};
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

float inkBlur(vec2 npos) {
  return textureLod(uInkTex, npos / uNoteSize, INK_LOD).r;
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

// Out-of-focus discs of the kitchen at one scale: soft inside, a little brighter at the rim, like a real defocused lamp.
float discs(vec2 cssPos, float cell, float rLo, float rHi, float occ, float seed) {
  vec2 g = cssPos / cell;
  vec2 base = floor(g - 0.5);
  float s = 0.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = base + vec2(float(i), float(j));
      if (hash(id + seed) >= occ) continue;
      vec2 c = (id + 0.5 + (vec2(hash(id + seed + 11.1), hash(id + seed + 23.9)) - 0.5) * 0.5) * cell;
      float r = mix(rLo, rHi, hash(id + seed + 5.5));
      float d = length(cssPos - c) / r;
      float body = 1.0 - smoothstep(0.7, 1.0, d);
      float rim = smoothstep(0.45, 0.85, d) * body;
      s += body * (0.35 + 0.55 * hash(id + seed + 31.0)) * (0.7 + 0.6 * rim);
    }
  }
  return s;
}

// What a cleared stroke shows: the room behind the glass. Dark at the top, warmer toward the pot, the pot's and the candle's
// glow, and discs of light at two scales so brightness and hue change inside one stroke.
float windowLight(vec2 cssPos, vec2 uv) {
  float grad = WINDOW_FLOOR + WINDOW_GRAD * smoothstep(0.1, 1.1, uv.y);
  float L = grad + roomBase(uv);
  L += WINDOW_BOKEH_COARSE * discs(cssPos, BOKEH_CELL, BOKEH_CELL * 0.14, BOKEH_CELL * 0.3, 0.55, 3.7) * (0.35 + 0.65 * smoothstep(0.0, 0.8, uv.y));
  L += WINDOW_BOKEH_FINE * discs(cssPos, WINDOW_FINE_CELL, WINDOW_FINE_CELL * 0.17, WINDOW_FINE_CELL * 0.4, 0.68, 91.3);
  return L;
}

// ---- Droplets as lenses ---------------------------------------------------------------------------------------------
// q is the offset from the droplet centre in radius units (y down).
vec3 lensColour(vec2 q, float Lb, float r2, vec3 filmC) {
  float inv = 0.5 - 0.5 * q.y; // a droplet inverts the scene: the warm light from below shows high in it
  vec3 c = filmC * 0.82 + uAfter * Lb * LENS_WARM * (0.25 + 0.9 * inv);
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

float vnoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// x offset of a run's channel at dyc css px below its start (twin of runOffset in drips.ts), css px.
float runOff(float dyc, float ampCss, float lean, float seed) {
  float w = 0.62 * sin(dyc * RUN_K1 + seed) + 0.38 * sin(dyc * RUN_K2 + seed * 2.3);
  float ramp = clamp(dyc / RUN_RAMP, 0.0, 1.0);
  return ramp * ramp * (3.0 - 2.0 * ramp) * ampCss * w + lean * dyc;
}

// The head of a run is a bead of water: a lens with a dark rim, the warm light from below shown high in it (inverted), and
// one small catch-light. Water is clear, so its body is the dark room, never a white dot.
vec3 beadColour(vec2 q, float Lb, float r2, vec3 filmC, vec3 dark) {
  float inv = 0.5 - 0.5 * q.y;
  vec3 c = filmC * 0.5 + dark * 0.4 + uAfter * (0.1 + 0.9 * Lb) * (0.15 + 0.85 * inv * inv) * 0.7;
  vec2 a = q - vec2(-0.36, -0.4);
  c += uMoon * 0.3 * exp(-dot(a, a) * 70.0);
  return mix(c, filmC * 0.3, smoothstep(0.55, 0.95, r2) * 0.8);
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
  // Surface tension is irregular: the film height breaks every edge feature (lip, rim) into stretches.
  float brk = smoothstep(0.28, 0.72, mix(vnoise2(css / 4.5 + 13.0), fg.y, 0.3));
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

  // Wet edge: the blurred ink and its gradient give the lip and the outward normal (3 taps). Only near ink.
  float lip = 0.0;
  float lit = 0.5;
  vec2 outN = vec2(0.0, -1.0);
  float edgeB = 0.0;
  float sd = 0.0;
  float scaleDev = 1.0;
  vec2 inkGrad = vec2(0.0);
  if (gi >= 0) {
    edgeB = inkBlur(npos);
    if (edgeB > 0.02) {
      float bx = inkBlur(npos + vec2(1.0, 0.0)) - edgeB;
      float by = inkBlur(npos + vec2(0.0, 1.0)) - edgeB;
      float gl = length(vec2(bx, by));
      inkGrad = vec2(bx, by);
      if (gl > 1e-4) outN = -vec2(bx, by) / gl;
      lit = 0.5 + 0.5 * dot(outN, normalize(MOON_DIR));
      scaleDev = (uGroupDst[gi].z - uGroupDst[gi].x) / (uGroupSrc[gi].z - uGroupSrc[gi].x);
      sd = (0.22 - edgeB) / max(gl, 1e-3) * scaleDev; // device px outside the edge, first order
      float near = smoothstep(0.0, 0.05, ch.r);
      lip = smoothstep(0.03, 0.3, edgeB) * (1.0 - smoothstep(0.08, 0.5, T)) * near * smoothstep(0.0, 0.06, wf) * (0.35 + 0.65 * brk);
    }
  }

  // The hand's warm light scattered into the film around it: one wide blur tap, gated by the neighbourhood's own time-of-ink.
  float halo = 0.0;
  if (gi >= 0) {
    vec2 hb = textureLod(uInkTex, npos / uNoteSize, HALO_LOD).rg;
    float hToi = hb.g / max(hb.r, 1e-3);
    float hw = clamp((uU - hToi) / (TOI_SOFT * FEATHER_K * 6.0), 0.0, 1.0);
    halo = smoothstep(0.015, 0.4, hb.r) * hw * hw * (3.0 - 2.0 * hw);
  }

  // Running water: a thin clear channel behind a bead, from the planned runs (design §6.2). The path bends (runOff), the
  // channel is wider at its lip and narrows, and it re-fogs from its top with the age since the stall.
  float trail = 0.0;
  float ridge = 0.0;
  vec2 headQ = vec2(0.0);
  float headHit = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= uRunCount) break;
    vec4 rA = uRunA[i];
    vec4 rB = uRunB[i];
    vec4 rC = uRunC[i];
    if (rB.w < 0.5) continue;
    float dy = fragPx.y - rA.y;
    float dyc = dy / px;
    float offs = runOff(dyc, rC.x / px, rC.y, rB.z) * px;
    float dx = fragPx.x - rA.x - offs;
    float hdx = fragPx.x - rA.x - runOff((rA.z - rA.y) / px, rC.x / px, rC.y, rB.z) * px;
    float reach = rB.x + 5.0 * rA.w + 2.0 * px;
    if (abs(dx) > reach && abs(hdx) > reach) continue;
    if (dyc > -2.0 && fragPx.y <= rA.z) {
      float len = max(rC.w, 1.0);
      float lipM = 1.0 - smoothstep(0.0, max(rC.z, 1.0), dy);
      float wn = 0.78 + 0.44 * vnoise1(dyc / 10.0 + rB.z);
      float w = rA.w * wn * (1.0 + 0.85 * lipM) * (1.0 - 0.15 * clamp(dy / len, 0.0, 1.0));
      float tt = 1.0 - smoothstep(w * 0.55, w, abs(dx));
      float front = rB.y / RUN_REFOG_S * len * 1.15;
      float aged = smoothstep(0.0, 3.0, rB.y);
      float strength = mix(1.0, smoothstep(front, front + 8.0 * px + 0.2 * len, dy), aged);
      strength *= (1.0 - 0.4 * smoothstep(0.0, RUN_REFOG_S, rB.y)) * smoothstep(-2.0 * px, 2.0 * px, dy);
      trail = max(trail, tt * strength);
      // water pushed aside piles the film up beside the channel: a faint ridge, brighter on the moon side
      float rd = (1.0 - smoothstep(w, w * 2.4, abs(dx))) * (1.0 - tt) * strength;
      ridge = max(ridge, rd * (dx < 0.0 ? 1.0 : 0.45));
    }
    vec2 hq = vec2(hdx, fragPx.y - rA.z) / vec2(rB.x * 0.9, rB.x * 1.3);
    float hn = length(hq);
    if (hn < 1.0 && headHit < 1.0) {
      headQ = hq;
      headHit = 1.0 - smoothstep(0.82, 1.0, hn);
    }
  }

  // 2. Cook's wipe: a soft front sweeps left to right. The hull stays clear, the rest re-fogs.
  float front = uWipe * (1.0 + SWEEP_SOFT) - vUv.x;
  float sweepC = clamp(front / SWEEP_SOFT, 0.0, 1.0) * step(0.0001, uWipe);
  float stay = max(1.0 - uRefog, hullF);
  float swept = sweepC * stay;

  // Breath: a soft puff around the head and along the last samples of its path. It thickens and cools the film.
  float breath = 0.0;
  if (uHead > 0.0 && uDetail > 0.5) {
    float wk = 1.0;
    float br = BREATH_R * px;
    for (int k = 0; k < 6; k++) {
      vec2 dv = fragPx - uTrail[k];
      breath += wk * exp(-dot(dv, dv) / (br * br));
      wk *= TRAIL_FALLOFF;
    }
    breath = min(breath, 1.0) * uHead;
  }

  // 3. Cold bloom of the haunting cue: the film densifies from the pane edges inward, the front wobbled by the film height.
  float edgeD = min(min(css.x, cssSize.x - css.x), css.y);
  float reach = 0.3 * min(cssSize.x, cssSize.y) * uBloom;
  float bloomM = uBloom * (1.0 - smoothstep(0.0, max(reach, 1.0), edgeD + (fg.y - 0.5) * 80.0));

  // 4. What the glass hides and what it shows.
  float opacity = clamp(fogD, 0.0, 1.0) * FOG_MAX;
  opacity = mix(opacity, 1.0, bloomM * 0.35);
  opacity += LIP_DENSITY * lip * (1.0 - T) + 0.12 * ridge + BREATH_DENSITY * breath * (1.0 - T);
  opacity *= (1.0 - 0.96 * T) * (1.0 - swept);

  float Lr = roomLight(vUv + refr / uRes, css + refr / px);
  vec3 seenFog = uBg + uAfter * Lr;
  // The hand is a window: a cleared stroke shows the room behind the glass, bent a little at the edge like a water-filled groove.
  float igl = length(inkGrad);
  vec2 wOff = inkGrad * (WINDOW_REFRACT_K * min(1.0, WINDOW_REFRACT / max(igl * WINDOW_REFRACT_K, 1e-4)));
  float Lw = windowLight(css + refr / px + wOff, vUv + (refr + wOff * px) / uRes);
  Lw = 1.5 * (1.0 - exp(-WINDOW_SHOULDER * Lw)); // soft shoulder: near the pot the light saturates, it does not wash to white
  vec3 seenWin = uBg + uNight * 0.35 + uAfter * Lw;
  // Dimmer light runs redder.
  seenWin *= mix(vec3(1.0, 0.8, 0.62), vec3(1.0), smoothstep(0.25, 0.85, dot(seenWin, vec3(0.2126, 0.7152, 0.0722)) / max(dot(uAfter, vec3(0.2126, 0.7152, 0.0722)), 1e-3)));
  float glow = pow(T, 0.7);
  vec3 seen = mix(seenFog, seenWin, glow);
  // Pen pressure: a thick dark stroke is the clearest and warmest, a hairline dimmer and cooler.
  float press = smoothstep(PRESSURE_LO, PRESSURE_HI, aInk);
  seen *= mix(vec3(1.0), mix(vec3(0.74, 0.86, 1.0), vec3(1.04, 1.0, 0.94), press) * mix(PRESSURE_DIM, 1.0, press), glow);

  // 5. The film, lit from inside the scene: cool from the moon above, warm from the pot and candle below.
  float potF = potAt(vUv, 2.2);
  float candF = candleAt(vUv, 9.0);
  vec3 film = uBefore * (FILM_BASE + FILM_D * fogD);
  film += uMoon * COOL_A * pow(1.0 - vUv.y, COOL_P);
  film += uAfter * (WARM_POT * potF * flicker() + WARM_CANDLE * candF) * (0.4 + 0.6 * fogD);
  float grain = hash(floor(fragPx / max(1.0, 0.8 * px)) + 91.7) - 0.5;
  film *= 1.0 + GRAIN_A * grain;
  // The film piles up at the edge of every stroke and run, brighter on the side the moon lights.
  film *= 1.0 + LIP_BRIGHT * (lip * (0.35 + 0.65 * lit) + 0.3 * ridge);
  film = mix(film, uGhost * 0.8, bloomM * 0.4);
  film = mix(film, uGhost * 0.85, BREATH_COOL * breath);
  float edgeShade = 1.0 - smoothstep(0.0, 0.08 * min(uRes.x, uRes.y), min(min(fragPx.x, uRes.x - fragPx.x), fragPx.y));
  film = mix(film, film * vec3(0.94, 1.06, 1.0), edgeShade);

  // The warm light of a written stroke reaches into the film around it and thins it a little.
  float haloLit = halo * (1.0 - T) * (1.0 - swept) * (0.55 + 0.9 * Lr);
  film += uAfter * HALO_GAIN * haloLit;
  opacity *= 1.0 - 0.18 * halo * (1.0 - T);

  vec3 col = mix(seen, film, clamp(opacity, 0.0, 1.0));

  // The edge is a thin wet meniscus: a fine bright line on the side that faces the lamp and the candle, a slight shade on the
  // far side, both broken by the film height. There is no outline that runs all the way round a letter.
  float facing = dot(outN, LAMP_DIR);
  float mBand = smoothstep(0.05, 0.2, T) * (1.0 - smoothstep(0.28, 0.6, T)) * (0.12 + 0.88 * brk) * (1.0 - swept);
  col += mix(uMoon, uAfter, 0.55) * MENISCUS_A * mBand * smoothstep(0.05, 0.75, facing);
  col *= 1.0 - FAR_SHADE * mBand * smoothstep(0.05, 0.75, -facing);

  // The channel of a run is clear glass: the dark room and the night seen through it, with a little warmth from the pot.
  vec3 chan = uBg + uNight * 1.5 + uAfter * (0.04 + Lr * 0.5);
  col = mix(col, chan, 0.72 * trail * (1.0 - swept) * (1.0 - T));

  // Beads hang under the lower edges of near-horizontal strokes.
  if (uDetail > 0.5 && edgeB > 0.04 && edgeB < 0.45 && outN.y > 0.55 && sd > 0.0) {
    float S = BEAD_SPACING * px;
    float id = floor(fragPx.x / S);
    if (hash(vec2(id, 9.1)) < 0.4) {
      float rb = mix(BEAD_R_LO, BEAD_R_HI, hash(vec2(id, 2.3))) * px;
      float cx = (id + 0.25 + 0.5 * hash(vec2(id, 5.7))) * S;
      vec2 q = vec2((fragPx.x - cx) / rb, (sd - rb * 0.95) / rb);
      float qn = length(q);
      if (qn < 1.0) {
        float bm = (1.0 - smoothstep(0.8, 1.0, qn)) * smoothstep(0.55, 0.85, outN.y) * smoothstep(0.0, 0.5, wf);
        col = mix(col, lensColour(q, roomBase(vUv), qn * qn, film), 0.9 * bm * (1.0 - smoothstep(0.1, 0.4, T)));
      }
    }
  }

  // 6. Droplets on the glass, three scales, density following the film, none in cleared glass.
  if (uDetail > 0.5) {
    float Lb = roomBase(vUv);
    float keep = (1.0 - smoothstep(0.0, 0.35, T)) * (1.0 - swept) * (1.0 - trail);
    float dens = smoothstep(0.3, 0.9, fogD) * keep;
    float rail = 1.0 + (RAIL_BOOST - 1.0) * smoothstep(0.88, 0.98, vUv.y);
    vec4 dTiny = dropLayer(fragPx, ${f(DROP_TINY.cell)}, ${f(DROP_TINY.rLo)}, ${f(DROP_TINY.rHi)}, ${f(DROP_TINY.prob)} * dens, 5.3, Lb, film);
    vec4 dMid = dropLayer(fragPx, ${f(DROP_MID.cell)}, ${f(DROP_MID.rLo)}, ${f(DROP_MID.rHi)}, ${f(DROP_MID.prob)} * dens, 61.1, Lb, film);
    vec4 dLarge = dropLayer(fragPx, ${f(DROP_LARGE.cell)}, ${f(DROP_LARGE.rLo)}, ${f(DROP_LARGE.rHi)} * (1.0 - RAIL_SHRINK * smoothstep(0.88, 0.98, vUv.y)), ${f(DROP_LARGE.prob)} * dens * rail, 23.9, Lb, film);
    col = mix(col, dTiny.rgb, dTiny.a);
    col = mix(col, dMid.rgb, dMid.a);
    col = mix(col, dLarge.rgb, dLarge.a);
  }

  if (headHit > 0.0 && uDetail > 0.5) {
    col = mix(col, beadColour(headQ, roomBase(vUv), dot(headQ, headQ), film, chan), 0.95 * headHit * (1.0 - swept));
  }

  // 7. Writing head: a cold fingertip glow at the toi frontier, capped, never amber. Fresh strokes carry a short cold wet sheen.
  float fresh = exp(-max(uU - ch.g, 0.0) / 0.03) * step(uU, 0.9999) * step(0.0, uU);
  col += uGhost * 0.16 * fresh * smoothstep(0.1, 0.6, T);
  if (uHead > 0.0 && gi >= 0) {
    vec4 hd = uGroupDst[uHeadGroup];
    if (fragPx.x >= hd.x && fragPx.y >= hd.y && fragPx.x < hd.z && fragPx.y < hd.w) {
      vec2 hp = mix(uGroupSrc[uHeadGroup].xy, uGroupSrc[uHeadGroup].zw, (fragPx - hd.xy) / (hd.zw - hd.xy));
      vec2 dv = hp - uHeadPos;
      float d2 = dot(dv, dv) / (HEAD_R * HEAD_R);
      float hg = 0.65 * exp(-d2 * 3.0) + 0.35 * exp(-d2 * 0.5);
      vec3 cold = mix(uGhost, uMoon, 0.5);
      float before = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 lit = mix(col, cold, hg * HEAD_A * uHead);
      float after = dot(lit, vec3(0.2126, 0.7152, 0.0722));
      // luminance added by the head never exceeds HEAD_MAX_LUMA
      col = after - before > HEAD_MAX_LUMA ? mix(col, lit, HEAD_MAX_LUMA / max(after - before, 1e-4)) : lit;
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
