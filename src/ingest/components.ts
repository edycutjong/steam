// 8-connected component labelling by union-find (R10.1).
// The root of every set is its smallest raster index, which is the y*width+x of its first pixel, so ids do not
// depend on the order in which unions happen.

export interface Labels {
  width: number
  height: number
  /** Component id per pixel, -1 where there is no ink. */
  label: Int32Array
  /** Component ids in increasing order. */
  ids: Int32Array
  /** Pixel count per component id. */
  size: Map<number, number>
}

export function labelComponents(ink: Uint8Array, width: number, height: number): Labels {
  const n = width * height
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!
      a = parent[a]!
    }
    return a
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    if (ra < rb) parent[rb] = ra
    else parent[ra] = rb
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!ink[i]) continue
      if (x > 0 && ink[i - 1]) union(i, i - 1)
      if (y > 0) {
        const up = i - width
        if (ink[up]) union(i, up)
        if (x > 0 && ink[up - 1]) union(i, up - 1)
        if (x + 1 < width && ink[up + 1]) union(i, up + 1)
      }
    }
  }
  const label = new Int32Array(n).fill(-1)
  const size = new Map<number, number>()
  const ids: number[] = []
  for (let i = 0; i < n; i++) {
    if (!ink[i]) continue
    const r = find(i)
    label[i] = r
    const s = size.get(r)
    if (s === undefined) {
      size.set(r, 1)
      ids.push(r)
    } else size.set(r, s + 1)
  }
  ids.sort((a, b) => a - b)
  return { width, height, label, ids: Int32Array.from(ids), size }
}
