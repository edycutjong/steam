// GLSL ES 3.00 sources for the two passes. Both passes share one vertex shader.
// No colour literals live here: every colour arrives as a token uniform (R14.9).

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
