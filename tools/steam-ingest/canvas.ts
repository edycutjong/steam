// steam-ingest canvas: records the manifest's canvas (id, width, height) in source.json (R21.1).
// source.json is not a gate input, so adding the field does not touch gate.json or the review's hash.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Source } from '../../src/data/schema.ts'
import { fixtureGet, type Get } from './fetch.ts'
import { writeJson } from './io.ts'

interface Canvas {
  '@id'?: string
  width?: number
  height?: number
  images?: { resource?: { service?: { '@id'?: string } } }[]
}

/** Reads the canvas at `source.canvasIndex` from the manifest and writes it into source.json. Throws, writing nothing, on any mismatch. */
export async function canvasCmd(root: string, id: string, o: { fromFixture?: boolean; get?: Get } = {}): Promise<{ canvas: NonNullable<Source['canvas']> }> {
  const path = join(root, 'content/recipes', id, 'source.json')
  const source = Source.parse(JSON.parse(readFileSync(path, 'utf8')))
  const get = o.get ?? (o.fromFixture ? fixtureGet(root) : undefined)
  if (!get) throw new Error('canvas: no network client; pass --from-fixture or inject one')
  const res = await get(source.manifest)
  if (res.status !== 200) throw new Error(`manifest request: HTTP ${res.status}`)
  const manifest = JSON.parse(new TextDecoder().decode(res.body)) as { sequences?: { canvases?: (Canvas | null)[] }[] }
  const c = manifest.sequences?.[0]?.canvases?.[source.canvasIndex]
  if (!c || !c['@id']) throw new Error(`manifest: canvas ${source.canvasIndex} is missing or has no id`)
  if (!Number.isInteger(c.width) || !Number.isInteger(c.height) || c.width! <= 0 || c.height! <= 0) throw new Error(`manifest: canvas ${source.canvasIndex} has no width or height`)
  if (c.images?.[0]?.resource?.service?.['@id'] !== source.imageService) throw new Error(`manifest: canvas ${source.canvasIndex} image service differs from source.imageService`)
  const canvas = { id: c['@id'], width: c.width!, height: c.height! }
  writeJson(path, Source.parse({ ...source, canvas }))
  return { canvas }
}
