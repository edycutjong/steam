// steam-ingest fetch: licence first, then manifest, then the page (R3, R4). Network access goes through `get`.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Source } from '../../src/data/schema.ts'
import { resolveLicence } from '../../src/ingest/licence.ts'
import { canonicalJson, decodeJpeg } from './io.ts'

export interface Got {
  status: number
  body: Uint8Array
}
export type Get = (url: string) => Promise<Got>

export interface FetchTarget {
  workId: string
  canvasIndex: number
  page: string
}

/** Command-line defaults per known recipe (R4.3: fields may come from the command line). */
export const KNOWN: Record<string, FetchTarget> = {
  'quinces-marmalade': { workId: 'zgtk6n7e', canvasIndex: 33, page: 'p.23' },
}
/** R4.6, R39.3: the held-out page is never fetched. */
export const HELD_OUT = { manifestId: 'b18419665', canvasIndex: 27 }

export const catalogueUrl = (workId: string) => `https://api.wellcomecollection.org/catalogue/v2/works/${workId}?include=items`
export const imageUrl = (service: string) => `${service}/full/1600,/0/default.jpg`
export const FIXTURE_FRAME = { width: 1601, height: 2052 }

const json = (g: Got, what: string): unknown => {
  if (g.status !== 200) throw new Error(`${what}: HTTP ${g.status}`)
  try {
    return JSON.parse(new TextDecoder().decode(g.body))
  } catch {
    throw new Error(`${what}: the response is not JSON`)
  }
}

interface Manifest {
  '@id'?: string
  metadata?: { label: string; value: string }[]
  sequences?: { canvases?: ({ images?: { resource?: { service?: { '@id'?: string } } }[] } | null)[] }[]
}
const meta = (m: Manifest, label: string): string | undefined => m.metadata?.find((x) => x.label === label)?.value

export interface FetchResult {
  source: Source
  page: Uint8Array
  /** Size of the decoded download. */
  size: { width: number; height: number }
  licence: { id: string; label: string; url: string }
}

/** Resolves and downloads; writes nothing. Throws with a message naming the failure (fail closed). */
export async function fetchRecipe(t: FetchTarget, get: Get, retrieved: string): Promise<FetchResult> {
  const work = json(await get(catalogueUrl(t.workId)), 'catalogue request')
  const lic = resolveLicence(work)
  if (!lic.ok) throw new Error(`licence refused: ${lic.reason}`)
  if (!lic.manifest) throw new Error('the iiif-presentation location has no manifest url')
  if (lic.manifest.endsWith(`/${HELD_OUT.manifestId}`) && t.canvasIndex === HELD_OUT.canvasIndex) throw new Error('canvas 27 of b18419665 is the held-out page and is never fetched')
  const m = json(await get(lic.manifest), 'manifest request') as Manifest
  const canvas = m.sequences?.[0]?.canvases?.[t.canvasIndex]
  const service = canvas?.images?.[0]?.resource?.service?.['@id']
  if (!service) throw new Error(`manifest: canvas ${t.canvasIndex} has no image service`)
  const date = meta(m, 'Publication/creation')
  const shelfmark = meta(m, 'Reference')
  const attribution = meta(m, 'Attribution')
  if (!date || !shelfmark || !attribution) throw new Error('manifest: Publication/creation, Reference or Attribution metadata missing')
  const img = await get(imageUrl(service))
  if (img.status !== 200) throw new Error(`image request: HTTP ${img.status}`)
  const dec = decodeJpeg(img.body)
  const source: Source = {
    institution: attribution,
    shelfmark,
    workUrl: `https://wellcomecollection.org/works/${t.workId}`,
    manifest: lic.manifest,
    canvasIndex: t.canvasIndex,
    imageService: service,
    page: t.page,
    date: `${date} (IIIF manifest)`,
    licence: { id: lic.id, label: lic.label, url: lic.url },
    credit: attribution,
    retrieved,
    ...(dec.width !== FIXTURE_FRAME.width || dec.height !== FIXTURE_FRAME.height
      ? { frame: { width: FIXTURE_FRAME.width, height: FIXTURE_FRAME.height, scaleX: dec.width / FIXTURE_FRAME.width, scaleY: dec.height / FIXTURE_FRAME.height } }
      : {}),
  }
  return { source: Source.parse(source), page: img.body, size: { width: dec.width, height: dec.height }, licence: { id: lic.id, label: lic.label, url: lic.url } }
}

/** A `get` that serves the recorded fixtures and nothing else (R4.5). */
export function fixtureGet(root: string): Get {
  const work = readFileSync(join(root, 'fixtures/wellcome-work-zgtk6n7e.json'))
  const manifest = readFileSync(join(root, 'fixtures/wellcome-manifest-b18419665.trimmed.json'))
  const page = readFileSync(join(root, 'fixtures/p0033.jpg'))
  const m = JSON.parse(manifest.toString('utf8')) as Manifest
  const service = m.sequences![0]!.canvases![33]!.images![0]!.resource!.service!['@id']!
  return async (url) => {
    if (url === catalogueUrl('zgtk6n7e')) return { status: 200, body: work }
    if (url === 'https://iiif.wellcomecollection.org/presentation/v2/b18419665') return { status: 200, body: manifest }
    if (url === imageUrl(service)) return { status: 200, body: page }
    throw new Error(`--from-fixture: no recorded response for ${url}`)
  }
}

/** Writes page.jpg and source.json only after everything succeeded; existing files are replaced atomically (R4.4). */
export function writeFetched(dir: string, r: FetchResult): void {
  mkdirSync(dir, { recursive: true })
  const tmpPage = join(dir, '.page.jpg.tmp')
  const tmpSource = join(dir, '.source.json.tmp')
  writeFileSync(tmpPage, r.page)
  writeFileSync(tmpSource, canonicalJson(r.source))
  renameSync(tmpPage, join(dir, 'page.jpg'))
  renameSync(tmpSource, join(dir, 'source.json'))
}

export const hasPage = (dir: string) => existsSync(join(dir, 'page.jpg'))
