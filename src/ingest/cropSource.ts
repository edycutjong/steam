// The crop source of a note: where the pixels a note shows come from.
//
// "ownership" is the product path: the ink components owned by the note's quoted lines (src/ingest/masks.ts), cut
// to the word regions when the note is word-aligned (timeofink.ts `noteMask`). Code builds it; nobody reads it by eye.
//
// "eyeread-box" is the P0c kill-test prototype's behaviour, kept only as the documented reproduction of the
// crop-overlap bug (.kiro/specs/crop-overlap/bugfix.md): every ink pixel inside a rectangle somebody read by eye.
// A rectangle knows nothing about which line owns the ink under it, so it lights the neighbouring lines' strokes.

import { rotatedPoint } from './image.ts'
import type { Bands, Ownership } from './masks.ts'
import { noteMask, type BuiltPart } from './timeofink.ts'

export type CropMode = 'eyeread-box' | 'ownership'

/** [x0, y0, x1, y1], half-open, in the fixture frame (the frame of fixtures/p0033.jpg, before any deskew). */
export type CropBox = [number, number, number, number]

/** What the bundle knows about a note when it asks for its crop. */
export interface CropNote {
  id: string
  step: number
  /** The lines the note quotes: the only lines whose ink the note may show. */
  lines: number[]
  /** Word-level parts, when the note is word-aligned. Absent: every quoted line whole. */
  parts?: BuiltPart[]
  /** An eye-read rectangle, only for notes that arrive with one (the prototype). The pipeline's notes never do. */
  box?: CropBox
}

/** The page as segmented: everything a crop source may read. */
export interface CropPage {
  own: Ownership
  bands: Bands
  s: number
  /** Ink of the page inside the region (what ownership works on), analysis frame. */
  ink: Uint8Array
  /** Deskew angle applied to the analysis frame, 0 when none. */
  tilt: number
}

export interface Crop {
  mode: CropMode
  /** One byte per analysis-frame page pixel, 1 where the note shows the scan. */
  mask: Uint8Array
}

/**
 * The mode a note's crop is taken in when the caller does not name one.
 *
 * Current behaviour (the bug): a note that comes with a box is cropped by the box, as the prototype did.
 */
export function defaultCropMode(note: Pick<CropNote, 'box'>): CropMode {
  return note.box ? 'eyeread-box' : 'ownership'
}

const wholePart = (line: number): BuiltPart => ({ line, fromWord: 0, toWord: 0, method: 'lines', boundaries: [], autoDetail: 'whole line', whole: true })

/** Every scan pixel inside the box whose ink alpha > 0, whoever owns it. The old behaviour, reproduced honestly. */
function eyeReadMask(page: CropPage, box: CropBox): Uint8Array {
  const { width: w, height: h } = page.own
  const [x0, y0, x1, y1] = box
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!page.ink[y * w + x]) continue
      const [fx, fy] = rotatedPoint(x, y, page.tilt, w, h) // analysis pixel -> fixture frame
      if (fx < x0 || fx >= x1 || fy < y0 || fy >= y1) continue
      mask[y * w + x] = 1
    }
  return mask
}

/** The crop a note shows. `opts.mode` names a source explicitly; without it the default applies. */
export function cropSource(page: CropPage, note: CropNote, opts: { mode?: CropMode } = {}): Crop {
  const mode = opts.mode ?? defaultCropMode(note)
  if (mode === 'eyeread-box') {
    if (!note.box) throw new Error(`note ${note.id}: the eyeread-box crop source needs a box`)
    return { mode, mask: eyeReadMask(page, note.box) }
  }
  const parts = note.parts ?? note.lines.map(wholePart)
  return { mode, mask: noteMask(page.own, page.bands, page.s, parts) }
}
