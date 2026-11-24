import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Source } from '../../src/data/schema.ts'
import { canvasCmd } from './canvas.ts'
import { main } from './cli.ts'

// Test fixtures: a throwaway root holding a copy of the real source.json and the recorded manifest.
const root = mkdtempSync(join(tmpdir(), 'canvas-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const dir = join(root, 'content/recipes/quinces-marmalade')
mkdirSync(dir, { recursive: true })
cpSync('fixtures', join(root, 'fixtures'), { recursive: true })
const { canvas: _c, ...withoutCanvas } = JSON.parse(readFileSync('content/recipes/quinces-marmalade/source.json', 'utf8'))
writeFileSync(join(dir, 'source.json'), JSON.stringify(withoutCanvas))
const sourceBytes = JSON.stringify(withoutCanvas)
const manifestPath = join(root, 'fixtures/wellcome-manifest-b18419665.trimmed.json')

describe('Source.canvas (R21.1)', () => {
  const base = JSON.parse(sourceBytes)
  it('accepts a file without canvas', () => expect(Source.safeParse(base).success).toBe(true))
  it('accepts a canvas with a non-empty id and positive integer size', () => {
    expect(Source.safeParse({ ...base, canvas: { id: 'c', width: 3695, height: 4737 } }).success).toBe(true)
  })
  it.each([{ id: '', width: 1, height: 1 }, { id: 'c', width: 0, height: 1 }, { id: 'c', width: 1.5, height: 1 }, { id: 'c', width: 1 }])('rejects %j', (canvas) => {
    expect(Source.safeParse({ ...base, canvas }).success).toBe(false)
  })
})

describe('canvasCmd', () => {
  it('writes canvas from the manifest and changes nothing else', async () => {
    const r = await canvasCmd(root, 'quinces-marmalade', { fromFixture: true })
    expect(r.canvas).toEqual({ id: 'https://iiif.wellcomecollection.org/presentation/b18419665/canvases/b18419665_MS_1810_0033.JP2', width: 3695, height: 4737 })
    const after = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'))
    const { canvas, ...rest } = after
    expect(canvas).toEqual(r.canvas)
    expect(rest).toEqual(JSON.parse(sourceBytes))
  })
  it('refuses a manifest whose canvas has no width or height', async () => {
    const m = JSON.parse(readFileSync('fixtures/wellcome-manifest-b18419665.trimmed.json', 'utf8'))
    delete m.sequences[0].canvases[32].width
    writeFileSync(manifestPath, JSON.stringify(m))
    await expect(canvasCmd(root, 'quinces-marmalade', { fromFixture: true })).rejects.toThrow(/width or height/)
  })
  it('refuses a canvas whose image service differs from source.imageService', async () => {
    const m = JSON.parse(readFileSync('fixtures/wellcome-manifest-b18419665.trimmed.json', 'utf8'))
    m.sequences[0].canvases[32].images[0].resource.service['@id'] = 'https://iiif.example.org/image/other'
    writeFileSync(manifestPath, JSON.stringify(m))
    await expect(canvasCmd(root, 'quinces-marmalade', { fromFixture: true })).rejects.toThrow(/image service/)
    cpSync('fixtures/wellcome-manifest-b18419665.trimmed.json', manifestPath)
  })
  it('the committed source.json carries the canvas of the real manifest', () => {
    const s = Source.parse(JSON.parse(readFileSync('content/recipes/quinces-marmalade/source.json', 'utf8')))
    expect(s.canvas).toEqual({ id: 'https://iiif.wellcomecollection.org/presentation/b18419665/canvases/b18419665_MS_1810_0033.JP2', width: 3695, height: 4737 })
  })
})

describe('cli canvas', () => {
  it('prints a one-line usage and exits 2 on bad arguments', async () => {
    expect(await main(['canvas'], root)).toBe(2)
    expect(await main(['canvas', 'Bad_ID'], root)).toBe(2)
  })
  it('runs for the recipe from the fixture and exits 0', async () => {
    expect(await main(['canvas', 'quinces-marmalade', '--from-fixture'], root)).toBe(0)
  })
})
