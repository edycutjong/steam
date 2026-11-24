// steam-ingest merge <id>: writes transcription.md only when it is absent (R15.7).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Fallback, Lines, Reading, Scribe } from '../../src/data/schema.ts'
import { formatTranscription, mergeReadings, mergeSingle } from '../../src/ingest/merge.ts'
import { sha256 } from './io.ts'

export function freshTranscription(dir: string): string {
  const lines = Lines.parse(JSON.parse(readFileSync(join(dir, 'lines.json'), 'utf8')))
  const sp = join(dir, 'agent/scribe.json')
  const rp = join(dir, 'agent/second.json')
  const fp = join(dir, 'fallback/reading.json')
  if (existsSync(sp) && existsSync(rp)) {
    const a = readFileSync(sp)
    const b = readFileSync(rp)
    const m = mergeReadings(Scribe.parse(JSON.parse(a.toString('utf8'))), Reading.parse(JSON.parse(b.toString('utf8'))))
    return formatTranscription({ segmentRun: lines.segmentRun.id, readers: [sha256(a), sha256(b)] }, m.lines)
  }
  if (!existsSync(sp) && !existsSync(rp) && existsSync(fp)) {
    const f = readFileSync(fp)
    const h = sha256(f)
    return formatTranscription({ segmentRun: lines.segmentRun.id, readers: [h, h] }, mergeSingle(Fallback.parse(JSON.parse(f.toString('utf8')))).lines)
  }
  throw new Error('merge: needs agent/scribe.json and agent/second.json, or only fallback/reading.json')
}

export function mergeCmd(dir: string): { wrote: boolean; equal: boolean } {
  const fresh = freshTranscription(dir)
  const p = join(dir, 'transcription.md')
  if (!existsSync(p)) {
    writeFileSync(p, fresh)
    return { wrote: true, equal: true }
  }
  return { wrote: false, equal: readFileSync(p, 'utf8') === fresh }
}
