// Reproducible ingest figures for docs/kiro-evidence/ingest/measurements.json (task 45, R39.2, R40.3).
// Usage: npx tsx scripts/measure-ingest.ts [recipe-id]
// Runs the pure gate in memory on the committed folder, with and without its ownership review, and writes the figures.
// It writes no recipe file and no gate.json; every number below is computed here or read from the committed files.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { contrastCrops, runGate, type GateCtx, type GateResult } from '../src/ingest/gate.ts'
import { contrast } from '../src/ingest/props.ts'
import { zhangSuen } from '../src/ingest/timeofink.ts'
import { loadScan } from '../tools/steam-ingest/segment.ts'
import { writeJson } from '../tools/steam-ingest/io.ts'

const root = new URL('../', import.meta.url).pathname
const id = process.argv[2] ?? 'quinces-marmalade'
const dir = join(root, 'content/recipes', id)
const txt = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : undefined)

function ctx(withReview: boolean): GateCtx {
  const files: Record<string, string | undefined> = { 'source.json': txt('source.json'), 'lines.json': txt('lines.json') }
  for (const f of ['agent/scribe.json', 'agent/second.json', 'fallback/reading.json', 'alignment.json', 'transcription.md']) files[f] = txt(f)
  if (withReview) files['ownership-review.json'] = txt('ownership-review.json')
  return {
    recipeId: id,
    pageBytes: readFileSync(join(dir, 'page.jpg')),
    scan: loadScan(dir).scan,
    files: files as GateCtx['files'],
    gold: readFileSync(join(root, 'fixtures/gold-readings.json'), 'utf8'),
    heroFixture: readFileSync(join(root, 'fixtures/hero-word-bounds.json'), 'utf8'),
  }
}

function figures(r: GateResult) {
  const g = r.gate
  return {
    state: r.state,
    results: Object.fromEntries(Object.entries(g.results ?? {}).map(([k, v]) => [k, v.pass])),
    segmentSplits: g.splits?.segmentSplits,
    splitShares: g.splits?.notes.map((n) => ({ note: n.noteId, share: n.share, splitPx: n.splitPx, maskPx: n.maskPx, status: n.status, flagged: n.flagged })),
    ownership: g.ownership,
    reviewed: g.reviewed ?? [],
    alignment: g.alignment?.map((a) => ({ note: a.noteId, alignment: a.alignment, granularity: a.granularity, parts: a.parts.map((p) => ({ line: p.line, method: p.method, s: p.s, auto: p.autoDetail })) })),
    recall: g.recall?.map((x) => ({
      note: x.noteId,
      threshold: x.threshold,
      shipped: { alignment: x.shipped.alignment, recall: x.shipped.recall, words: x.shipped.words },
      automatic: 'recall' in x.auto ? { recall: x.auto.recall, words: x.auto.words } : { notUsed: x.auto.notUsed, rejectedCandidate: x.auto.rejectedCandidate },
      frame: x.frame,
    })),
    pathCoverage: r.checks.map((c) => {
      let sk = 0
      for (const gi of c.p6.groups) sk += zhangSuen(gi.mask, c.p6.width, c.p6.height).reduce((a, b) => a + b, 0)
      return { note: c.noteId, pathPx: c.p6.trace.path.length, skeletonPx: sk }
    }),
    contrast: r.checks.map((c) => ({
      note: c.noteId,
      crops: contrastCrops(c.noteId, r.artifacts.png.get(c.pngPath)!, c.p5).map((k) => {
        const v = contrast(k)
        return { crop: k.name, size: [k.width, k.height], contrast: v.value, ...(v.reason ? { reason: v.reason } : {}) }
      }),
    })),
    litPx: Object.fromEntries([...r.artifacts.png].filter(([k]) => k.endsWith('.png') && !k.endsWith('.toi.png') && k.startsWith('notes/')).map(([k, v]) => [k, v.data.filter((_, i) => i % 4 === 3 && v.data[i]! > 0).length])),
    goldCheck: g.goldCheck,
  }
}

const p = join(root, 'docs/kiro-evidence/ingest/measurements.json')
const prev = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}
const lines = JSON.parse(txt('lines.json')!)
const out = {
  ...prev,
  gate: {
    source: `npx tsx scripts/measure-ingest.ts ${id} (pure runGate in memory on content/recipes/${id})`,
    lineCount: lines.lines.length,
    deskewDeg: lines.deskewDeg,
    deskewApplied: lines.deskewApplied,
    slant: lines.slant,
    readers: JSON.parse(txt('gate.json') ?? '{}').readers,
    automaticOwnership: figures(runGate(ctx(false))),
    ...(txt('ownership-review.json') ? { reviewedOwnership: figures(runGate(ctx(true))) } : {}),
  },
}
writeJson(p, out)
console.log(`measure-ingest: wrote ${p}`)
