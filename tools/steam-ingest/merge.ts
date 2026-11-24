// steam-ingest merge <id>: writes transcription.md only when it is absent (R15.7).

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Fallback, Lines, Reading, Scribe } from '../../src/data/schema.ts'
import { classifyTranscription, formatTranscription, mergeReadings, mergeSingle, parseTranscription } from '../../src/ingest/merge.ts'
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

export type MergeState = 'missing' | 'current' | 'regenerated' | 'revised'

/** R15.7, R16.2: write when missing, regenerate when stale and unrevised, leave a current or revised file alone. */
export function mergeCmd(dir: string): { wrote: boolean; equal: boolean; state: MergeState } {
  const fresh = freshTranscription(dir)
  const p = join(dir, 'transcription.md')
  if (!existsSync(p)) {
    writeFileSync(p, fresh)
    return { wrote: true, equal: true, state: 'missing' }
  }
  const have = readFileSync(p, 'utf8')
  const f = parseTranscription(fresh)
  if (!f.ok) throw new Error(f.error)
  const cls = classifyTranscription(have, { segmentRun: f.header.segmentRun, readers: f.header.readers }, fresh)
  if (cls.state === 'stale' && !cls.revised) {
    writeFileSync(p, fresh)
    return { wrote: true, equal: true, state: 'regenerated' }
  }
  return { wrote: false, equal: have === fresh, state: cls.state === 'stale' ? 'revised' : 'current' }
}
