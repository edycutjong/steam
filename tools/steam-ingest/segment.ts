// steam-ingest segment <id> [--block n]: lines.json, region.json, runs.json, strips/, ownership/ (R5, R9, R11).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Lines, Source } from '../../src/data/schema.ts'
import { segmentRecipe, type SegmentFiles } from '../../src/ingest/segment.ts'
import { decodeJpeg, readPage, writeJson, writePng } from './io.ts'

export interface SegmentOutcome {
  files: SegmentFiles
  summary: string
  splits: number
}

/** Decoded page in the fixture frame recorded in source.json (R2.4). */
export function loadScan(dir: string) {
  const source = Source.parse(JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8')))
  const raw = decodeJpeg(readFileSync(join(dir, 'page.jpg')))
  return { source, scan: readPage(raw, source.frame ? { width: source.frame.width, height: source.frame.height } : undefined).scan }
}

export function segmentCmd(dir: string, opts: { block?: number } = {}): SegmentOutcome {
  if (!existsSync(join(dir, 'page.jpg')) || !existsSync(join(dir, 'source.json'))) throw new Error(`${dir}: page.jpg and source.json are needed (run steam-ingest fetch)`)
  const { scan } = loadScan(dir)
  const files = segmentRecipe(scan, opts)
  Lines.parse(files.lines)
  writeJson(join(dir, 'lines.json'), files.lines)
  writeJson(join(dir, 'region.json'), files.region)
  writeJson(join(dir, 'runs.json'), files.runs)
  writeJson(join(dir, 'ownership', 'splits.json'), files.splits)
  writePng(join(dir, 'ownership', 'overlay.png'), files.overlay)
  const strips = join(dir, 'strips')
  mkdirSync(strips, { recursive: true })
  for (const f of readdirSync(strips)) if (/^line-\d+\.png$/.test(f)) rmSync(join(strips, f))
  files.strips.forEach((s, i) => writePng(join(strips, `line-${i}.png`), s))
  return { files, summary: files.seg.summary, splits: files.seg.own.splits.length }
}

/** The measured figures of one segment run (R40.3). Never compared with a hand number in code. */
export function segmentMeasurements(sf: SegmentFiles) {
  const s = sf.seg
  return {
    lineCount: s.lines.length,
    pageLineCount: s.pageLineCount,
    blockCount: s.blocks.length,
    blockLineCounts: s.blocks.map((b) => b.lineCount),
    blockIndex: s.region.blockIndex,
    selectedBy: s.region.selectedBy,
    separators: s.separators.map((x) => ({ rows: [x.y0, x.y1], columns: [x.x0, x.x1], method: x.method })),
    region: { rows: [s.region.y0, s.region.y1], columns: [s.region.x0, s.region.x1] },
    marginaliaCount: s.marginalia.length,
    outsideRegionInkPx: s.outsideRegionInkPx,
    pitch: s.pitch,
    deskewDeg: s.deskewDeg,
    deskewApplied: s.deskewApplied,
    slant: s.slant.s,
    slantVertical: s.slant.vertical,
    splitCount: s.own.splits.length,
    segmentRun: sf.lines.segmentRun,
  }
}
