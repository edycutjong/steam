// The shelf card's scan: page.jpg plus the smaller area-average copies written by scripts/shelf-thumbs.ts
// (480 and 800 px wide). The edition's facsimile and the note crops never use these.
export const SHELF_THUMB_WIDTHS = [480, 800] as const

/** The browser picks the smallest copy that covers the card: about 40% of a phone's width, at most 600 css px on a desktop. */
export const SHELF_THUMB_SIZES = '(max-width: 640px) 40vw, min(40vw, 600px)'

export function shelfThumb(id: string, scanWidth: number): { src: string; srcSet: string; sizes: string } {
  const base = `/recipes/${id}`
  const copies = SHELF_THUMB_WIDTHS.filter((w) => w < scanWidth).map((w) => `${base}/page-${w}.jpg ${w}w`)
  return { src: `${base}/page.jpg`, srcSet: [...copies, `${base}/page.jpg ${scanWidth}w`].join(', '), sizes: SHELF_THUMB_SIZES }
}
