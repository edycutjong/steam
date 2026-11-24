// Verify links, check times and the recipe bundle (R23.3, R36, R37).

export interface VerifyInput {
  /** IIIF Image API service id from source.json. */
  imageService: string
  /** [x0, y0, x1, y1] in the page frame. */
  pageBox: [number, number, number, number]
  frame: { width: number; height: number }
  deskewDeg?: number
  deskewApplied?: boolean
}

const pct4 = (v: number): string => Math.min(100, Math.max(0, v)).toFixed(4)

/**
 * `<imageService>/pct:x,y,w,h/full/0/default.jpg` for the same pixels on the archive's server (R23.3).
 * Percentages of the page frame, so the link is the same for any download size. After an applied deskew the box is
 * mapped back to the original page by rotating its corners and taking their bounding box, and flagged approximate (R23.4).
 */
export function verifyUrl(i: VerifyInput): { url: string; approximate: boolean } {
  let [x0, y0, x1, y1] = i.pageBox
  const { width: W, height: H } = i.frame
  let approximate = false
  if (i.deskewApplied && i.deskewDeg) {
    approximate = true
    // applyDeskew rotated the page by -deg; map the box corners back by +deg about the page centre
    const a = (i.deskewDeg * Math.PI) / 180
    const cx = (W - 1) / 2
    const cy = (H - 1) / 2
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => {
      const dx = x! - cx
      const dy = y! - cy
      return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)] as const
    })
    x0 = Math.min(...pts.map((p) => p[0]))
    x1 = Math.max(...pts.map((p) => p[0]))
    y0 = Math.min(...pts.map((p) => p[1]))
    y1 = Math.max(...pts.map((p) => p[1]))
  }
  const cx0 = Math.max(0, x0)
  const cy0 = Math.max(0, y0)
  const cx1 = Math.min(W, x1)
  const cy1 = Math.min(H, y1)
  const x = (cx0 / W) * 100
  const y = (cy0 / H) * 100
  const w = ((cx1 - cx0) / W) * 100
  const h = ((cy1 - cy0) / H) * 100
  return { url: `${i.imageService}/pct:${pct4(x)},${pct4(y)},${pct4(w)},${pct4(h)}/full/0/default.jpg`, approximate }
}
