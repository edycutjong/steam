// Every displayed note resolves to its source (R21, R22). Pure: no network call. "Resolves" means a checkable,
// reconstructible address on the archive's server; re-fetching the crop is the job of a script, not of the app.

import type { BundleNote, RecipeBundle } from './schema.ts'

export interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** Licence ids the product shows (R22.2). */
export const LICENCES = ['pdm', 'cc0', 'cc-by'] as const

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

type Raw = { ok: true; x0: number; y0: number; x1: number; y1: number; W: number; H: number } | { ok: false; reason: string }

/** floor of the origin and ceiling of the far edge, in canvas px, before clipping (R21.4). */
function rawRegion(bundle: RecipeBundle, note: BundleNote): Raw {
  const c = bundle.source?.canvas
  const f = bundle.source?.frame
  const b = note?.verifyBox
  if (!c || !f || !finite(c.width) || !finite(c.height) || !finite(f.width) || !finite(f.height) || c.width <= 0 || c.height <= 0 || f.width <= 0 || f.height <= 0) return { ok: false, reason: 'the canvas or the page frame is missing' }
  if (!Array.isArray(b) || b.length !== 4 || !b.every(finite)) return { ok: false, reason: 'the note has no verify box' }
  const [vx, vy, vw, vh] = b as [number, number, number, number]
  if (vw <= 0 || vh <= 0) return { ok: false, reason: 'the region has no area' }
  const sx = c.width / f.width
  const sy = c.height / f.height
  return { ok: true, x0: Math.floor(vx * sx), y0: Math.floor(vy * sy), x1: Math.ceil((vx + vw) * sx), y1: Math.ceil((vy + vh) * sy), W: c.width, H: c.height }
}

function clipped(r: Extract<Raw, { ok: true }>): Region | null {
  const x0 = Math.min(r.W, Math.max(0, r.x0))
  const y0 = Math.min(r.H, Math.max(0, r.y0))
  const x1 = Math.min(r.W, Math.max(0, r.x1))
  const y1 = Math.min(r.H, Math.max(0, r.y1))
  return x1 - x0 < 1 || y1 - y0 < 1 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The note's box in canvas pixels: integers, containing the scaled box, clipped to the canvas; null when it has no area (R21.4, R21.5). */
export function regionOf(bundle: RecipeBundle, note: BundleNote): Region | null {
  const r = rawRegion(bundle, note)
  return r.ok ? clipped(r) : null
}

/** `{imageService}/{x},{y},{w},{h}/full/0/default.jpg`, or null (R21.4). */
export function regionUrl(bundle: RecipeBundle, note: BundleNote): string | null {
  const r = regionOf(bundle, note)
  const svc = bundle.source?.imageService
  return r && svc ? `${svc}/${r.x},${r.y},${r.w},${r.h}/full/0/default.jpg` : null
}

/** The inverse of `regionUrl`. Rejects non-integers, negatives, missing numbers, any size or rotation other than `full/0`, and `pct:` regions. */
export function parseRegionUrl(url: string): { service: string; region: Region } | null {
  const m = /^(https?:\/\/.+)\/(\d+),(\d+),(\d+),(\d+)\/full\/0\/default\.jpg$/.exec(url)
  if (!m) return null
  const [x, y, w, h] = [m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number]
  if (![x, y, w, h].every(Number.isSafeInteger)) return null
  return { service: m[1]!, region: { x, y, w, h } }
}

export type Resolved =
  | { ok: true; manifest: string; canvas: string; region: Region; licence: string; regionUrl: string }
  | { ok: false; reason: string }

/** R22.2, checked in this order; the first failing rule names the reason. Never throws. */
export function resolveNote(bundle: RecipeBundle, note: BundleNote): Resolved {
  const no = (reason: string): Resolved => ({ ok: false, reason })
  const s = bundle.source
  const p = note?.provenance
  if (!s || !p) return no('the note has no source or provenance')
  if (typeof s.manifest !== 'string' || !/^https:\/\/[^\s/]+/.test(s.manifest)) return no('the manifest is not an https URL')
  if (typeof s.canvas?.id !== 'string' || s.canvas.id.length === 0) return no('the canvas id is missing')
  if (!Number.isInteger(s.canvasIndex)) return no('canvasIndex is not an integer')
  const agree: [string, unknown, unknown][] = [
    ['institution', p.institution, s.institution],
    ['shelfmark', p.shelfmark, s.shelfmark],
    ['page', p.page, s.page],
    ['date', p.date, s.date],
    ['licence id', p.licence?.id, s.licence?.id],
    ['credit', p.credit, s.credit],
  ]
  for (const [name, a, b] of agree) if (a !== b || a === undefined) return no(`the note's ${name} disagrees with the source`)
  if (!(LICENCES as readonly string[]).includes(s.licence.id)) return no(`licence ${s.licence.id} is not one of ${LICENCES.join(', ')}`)
  const raw = rawRegion(bundle, note)
  if (!raw.ok) return no(raw.reason)
  const region = clipped(raw)
  if (!region) return no('the region lies outside the canvas')
  const url = regionUrl(bundle, note)
  const back = url ? parseRegionUrl(url) : null
  if (!url || !back || back.service !== s.imageService || back.region.x !== region.x || back.region.y !== region.y || back.region.w !== region.w || back.region.h !== region.h)
    return no('the region URL does not parse back to the same service and region')
  return { ok: true, manifest: s.manifest, canvas: s.canvas.id, region, licence: s.licence.id, regionUrl: url }
}

/** The notes that resolve, in step order, and the rest with their reason (R22.4). */
export function displayableNotes(bundle: RecipeBundle): { notes: BundleNote[]; withheld: { noteId: string; reason: string }[] } {
  const notes: BundleNote[] = []
  const withheld: { noteId: string; reason: string }[] = []
  for (const n of [...bundle.notes].sort((a, b) => a.step - b.step)) {
    const r = resolveNote(bundle, n)
    if (r.ok) notes.push(n)
    else withheld.push({ noteId: n.id, reason: r.reason })
  }
  return { notes, withheld }
}
