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

/** Ember seen through the clear glass: gain far from the pot, gain at the pot, and the falloff exp(-d^2 K) (D13). */
export const THROUGH_FAR = 0.4
export const THROUGH_NEAR = 1.1
export const THROUGH_K = 1.0

/** Luminance cap inside strokes, 0..1 (D14). Applied by scaling the colour, so the ember hue survives. */
export const STROKE_LUMA_MAX = 0.92

/** Write-on leading edge: feather = TOI_SOFT * FEATHER_K in toi units, about 9 texels along the hero's path (D15). */
export const FEATHER_K = 0.8

/** Condensation grain amplitude as a fraction of the fog colour (D16). */
export const GRAIN_A = 0.08

export const FOG_MAX = 0.94
export const CH_GAIN = 1.0
export const RIM_K = 6.0
export const HEAD_R = 11.0
export const HEAD_A = 0.42
export const STREAK_A = 0.12
/** Streak half-width, CSS px (D10): the visible band is ~10 px. */
export const STREAK_HALF_CSS = 5.0
export const SWEEP_SOFT = 0.35
/** Fraction of the pane height above the bottom rail where beads form. */
export const BEAD_ZONE = 0.07
/** Pot plume vertical falloff: exp(-h^2 / PLUME_H2), h = height above the bottom edge (pane fraction). */
export const PLUME_H2 = 0.008
/** Height above which the plume adds under 2 levels of red-minus-blue (checked in shaders.test.ts). */
export const PLUME_REACH = 0.2
/** Plume strength (D11). */
export const PLUME_A = 0.36
/** Height of the plume peak above the bottom edge (pane fraction). */
export const PLUME_H0 = 0.03

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
uniform sampler2D uInkTex;
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
const float FEATHER_K = ${FEATHER_K.toFixed(2)};
const float TOI_SOFT = ${TOI_SOFT.toFixed(4)};
const float RESIDUAL_CLEAR = 0.72;
const float THROUGH_FAR = ${THROUGH_FAR.toFixed(2)};
const float THROUGH_NEAR = ${THROUGH_NEAR.toFixed(2)};
const float THROUGH_K = ${THROUGH_K.toFixed(2)};
const float STROKE_LUMA_MAX = ${STROKE_LUMA_MAX.toFixed(2)};
const float GRAIN_A = ${GRAIN_A.toFixed(2)};
const float DROP_CELL_CSS = 26.0;
const float DROP_KEEP_OUT_CSS = 28.0;
const float BLOOM_A = 0.26;
const float TRANS_LO = ${TRANS_LO.toFixed(3)};
const float TRANS_HI = ${TRANS_HI.toFixed(3)};
const float TRANS_GAMMA = ${TRANS_GAMMA.toFixed(3)};
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

float vnoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash(vec2(i, 7.7)), hash(vec2(i + 1.0, 7.7)), u);
}

float edgeMask(vec2 uv) {
  float e = min(min(uv.x * uRes.x, (1.0 - uv.x) * uRes.x), uv.y * uRes.y);
  return 1.0 - smoothstep(0.0, 0.08 * min(uRes.x, uRes.y), e);
}

// Slight green-grey tint, derived from the fog colour itself (no new token).
vec3 glassEdgeTint(vec3 fog) {
  return fog * vec3(0.94, 1.06, 1.0);
}

// How clear the glass is for a scan alpha: monotone and continuous over the whole range (transmission.ts is the twin).
float trans(float a) {
  float x = clamp((a - TRANS_LO) / (TRANS_HI - TRANS_LO), 0.0, 1.0);
  return pow(x * x * (3.0 - 2.0 * x), TRANS_GAMMA);
}

// Catmull-Rom magnification of the ink alpha in 5 bilinear taps (the 16-texel filter, corner taps dropped).
float inkCubic(vec2 npos) {
  vec2 tex = uNoteSize;
  vec2 pos = npos;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
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
  // A run-down streak (D16): the width wanders along its length, the opacity breathes, and both ends fade out.
  float along = uv.x * 1.2 - uv.y * 0.8;
  float nw = vnoise1(along * 6.0 + 3.0);
  float no = vnoise1(along * 11.0 + 40.0);
  float halfW = STREAK_HALF * uDpr * mix(0.55, 1.45, nw);
  float streak = exp(-pow(dpx / halfW, 2.0));
  float ends = smoothstep(0.0, 0.08, uv.y) * (1.0 - smoothstep(0.2, 0.45, uv.y)) * smoothstep(0.02, 0.14, uv.x);
  col = mix(col, uInk, STREAK_A * streak * ends * mix(0.55, 1.0, no));

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
  // The leading edge is a smooth ramp in the time-of-ink domain (D15), applied after the alpha curve below, so
  // the letter keeps its shape while it clears and its ember fades in.
  float wiped = clamp((uU - ch.g) / (TOI_SOFT * FEATHER_K), 0.0, 1.0);
  float wf = wiped * wiped * (3.0 - 2.0 * wiped);
  float depth = 0.9 + 0.1 * ch.b;
  float c = ch.r * wiped;
  // The scan's continuous ink alpha, magnified bicubically. gi < 0 means no group covers this pixel.
  float aInk = gi >= 0 ? inkCubic(npos) : 0.0;
  float clearM = aInk;
  float fogK = smoothstep(0.45, 0.85, fogD);

  // Neighbourhood of written ink, only near the hull: a pile-up ring, a warm bloom and run-off drips.
  float near = 0.0;
  float far = 0.0;
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
  }
  // The glass is as clear as the scan is dark: a smooth monotone map, never a band (design §3).
  float clearRaw = trans(aInk);
  float clearS = clearRaw * wf;

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
  behind += uAfter * CH_GAIN * emberM * anchor * (0.8 + 0.4 * fogD);

  // Fine static condensation grain (D16), a different speck from pass 1's flicker. Same function everywhere,
  // so it cannot outline the note.
  float grain = hash(floor(fragPx / max(1.0, 0.8 * px)) + 91.7) - 0.5;
  vec3 fog = uBefore * (0.78 + 0.22 * fogD) * (1.0 + GRAIN_A * grain);
  fog = mix(fog, glassEdgeTint(fog), edgeMask(vUv));
  // Fog piles up just outside the edge of written ink.
  float outside = 1.0 - clearS;
  fog += uMoon * 0.04 * near * outside;
  vec3 col = mix(behind, fog, clamp(fogOpacity + 0.06 * near * outside, 0.0, 1.0));

  // Warm bloom of the ember light, 4 to 7 px into the fog around the channel, never over the stroke.
  col += uAfter * BLOOM_A * far * outside * (0.5 + 0.5 * low);

  // 3. Cold wet rim on the channel's outer edge: thin, brighter below, fainter above.
  vec2 g2 = vec2(dFdx(ch.r), dFdy(ch.r));
  float grad = length(g2) * px;
  float lower = smoothstep(-0.6, 0.6, g2.y / max(length(g2), 1e-4));
  // Only on the fog side of the edge (outside the clear band), and softer in thin fog (D13).
  float rim = smoothstep(0.05, 0.05 + 1.0 / RIM_K, grad) * (1.0 - smoothstep(0.3, 0.6, ch.r)) * wf * (1.0 - clearRaw) * (1.0 - clearRaw);
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

  // Sparse condensation droplets in the fog, only away from the note: outside every group rect plus a keep-out
  // margin, outside the hull, and never on a cleared stroke (D16).
  {
    float cellD = DROP_CELL_CSS * px;
    vec2 idD = floor(fragPx / cellD);
    float hD = hash(idD + 5.3);
    float hD2 = hash(idD + 61.1);
    float hD3 = hash(idD + 23.9);
    float railD = (1.0 - vUv.y) / BEAD_ZONE;
    float keep = 1.0;
    for (int i = 0; i < 2; i++) {
      if (i >= uGroupCount) break;
      vec4 dst = uGroupDst[i];
      float m = DROP_KEEP_OUT_CSS * px;
      if (fragPx.x > dst.x - m && fragPx.x < dst.z + m && fragPx.y > dst.y - m && fragPx.y < dst.w + m) keep = 0.0;
    }
    keep *= (1.0 - step(0.01, hullF)) * step(1.0, railD) * (1.0 - step(0.5, clearS));
    vec2 cD = (idD + 0.2 + 0.6 * vec2(hD2, hD3)) * cellD;
    float rD = (2.0 + 2.4 * hD2) * px;
    float dD = length(fragPx - cD);
    float inD = (1.0 - smoothstep(rD - 0.8 * px, rD, dD)) * step(0.93, hD) * keep;
    float ringD = smoothstep(rD * 0.55, rD, dD) * inD;
    col = mix(col, uBg, ringD * 0.5);
    col = mix(col, col + uAfter * 0.14 * (0.4 + 0.6 * low), inD * (1.0 - ringD) * 0.8);
    float hlD = exp(-pow(length(fragPx - (cD - vec2(0.35 * rD))) / (0.32 * rD), 2.0)) * inD;
    col += mix(uGhost, uMoon, 0.6) * 0.4 * hlD;
  }

  col = addBeadsAndStreak(col, vUv, fragPx, fogD);

  // The pot's plume: warm light rising from the bottom edge, brightest at the bottom.
  float aspect = uRes.x / uRes.y;
  float sway = 0.012 * sin(uTime * 1.3 + vUv.y * 7.0) + 0.006 * sin(uTime * 2.7 + vUv.y * 13.0);
  float px0 = (vUv.x - uPot.x + sway) * aspect;
  float height = 1.0 - vUv.y;
  float spread = 0.11 + 0.9 * height;
  // Raised: zero at the rail, peak PLUME_H0 above it, then the old falloff, so the rail never cuts a hot spot (D15).
  float above = max(height - ${PLUME_H0.toFixed(2)}, 0.0);
  float plume = exp(-px0 * px0 / (spread * spread)) * exp(-above * above / ${PLUME_H2.toFixed(4)})
              * smoothstep(0.0, ${PLUME_H0.toFixed(2)}, height);
  plume *= 0.9 + 0.1 * sin(uTime * 5.1 + height * 9.0);
  col += uAfter * PLUME_A * plume;

  // D14: near the pot the ember gain stacks on the room light and would clip to white. Inside strokes, scale the
  // colour (not each channel) so luminance stays at or under the cap and the --after hue survives.
  float strokeM = smoothstep(0.0, 0.5, clearS);
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col *= mix(1.0, min(1.0, STROKE_LUMA_MAX / max(lum, 1e-4)), strokeM);

  col = min(col, uInk);
  oColor = vec4(col, 1.0);
}
`
