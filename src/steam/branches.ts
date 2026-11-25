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
  width: number
}

const MAX_DEPTH = 6
const f1 = (n: number): string => (Math.round(n * 10) / 10).toString()

/**
 * Three limbs enter from the left, the upper left and the upper right, and cross the moon. Each segment is a gently curved
 * quadratic that ends in 2 or 3 children, shorter and thinner, turned by a random angle. Layers (one path per depth) keep
 * the DOM to `MAX_DEPTH` elements.
 */
export function branchPaths(seed: number): BranchLayer[] {
  const rnd = prng(seed)
  const layers: string[][] = Array.from({ length: MAX_DEPTH }, () => [])
  const starts: Limb[] = [
    { x: -20, y: 150, angle: -0.22, len: 250, width: 8 },
    { x: 120, y: -20, angle: 1.05, len: 210, width: 6.5 },
    { x: NIGHT_W + 20, y: 20, angle: Math.PI - 0.55, len: 340, width: 8 },
    { x: NIGHT_W + 20, y: 250, angle: Math.PI + 0.35, len: 220, width: 5 },
  ]
  const grow = (l: Limb, depth: number): void => {
    if (depth >= MAX_DEPTH || l.len < 7) return
    const bend = (rnd() - 0.5) * 0.5
    const mx = l.x + Math.cos(l.angle + bend) * l.len * 0.5
    const my = l.y + Math.sin(l.angle + bend) * l.len * 0.5
    const ex = l.x + Math.cos(l.angle) * l.len
    const ey = l.y + Math.sin(l.angle) * l.len
    layers[depth].push(`M${f1(l.x)} ${f1(l.y)}Q${f1(mx)} ${f1(my)} ${f1(ex)} ${f1(ey)}`)
    const kids = depth < 1 ? 3 : 2
    for (let k = 0; k < kids; k++) {
      const turn = (k - (kids - 1) / 2) * (0.5 + 0.3 * rnd()) + (rnd() - 0.5) * 0.35
      grow(
        { x: ex, y: ey, angle: l.angle + turn, len: l.len * (0.58 + 0.2 * rnd()), width: l.width * 0.62 },
        depth + 1,
      )
    }
    // a side twig part-way along the limb
    if (depth < 4 && rnd() < 0.5) {
      const s = 0.45 + 0.3 * rnd()
      const tx = l.x + (ex - l.x) * s
      const ty = l.y + (ey - l.y) * s
      grow({ x: tx, y: ty, angle: l.angle + (rnd() < 0.5 ? -1 : 1) * (0.6 + 0.4 * rnd()), len: l.len * 0.45, width: l.width * 0.55 }, depth + 1)
    }
  }
  for (const s of starts) grow(s, 0)
  return layers
    .map((segs, i) => ({ d: segs.join(''), w: Math.max(0.7, 7.5 * Math.pow(0.62, i)) }))
    .filter((l) => l.d.length > 0)
}
