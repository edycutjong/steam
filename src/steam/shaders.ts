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

export const FOG_MAX = 0.94
export const CH_GAIN = 0.55
export const RIM_K = 7.0
export const HEAD_R = 11.0
export const HEAD_A = 0.42
export const STREAK_A = 0.55
export const SWEEP_SOFT = 0.35

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
const float SWEEP_SOFT = ${SWEEP_SOFT.toFixed(2)};
const float TOI_SOFT = ${TOI_SOFT.toFixed(4)};
const float BEAD_CELL_CSS = 14.0;
const float BEAD_ZONE = 0.07;
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

// Locates the pixel inside a group's dst rect. Returns the group index or -1.
// nuv: note texture coordinate. npos: position in note px.
int locate(vec2 fragPx, out vec2 nuv, out vec2 npos) {
  nuv = vec2(0.0);
  npos = vec2(0.0);
  for (int i = 0; i < 2; i++) {
    if (i >= uGroupCount) break;
    vec4 dst = uGroupDst[i];
    if (fragPx.x >= dst.x && fragPx.y >= dst.y && fragPx.x < dst.z && fragPx.y < dst.w) {
      vec2 f = (fragPx - dst.xy) / (dst.zw - dst.xy);
      npos = mix(uGroupSrc[i].xy, uGroupSrc[i].zw, f);
      nuv = npos / uNoteSize;
      return i;
    }
  }
  return -1;
}

vec3 addBeadsAndStreak(vec3 col, vec2 uv, vec2 fragPx, float fogD) {
  // Specular streak across the top third: colour is the ink token, alpha capped.
  float s = uv.x * 0.8 + uv.y * 1.2;
  float streak = exp(-pow((s - 0.55) / 0.1, 2.0)) * 0.5 * (1.0 - smoothstep(0.2, 0.45, uv.y));
  col = mix(col, uInk, min(streak, STREAK_A));

  // Beads on the bottom rail. Density falls away from the rail.
  float rail = (1.0 - uv.y) / BEAD_ZONE;
  float zone = 1.0 - step(1.0, rail);
  float cell = BEAD_CELL_CSS * uDpr;
  vec2 id = floor(fragPx / cell);
  float h = hash(id);
  float h2 = hash(id + 41.7);
  float h3 = hash(id + 7.3);
  float present = step(0.62 + 0.3 * clamp(rail, 0.0, 1.0), h) * zone;
  vec2 centre = (id + 0.5 + (vec2(h2, h3) - 0.5) * 0.4) * cell;
  float rad = (0.16 + 0.14 * h2) * cell;
  float d = length(fragPx - centre);
  float inside = (1.0 - smoothstep(rad - 1.0, rad, d)) * present;
  float ring = smoothstep(rad * 0.6, rad, d) * inside;
  col = mix(col, uBg, ring * 0.35);
  col = mix(col, kitchen(uv), inside * 0.5 * (1.0 - ring));
  float hl = exp(-pow(length(fragPx - (centre - vec2(0.35 * rad))) / (0.22 * rad), 2.0)) * inside;
  col += uGhost * 0.6 * hl * fogD;
  return col;
}

void main() {
  vec2 fragPx = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // Pass 1 stored uv.y flipped, so flip it back to read the same field.
  float fogD = texture(uFog, vec2(vUv.x, 1.0 - vUv.y)).r;
  fogD += (hash(fragPx + uTime) - 0.5) * 0.02;

  vec2 nuv;
  vec2 npos;
  int gi = locate(fragPx, nuv, npos);
  vec4 ch = texture(uChan, nuv) * float(gi >= 0); // r alpha, g toi, b pressure, a hull feather
  float hullF = ch.a;

  // 1. Wipe-on. uU is -1 before writing, so wiped is 0 everywhere and nothing of the note exists.
  float wiped = clamp((uU - ch.g) / TOI_SOFT, 0.0, 1.0);
  float depth = 0.85 + 0.15 * ch.b;
  float clearM = clamp(ch.r * wiped * depth, 0.0, 1.0);

  // 2. Cook's wipe: a soft front sweeps left to right. The hull stays clear, the rest re-fogs.
  float front = uWipe * (1.0 + SWEEP_SOFT) - vUv.x;
  float sweepC = clamp(front / SWEEP_SOFT, 0.0, 1.0) * step(0.0001, uWipe);
  float stay = max(1.0 - uRefog, hullF);
  float fogOpacity = clamp(fogD, 0.0, 1.0) * FOG_MAX * (1.0 - clearM) * (1.0 - sweepC * stay);

  vec3 behind = kitchen(vUv);
  behind += uAfter * CH_GAIN * clearM * (0.55 + 0.45 * potGlow(vUv));

  vec3 fog = uBefore * (0.78 + 0.22 * fogD);
  fog = mix(fog, glassEdgeTint(fog), edgeMask(vUv));
  vec3 col = mix(behind, fog, fogOpacity);

  // 3. Cold wet rim from the channel's own edge gradient.
  float c = ch.r * wiped;
  float rim = clamp(length(vec2(dFdx(c), dFdy(c))) * RIM_K * uDpr, 0.0, 1.0) * (1.0 - clearM * 0.6);
  col = mix(col, uGhost, rim * 0.85);

  // 4. Writing head: cold white at the toi frontier. Never amber.
  if (uHead > 0.0 && gi == uHeadGroup) {
    vec2 dv = npos - uHeadPos;
    float hg = exp(-dot(dv, dv) / (HEAD_R * HEAD_R));
    col = mix(col, mix(uGhost, uMoon, 0.5), hg * HEAD_A * uHead);
  }

  col = addBeadsAndStreak(col, vUv, fragPx, fogD);
  col = min(col, uInk);
  oColor = vec4(col, 1.0);
}
`
