// Licence resolved by code from the archive's record (R3). Pure: the caller fetches the JSON.

import { LICENCE_ALLOW } from './constants.ts'

export type LicenceResult =
  | { ok: true; id: string; label: string; url: string; manifest: string }
  | { ok: false; reason: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Takes `items[].locations[]` whose `locationType.id` is `iiif-presentation` and reads `license.id` from there.
 * A top-level `license` of the Work, and the licence of a thumbnail, are never read (R3.1).
 * Fails closed on anything unexpected (R3.3).
 */
export function resolveLicence(work: unknown): LicenceResult {
  if (!isObj(work)) return { ok: false, reason: 'catalogue record is not an object' }
  if (!Array.isArray(work.items)) return { ok: false, reason: 'catalogue record has no items' }
  const found: { id: string; label: string; url: string; manifest: string }[] = []
  for (const item of work.items) {
    if (!isObj(item) || !Array.isArray(item.locations)) continue
    for (const l of item.locations) {
      if (!isObj(l) || !isObj(l.locationType) || l.locationType.id !== 'iiif-presentation') continue
      const lic = isObj(l.license) ? l.license : undefined
      if (!lic || typeof lic.id !== 'string' || lic.id === '') return { ok: false, reason: 'iiif-presentation location has no license.id' }
      found.push({
        id: lic.id,
        label: typeof lic.label === 'string' ? lic.label : lic.id,
        url: typeof lic.url === 'string' ? lic.url : '',
        manifest: typeof l.url === 'string' ? l.url : '',
      })
    }
  }
  if (found.length === 0) return { ok: false, reason: 'no iiif-presentation location in the catalogue record' }
  const ids = new Set(found.map((f) => f.id))
  if (ids.size > 1) return { ok: false, reason: `iiif-presentation locations disagree on the licence: ${[...ids].join(', ')}` }
  const f = found[0]!
  if (!LICENCE_ALLOW.includes(f.id)) return { ok: false, reason: `licence ${f.id} is not in the allow-list (${LICENCE_ALLOW.join(', ')})` }
  return { ok: true, ...f }
}
