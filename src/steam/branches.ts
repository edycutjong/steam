// Bare branches for the night view (steam-renderer-v1 design §7.1): a seeded recursive silhouette, as SVG path data.
// Deterministic for a seed: the only randomness is the seeded generator below, and nothing reads a clock.

/** The night view's coordinate box. */
export const NIGHT_W = 1200
export const NIGHT_H = 300

export interface BranchLayer {
  /** SVG path data of every segment at one depth. */
  d: string
  /** Stroke width at that depth, user units. */
  w: number
}

/** mulberry32. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Limb {
  x: number
  y: number
  angle: number
  len: number
  /** Width at the base, user units. */
  width: number
}

/** The moon the branches keep clear of (NightView's MOON, kept equal by a test): no centreline sample comes closer than KEEP to its centre. */
export const MOON_CENTRE = { x: 760, y: 196, r: 58 }
export const KEEP_R = MOON_CENTRE.r * 0.45 + 5
const MAX_DEPTH = 6
const SAMPLES = 7
const TAPER = 0.7
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString()

/** Point and unit normal on the quadratic (p0, p1, p2) at t. */
function quad(p0: [number, number], p1: [number, number], p2: [number, number], t: number): { x: number; y: number; nx: number; ny: number } {
  const u = 1 - t
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0]
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0])
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1])
  const n = Math.hypot(dx, dy) || 1
  return { x, y, nx: -dy / n, ny: dx / n }
}

/**
 * A seeded bare tree as filled, tapered shapes (each segment a polygon from its base width down to TAPER of it, the next segment
 * starting at that width), crooked by a random bend per segment. Limbs enter from the left, the upper left and the right; a
 * segment whose centreline would come within KEEP_R of the moon's centre is dropped with everything it would have carried, so no
 * branch crosses the disc's middle (a thin twig across its edge is fine). Layers (one path per depth) keep the DOM to
 * `MAX_DEPTH` elements; `w` is the base width of the depth.
 */
export function branchPaths(seed: number): BranchLayer[] {
  const rnd = prng(seed)
  const layers: string[][] = Array.from({ length: MAX_DEPTH }, () => [])
  const starts: Limb[] = [
    { x: -20, y: 168, angle: -0.3, len: 250, width: 9 },
    { x: 120, y: -20, angle: 1.05, len: 210, width: 7 },
    { x: NIGHT_W + 20, y: 20, angle: Math.PI - 0.5, len: 340, width: 9 },
    { x: NIGHT_W + 20, y: 262, angle: Math.PI + 0.45, len: 230, width: 6 },
  ]
  const grow = (l: Limb, depth: number): void => {
    if (depth >= MAX_DEPTH || l.len < 7) return
    const bend = (rnd() - 0.5) * 0.9
    const p0: [number, number] = [l.x, l.y]
    const p1: [number, number] = [l.x + Math.cos(l.angle + bend) * l.len * 0.55, l.y + Math.sin(l.angle + bend) * l.len * 0.55]
    const p2: [number, number] = [l.x + Math.cos(l.angle) * l.len, l.y + Math.sin(l.angle) * l.len]
    const w1 = Math.max(0.6, l.width * TAPER)
    const left: string[] = []
    const right: string[] = []
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES
      const q = quad(p0, p1, p2, t)
      if (Math.hypot(q.x - MOON_CENTRE.x, q.y - MOON_CENTRE.y) < KEEP_R) return
      const hw = (l.width + (w1 - l.width) * t) / 2
      left.push(`${f1(q.x + q.nx * hw)} ${f1(q.y + q.ny * hw)}`)
      right.push(`${f1(q.x - q.nx * hw)} ${f1(q.y - q.ny * hw)}`)
    }
    layers[depth].push(`M${left.join('L')}L${right.reverse().join('L')}Z`)
    const ex = p2[0]
    const ey = p2[1]
    const kids = depth < 1 ? 3 : 2
    for (let k = 0; k < kids; k++) {
      const turn = (k - (kids - 1) / 2) * (0.5 + 0.3 * rnd()) + (rnd() - 0.5) * 0.5
      grow({ x: ex, y: ey, angle: l.angle + turn, len: l.len * (0.58 + 0.2 * rnd()), width: w1 }, depth + 1)
    }
    // a side twig part-way along the limb
    if (depth < 4 && rnd() < 0.5) {
      const s = 0.45 + 0.3 * rnd()
      const q = quad(p0, p1, p2, s)
      grow({ x: q.x, y: q.y, angle: l.angle + (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rnd()), len: l.len * 0.45, width: Math.max(0.6, l.width * (1 - 0.3 * s) * 0.6) }, depth + 1)
    }
  }
  for (const s of starts) grow(s, 0)
  return layers.map((segs, i) => ({ d: segs.join(''), w: Math.max(0.6, 9 * Math.pow(TAPER, i)) })).filter((l) => l.d.length > 0)
}
