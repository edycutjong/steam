// GLSL ES 3.00 sources for the two passes. Both passes share one vertex shader.
// No colour literals live here: every colour arrives as a token uniform (R14.9).

import { TOI_SOFT } from './timeline.ts'

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
 * Pass 1: fog density at quarter resolution into an R8 texture.
 * It reads nothing from the note, so fog outside the hull is the same function as fog anywhere (R6.2).
 */
export const FOG_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uTime;
uniform float uThicken;
in vec2 vUv;
out float oDensity;
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
  oDensity = clamp(d, 0.0, 1.0);
}
`

/**
 * Clear curve over the scan's ink alpha (D12). One narrow smoothstep centred on CLEAR_MID, so a stroke is
 * clear exactly where the scan has ink and no wider. `hero.coverage.test.ts` measures the area it reveals.
 */
export const CLEAR_MID = 0.45
export const CLEAR_HALF = 0.15
/** D13: the edge band follows the fog density. Thin fog gives a soft edge, thick fog a crisp wet edge. */
export const CLEAR_HALF_THIN = 0.2
export const CLEAR_HALF_THICK = 0.1
/** Fog density range (pass-1 value) over which the edge goes from soft to crisp. */
export const EDGE_FOG_LO = 0.45
export const EDGE_FOG_HI = 0.85
export function clearCurve(alpha: number, half: number = CLEAR_HALF): number {
  const t = Math.min(1, Math.max(0, (alpha - (CLEAR_MID - half)) / (2 * half)))
  return t * t * (3 - 2 * t)
}

/** Ember seen through the clear glass: gain far from the pot, gain at the pot, and the falloff exp(-d^2 K) (D13). */
export const THROUGH_FAR = 0.3
export const THROUGH_NEAR = 1.1
export const THROUGH_K = 1.0

export const FOG_MAX = 0.94
export const CH_GAIN = 1.0
export const RIM_K = 6.0
export const HEAD_R = 11.0
export const HEAD_A = 0.42
export const STREAK_A = 0.1
/** Streak half-width, CSS px (D10): the visible band is ~10 px. */
export const STREAK_HALF_CSS = 5.0
export const SWEEP_SOFT = 0.35
/** Fraction of the pane height above the bottom rail where beads form. */
export const BEAD_ZONE = 0.07
/** Pot plume vertical falloff: exp(-h^2 / PLUME_H2), h = height above the bottom edge (pane fraction). */
export const PLUME_H2 = 0.008
/** Height above which the plume adds under 2 levels of red-minus-blue (checked in shaders.test.ts). */
export const PLUME_REACH = 0.17
/** Plume strength (D11). */
export const PLUME_A = 0.45

/**
 * Pass 2: composite at full canvas resolution.
 * Reads uChan once (the single toi read) and uFog once. The scan's RGB is never drawn:
 * the note enters only as channel alpha, time-of-ink and pressure (R7.5, R7.7).
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
uniform vec4 uGroupSrc[2];
uniform vec4 uGroupDst[2];
uniform int uGroupCount;
uniform vec2 uNoteSize;
uniform vec2 uHeadPos;
uniform int uHeadGroup;
uniform vec3 uBg;
uniform vec3 uInk;
uniform vec3 uBefore;
uniform vec3 uAfter;
uniform vec3 uRule;
uniform vec3 uGhost;
uniform vec3 uMoon;
uniform vec3 uNight;
uniform vec2 uPot;
uniform sampler2D uNote;
uniform sampler2D uChan;
uniform sampler2D uFog;

const float FOG_MAX = ${FOG_MAX.toFixed(2)};
const float CH_GAIN = ${CH_GAIN.toFixed(2)};
const float RIM_K = ${RIM_K.toFixed(1)};
const float HEAD_R = ${HEAD_R.toFixed(1)};
const float HEAD_A = ${HEAD_A.toFixed(2)};
const float STREAK_A = ${STREAK_A.toFixed(2)};
const float STREAK_HALF = ${STREAK_HALF_CSS.toFixed(1)};
const float SWEEP_SOFT = ${SWEEP_SOFT.toFixed(2)};
const float TOI_SOFT = ${TOI_SOFT.toFixed(4)};
const float RESIDUAL_CLEAR = 0.78;
const float THROUGH_FAR = ${THROUGH_FAR.toFixed(2)};
const float THROUGH_NEAR = ${THROUGH_NEAR.toFixed(2)};
const float THROUGH_K = ${THROUGH_K.toFixed(2)};
const float BLOOM_A = 0.26;
const float CLEAR_MID = ${CLEAR_MID.toFixed(2)};
const float CLEAR_HALF_THIN = ${CLEAR_HALF_THIN.toFixed(2)};
const float CLEAR_HALF_THICK = ${CLEAR_HALF_THICK.toFixed(2)};
const float EDGE_FOG_LO = ${EDGE_FOG_LO.toFixed(2)};
const float EDGE_FOG_HI = ${EDGE_FOG_HI.toFixed(2)};
const float RIM_A = 0.45;
const float PLUME_A = ${PLUME_A.toFixed(2)};
const float BEAD_CELL_CSS = 14.0;
const float BEAD_ZONE = ${BEAD_ZONE.toFixed(2)};
${NOISE_GLSL}
float potGlow(vec2 uv) {
  float aspect = uRes.x / uRes.y;
  float d = distance(uv * vec2(aspect, 1.0), uPot * vec2(aspect, 1.0));
  return exp(-d * d * 3.2);
}

// What the fog hides: the dark room and the pot's warm light from below.
vec3 kitchen(vec2 uv) {
  float flick = 0.94 + 0.06 * sin(uTime * 5.1) * sin(uTime * 3.3 + 1.7);
  vec3 c = uBg + uAfter * potGlow(uv) * 0.62 * flick;
  c += uAfter * 0.05 * exp(-pow(uv.y - 1.0, 2.0) * 9.0);
  return c;
}

float edgeMask(vec2 uv) {
  float e = min(min(uv.x * uRes.x, (1.0 - uv.x) * uRes.x), uv.y * uRes.y);
  return 1.0 - smoothstep(0.0, 0.08 * min(uRes.x, uRes.y), e);
}

// Slight green-grey tint, derived from the fog colour itself (no new token).
vec3 glassEdgeTint(vec3 fog) {
  return fog * vec3(0.94, 1.06, 1.0);
}

// Samples the channel at a screen px position. Where group rects overlap (the stacked layout),
// the sample with the larger alpha wins, so one group never masks the other's ink (D9).
// Returns (alpha, toi, pressure, hull feather); grp is the winning group or -1.
vec4 sampleChan(vec2 fp, out int grp, out vec2 npos) {
  vec4 best = vec4(0.0);
  grp = -1;
  npos = vec2(0.0);
  for (int i = 0; i < 2; i++) {
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

// Written ink coverage (alpha times wiped) at a screen px position.
float tapC(vec2 fp) {
  int g;
  vec2 np;
  vec4 v = sampleChan(fp, g, np);
  return v.r * clamp((uU - v.g) / TOI_SOFT, 0.0, 1.0) * float(g >= 0);
}

vec3 addBeadsAndStreak(vec3 col, vec2 uv, vec2 fragPx, float fogD) {
  // Specular streak across the top third: colour is the ink token, alpha capped.
  float sv = uv.x * 0.8 + uv.y * 1.2;
  // Perpendicular distance from the streak line in device px, then a soft gaussian falloff.
  float dpx = (sv - 0.55) / length(vec2(0.8 / uRes.x, 1.2 / uRes.y));
  float streak = exp(-pow(dpx / (STREAK_HALF * uDpr), 2.0)) * (1.0 - smoothstep(0.2, 0.45, uv.y));
  col = mix(col, uInk, min(streak, STREAK_A));

  // Beads on the bottom rail. Density falls away from the rail.
  float rail = (1.0 - uv.y) / BEAD_ZONE;
  float zone = 1.0 - step(1.0, rail);
  float cell = BEAD_CELL_CSS * uDpr;
  vec2 id = floor(fragPx / cell);
  float h = hash(id);
  float h2 = hash(id + 41.7);
  float h3 = hash(id + 7.3);
  float present = step(0.86 + 0.12 * clamp(rail, 0.0, 1.0), h) * zone;
  vec2 centre = (id + 0.5 + (vec2(h2, h3) - 0.5) * 0.4) * cell;
  float rad = (0.16 + 0.14 * h2) * cell;
  float d = length(fragPx - centre);
  float inside = (1.0 - smoothstep(rad - 1.0, rad, d)) * present;
  float ring = smoothstep(rad * 0.6, rad, d) * inside;
  // A transparent drop: darker rim, the ember showing through the middle, a small catch-light.
  col = mix(col, uBg, ring * 0.55);
  col = mix(col, kitchen(uv) + uAfter * 0.22, inside * 0.7 * (1.0 - ring));
  float hl = exp(-pow(length(fragPx - (centre - vec2(0.38 * rad, 0.38 * rad))) / (0.2 * rad), 2.0)) * inside;
  col += mix(uGhost, uMoon, 0.6) * 0.7 * hl;
  return col;
}

void main() {
  vec2 fragPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // Pass 1 stored uv.y flipped, so flip it back to read the same field.
  float fogD = texture(uFog, vec2(vUv.x, 1.0 - vUv.y)).r;
  fogD += (hash(fragPx + uTime) - 0.5) * 0.02;

  int gi;
  vec2 npos;
  vec4 ch = sampleChan(fragPx, gi, npos); // r alpha, g toi, b pressure, a hull feather
  float hullF = ch.a;
  float px = uDpr;

  // 1. Wipe-on. uU is -1 before writing, so wiped is 0 everywhere and nothing of the note exists.
  float wiped = clamp((uU - ch.g) / TOI_SOFT, 0.0, 1.0);
  float depth = 0.9 + 0.1 * ch.b;
  float c = ch.r * wiped;
  float clearM = clamp(c * depth, 0.0, 1.0);
  // Edge width: follows the fog density (D13), and never narrower than about one screen px of the alpha ramp.
  float fogK = smoothstep(EDGE_FOG_LO, EDGE_FOG_HI, fogD);
  float edgeHalf = mix(CLEAR_HALF_THIN, CLEAR_HALF_THICK, fogK);
  edgeHalf = max(edgeHalf, 0.6 * length(vec2(dFdx(clearM), dFdy(clearM))));

  // Neighbourhood of written ink, only near the hull: a pile-up ring, a warm bloom and run-off drips.
  float near = 0.0;
  float far = 0.0;
  float drip = 0.0;
  if (hullF > 0.01 && uU > -0.5) {
    // Rings rotated per pixel (interleaved noise) so the taps blur instead of ghosting.
    float ang = 6.2831853 * fract(52.9829189 * fract(dot(fragPx, vec2(0.06711056, 0.00583715))));
    vec2 e1 = vec2(cos(ang), sin(ang));
    vec2 e2 = vec2(-e1.y, e1.x);
    float rn = 2.0 * px;
    near = (tapC(fragPx + e1 * rn) + tapC(fragPx - e1 * rn) + tapC(fragPx + e2 * rn) + tapC(fragPx - e2 * rn)) * 0.25;
    float ra = 4.0 * px;
    float rb = 7.0 * px;
    vec2 d45 = (e1 + e2) * 0.7071;
    vec2 m45 = (e1 - e2) * 0.7071;
    far = (tapC(fragPx + e1 * rb) + tapC(fragPx - e1 * rb) + tapC(fragPx + e2 * rb) + tapC(fragPx - e2 * rb)
         + tapC(fragPx + d45 * ra) + tapC(fragPx - d45 * ra) + tapC(fragPx + m45 * ra) + tapC(fragPx - m45 * ra)) * 0.125;
    // Short run-off drips below written ink: a few thin columns, each of its own length.
    float cell = 7.0 * px;
    vec2 id = floor(vec2(fragPx.x / cell, 0.0));
    float h = hash(id + 3.1);
    float h2 = hash(id + 17.9);
    float colMatch = 1.0 - smoothstep(0.55 * px, 0.95 * px, abs(fragPx.x - (id.x + 0.2 + 0.6 * h2) * cell));
    if (colMatch > 0.0 && h > 0.9 && c < 0.2) {
      float len = (6.0 + 8.0 * h2) * px;
      float hit = 0.0;
      hit = max(hit, step(0.55, tapC(fragPx - vec2(0.0, len * 0.25))) * 0.9);
      hit = max(hit, step(0.55, tapC(fragPx - vec2(0.0, len * 0.55))) * 0.7);
      hit = max(hit, step(0.55, tapC(fragPx - vec2(0.0, len))) * 0.5);
      drip = hit * colMatch;
    }
  }
  clearM = max(clearM, drip);
  // Glass is clear exactly where the scan has ink: one narrow band over the scan's alpha (D12).
  float clearS = smoothstep(CLEAR_MID - edgeHalf, CLEAR_MID + edgeHalf, clearM);

  // 2. Cook's wipe: a soft front sweeps left to right. The hull stays clear, the rest re-fogs.
  float front = uWipe * (1.0 + SWEEP_SOFT) - vUv.x;
  float sweepC = clamp(front / SWEEP_SOFT, 0.0, 1.0) * step(0.0001, uWipe);
  float stay = max(1.0 - uRefog, hullF);
  // The glass is not perfectly clear: a residual of the fog grain stays inside the channel.
  float fogOpacity = clamp(fogD, 0.0, 1.0) * FOG_MAX * (1.0 - RESIDUAL_CLEAR * clearS) * (1.0 - sweepC * stay);

  // Ember light behind the glass: a gradient anchored to the pot, brightest low.
  float low = smoothstep(0.1, 1.0, vUv.y);
  // What the glass shows is the warm room: brightest near the pot, dim at the top of the pane (D13).
  float aspect0 = uRes.x / uRes.y;
  float dPot = distance(vUv * vec2(aspect0, 1.0), uPot * vec2(aspect0, 1.0));
  float anchor = mix(THROUGH_FAR, THROUGH_NEAR, exp(-dPot * dPot * THROUGH_K));
  vec3 behind = kitchen(vUv);
  // The ember lights the whole written stroke, faint ink included. Scaling it by clearS let the dark room
  // through partly cleared (faint) ink, which read as dark smudges inside strokes (D9).
  float emberM = smoothstep(0.0, 0.5, clearS);
  behind += uAfter * CH_GAIN * emberM * anchor;

  vec3 fog = uBefore * (0.78 + 0.22 * fogD);
  fog = mix(fog, glassEdgeTint(fog), edgeMask(vUv));
  // Fog piles up just outside the edge of written ink.
  float outside = 1.0 - clearS;
  fog += uMoon * 0.04 * near * outside;
  vec3 col = mix(behind, fog, clamp(fogOpacity + 0.06 * near * outside, 0.0, 1.0));

  // Warm bloom of the ember light, 4 to 7 px into the fog around the channel, never over the stroke.
  col += uAfter * BLOOM_A * far * outside * (0.5 + 0.5 * low);

  // 3. Cold wet rim on the channel's outer edge: thin, brighter below, fainter above.
  vec2 g2 = vec2(dFdx(c), dFdy(c));
  float grad = length(g2) * px;
  float lower = smoothstep(-0.6, 0.6, g2.y / max(length(g2), 1e-4));
  // Only on the fog side of the edge (outside the clear band), and softer in thin fog (D13).
  float rim = smoothstep(0.05, 0.05 + 1.0 / RIM_K, grad) * (1.0 - smoothstep(0.3, 0.6, c)) * (1.0 - clearS) * (1.0 - clearS);
  col = mix(col, uGhost, rim * RIM_A * mix(0.55, 1.0, fogK) * mix(0.2, 1.0, lower));

  // 4. Writing head: cold white at the toi frontier. Never amber.
  if (uHead > 0.0 && gi >= 0) {
    vec4 hd = uGroupDst[uHeadGroup];
    if (fragPx.x >= hd.x && fragPx.y >= hd.y && fragPx.x < hd.z && fragPx.y < hd.w) {
      vec2 hp = mix(uGroupSrc[uHeadGroup].xy, uGroupSrc[uHeadGroup].zw, (fragPx - hd.xy) / (hd.zw - hd.xy));
      vec2 dv = hp - uHeadPos;
      float hg = exp(-dot(dv, dv) / (HEAD_R * HEAD_R));
      col = mix(col, mix(uGhost, uMoon, 0.5), hg * HEAD_A * uHead);
    }
  }

  col = addBeadsAndStreak(col, vUv, fragPx, fogD);

  // The pot's plume: warm light rising from the bottom edge, brightest at the bottom.
  float aspect = uRes.x / uRes.y;
  float sway = 0.012 * sin(uTime * 1.3 + vUv.y * 7.0) + 0.006 * sin(uTime * 2.7 + vUv.y * 13.0);
  float px0 = (vUv.x - uPot.x + sway) * aspect;
  float height = 1.0 - vUv.y;
  float spread = 0.07 + 0.9 * height;
  float plume = exp(-px0 * px0 / (spread * spread)) * exp(-height * height / ${PLUME_H2.toFixed(4)});
  plume *= 0.9 + 0.1 * sin(uTime * 5.1 + height * 9.0);
  col += uAfter * PLUME_A * plume;

  col = min(col, uInk);
  oColor = vec4(col, 1.0);
}
`
