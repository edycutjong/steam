// The six gate properties as pure functions (design section 5). One implementation for the gate, CI and the browser.

import { PATH_COVERAGE_MIN, SPLIT_SHARE_MAX } from './constants.ts'
import type { Rgba } from './image.ts'
import type { NoteOwnership } from './masks.ts'
import { revealTimes, zhangSuen, type GroupInput, type Trace } from './timeofink.ts'

/** Bumped whenever the definition of a property changes (R30.8). */
export const PROPS_VERSION = '1'

export interface PropResult {
  pass: boolean
  detail: string
}

export interface P3Summary {
  result: PropResult
  /** Notes that pass on the automatic rule alone. */
  autoPass: number
  /** Notes that pass only because every flagged component has a decision (R13.5). */
  reviewedPass: number
}

const pct = (x: number): string => x.toFixed(4)

/** P3, per-note part (R12, R26.2 last clause, R26.3). */
export function checkP3Notes(notes: NoteOwnership[], opts: { staleReview?: boolean } = {}): P3Summary {
  const failing = notes.filter((n) => n.status === 'failed')
  const autoPass = notes.filter((n) => n.status === 'auto').length
  const reviewedPass = notes.filter((n) => n.status === 'reviewed').length
  if (failing.length) {
    const d = failing.map((n) => `${n.noteId}: split share ${pct(n.share)} over ${SPLIT_SHARE_MAX}, components ${n.flagged.join(',')}`)
    const head = opts.staleReview ? 'stale ownership review; joined strokes: needs review' : 'joined strokes: needs review'
    return { result: { pass: false, detail: `${head} (${d.join('; ')})` }, autoPass, reviewedPass }
  }
  const reviewed = notes.filter((n) => n.status === 'reviewed')
  const rev = reviewed.map((n) => `${n.noteId} reviewed (${n.flagged.length} components, by ${n.reviewers.join(', ')})`)
  return {
    result: { pass: true, detail: `${autoPass} auto${reviewed.length ? `, ${rev.join('; ')}` : ''}` },
    autoPass,
    reviewedPass,
  }
}

export interface P6Input {
  trace: Trace
  groups: GroupInput[]
  width: number
  height: number
  s: number
  /** The decoded toi.png: R = ink alpha, G = reveal time. */
  toi: Rgba
}

/**
 * P6 (R29): every pixel with R > 0 has G = round(255 t) for the time t of the trace, 0 <= t <= 1; times along the
 * path never decrease and group ranges are ordered; the path covers at least 95% of a freshly computed skeleton.
 */
export function checkP6(i: P6Input): PropResult {
  const { trace, width: w, height: h } = i
  const fails: string[] = []
  const support = new Uint8Array(w * h)
  for (let k = 0; k < w * h; k++) support[k] = i.toi.data[k * 4]! > 0 ? 1 : 0
  const rt = revealTimes(trace, i.groups, w, h, i.s, support)
  let n = 0
  let bad: string | null = null
  for (let y = 0; y < h && !bad; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x
      if (!support[k]) continue
      n++
      const t = rt.t[k]!
      if (!Number.isFinite(t) || t < 0 || t > 1) {
        bad = `pixel (${x},${y}) has no reveal time in [0,1]`
        break
      }
      const g = i.toi.data[k * 4 + 1]!
      if (g !== Math.round(255 * t)) {
        bad = `pixel (${x},${y}): G ${g} is not round(255 t) = ${Math.round(255 * t)}`
        break
      }
    }
  if (bad) fails.push(`quantised time: ${bad}`)
  for (let k = 1; k < trace.path.length; k++)
    if (trace.path[k]!.t < trace.path[k - 1]!.t) {
      fails.push(`path time decreases at path index ${k}`)
      break
    }
  trace.groups.forEach((g, k) => {
    if (!(0 <= g.t[0] && g.t[0] <= g.t[1] && g.t[1] <= 1)) fails.push(`group ${k} range [${g.t[0]}, ${g.t[1]}] is not within [0,1]`)
    if (k > 0 && trace.groups[k - 1]!.t[1] > g.t[0]) fails.push(`group ${k} starts before group ${k - 1} ends`)
  })
  const onPath = new Set(trace.path.map((p) => `${p.group}:${p.x},${p.y}`))
  let sk = 0
  let covered = 0
  const ordered = [...i.groups].sort((a, b) => a.line - b.line)
  ordered.forEach((g, gi) => {
    const fresh = zhangSuen(g.mask, w, h)
    for (let k = 0; k < fresh.length; k++)
      if (fresh[k]) {
        sk++
        if (onPath.has(`${gi}:${k % w},${Math.floor(k / w)}`)) covered++
      }
  })
  const coverage = sk === 0 ? 1 : covered / sk
  if (coverage < PATH_COVERAGE_MIN) fails.push(`path covers ${coverage.toFixed(3)} of the skeleton (needs ${PATH_COVERAGE_MIN})`)
  if (fails.length) return { pass: false, detail: fails.join('; ') }
  return { pass: true, detail: `${n} px timed, path coverage ${coverage.toFixed(3)}` }
}

// ---------------------------------------------------------------------------------------------------------------
// P1: structure (R24)

export interface P1Input {
  lineCount: number
  titleLine: number | null
  steps: { n: number; lineIdx: number[] }[]
  notes: { id: string; alignment: 'auto' | 'curator' | 'lines'; granularity: 'words' | 'lines' }[]
  masks: { noteId: string; granularity: 'words' | 'lines' }[]
}

/**
 * Every non-title line lies in exactly one step, no step names the title or an unknown line, every note has exactly one
 * mask whose granularity matches its alignment (`lines` if and only if the alignment is `lines`).
 */
export function checkP1(i: P1Input): PropResult {
  const fails: string[] = []
  const count = new Array<number>(Math.max(0, i.lineCount)).fill(0)
  for (const s of i.steps)
    for (const l of s.lineIdx) {
      if (!Number.isInteger(l) || l < 0 || l >= i.lineCount) fails.push(`step ${s.n} names unknown line ${l}`)
      else if (l === i.titleLine) fails.push(`step ${s.n} names the title line ${l}`)
      else count[l]!++
    }
  for (let l = 0; l < i.lineCount; l++) {
    if (l === i.titleLine) continue
    if (count[l] === 0) fails.push(`line ${l} is in no step`)
    else if (count[l]! > 1) fails.push(`line ${l} is in ${count[l]} steps`)
  }
  for (const n of i.notes) {
    const ms = i.masks.filter((m) => m.noteId === n.id)
    if (ms.length !== 1) fails.push(`note ${n.id} has ${ms.length} masks, needs exactly one`)
    else if ((ms[0]!.granularity === 'lines') !== (n.alignment === 'lines') || ms[0]!.granularity !== n.granularity)
      fails.push(`note ${n.id}: mask granularity ${ms[0]!.granularity} does not match alignment ${n.alignment}`)
  }
  for (const m of i.masks) if (!i.notes.some((n) => n.id === m.noteId)) fails.push(`mask ${m.noteId} belongs to no note`)
  return fails.length ? { pass: false, detail: fails.join('; ') } : { pass: true, detail: `${i.steps.length} steps cover ${i.lineCount - (i.titleLine === null ? 0 : 1)} lines; ${i.notes.length} notes, one mask each` }
}

// ---------------------------------------------------------------------------------------------------------------
// P2: inside the page (R25)

export interface P2Note {
  id: string
  /** Half-open bounding box [x0, y0, x1, y1] of the mask pixels, null for an empty mask. */
  maskBox: [number, number, number, number] | null
  pageBox: [number, number, number, number]
  /** Width and height of the PNG. */
  png: [number, number]
}

export function checkP2(page: { width: number; height: number }, notes: P2Note[]): PropResult {
  const fails: string[] = []
  const { width: W, height: H } = page
  for (const n of notes) {
    const [bx0, by0, bx1, by1] = n.pageBox
    if (bx0 < 0 || by0 < 0 || bx1 > W || by1 > H || bx0 >= bx1 || by0 >= by1) fails.push(`${n.id}: pageBox [${n.pageBox.join(',')}] is not inside the ${W}x${H} page`)
    if (!n.maskBox) fails.push(`${n.id}: the mask is empty`)
    else {
      const [mx0, my0, mx1, my1] = n.maskBox
      if (mx0 < 0 || my0 < 0 || mx1 > W || my1 > H) fails.push(`${n.id}: mask pixel outside the page at [${n.maskBox.join(',')}]`)
      if (mx0 < bx0 || my0 < by0 || mx1 > bx1 || my1 > by1) fails.push(`${n.id}: mask [${n.maskBox.join(',')}] is not inside its pageBox`)
    }
    if (n.png[0] !== bx1 - bx0 || n.png[1] !== by1 - by0) fails.push(`${n.id}: PNG ${n.png[0]}x${n.png[1]} is not the size of its pageBox ${bx1 - bx0}x${by1 - by0}`)
  }
  return fails.length ? { pass: false, detail: fails.join('; ') } : { pass: true, detail: `${notes.length} notes inside the ${W}x${H} page` }
}

/** Half-open bounding box of a 0/1 mask, null when empty. */
export function maskBox(mask: Uint8Array, w: number, h: number): [number, number, number, number] | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]
}

// ---------------------------------------------------------------------------------------------------------------
// P3: ownership (R26), the full evaluator

import type { Labels } from './components.ts'
import type { Bands, Ownership } from './masks.ts'
import { MIN_COMPONENT_PX } from './constants.ts'

export interface P3Input {
  labels: Labels
  own: Ownership
  bands: Bands
  notes: NoteOwnership[]
  staleReview?: boolean
}

/**
 * R26.2: every ink pixel has exactly one owner and no other pixel has one; every component of at least 30 px is owned
 * by one line or cut only at valley rows (a reviewed component is judged by its decision instead); and every note is
 * within the split threshold or reviewed (checkP3Notes).
 */
export function checkP3(i: P3Input): P3Summary {
  const notes = checkP3Notes(i.notes, { staleReview: i.staleReview })
  const fails: string[] = []
  const { labels, own, bands } = i
  const n = labels.width * labels.height
  let unowned = 0
  let stray = 0
  for (let k = 0; k < n; k++) {
    const ink = labels.label[k]! >= 0
    if (ink && own.owner[k]! < 0) unowned++
    if (!ink && own.owner[k]! >= 0) stray++
  }
  if (unowned) fails.push(`${unowned} ink pixels have no owner`)
  if (stray) fails.push(`${stray} non-ink pixels have an owner`)
  // per component: owner changes only across valley rows
  const rows = new Map<number, Map<number, number>>() // id -> row -> owner of the first pixel of that row (and a flag for mixed rows)
  const mixed = new Set<number>()
  for (let y = 0; y < labels.height; y++)
    for (let x = 0; x < labels.width; x++) {
      const id = labels.label[y * labels.width + x]!
      if (id < 0) continue
      const c = own.components.get(id)!
      if (c.size < MIN_COMPONENT_PX || c.reviewed) continue
      let r = rows.get(id)
      if (!r) rows.set(id, (r = new Map()))
      const o = own.owner[y * labels.width + x]!
      const prev = r.get(y)
      if (prev === undefined) r.set(y, o)
      else if (prev !== o) mixed.add(id)
    }
  const bad: number[] = []
  for (const [id, r] of rows) {
    const c = own.components.get(id)!
    if (c.touched.length === 0) continue // centroid rule: one owner for the whole component
    if (mixed.has(id)) {
      bad.push(id)
      continue
    }
    const ys = [...r.keys()].sort((a, b) => a - b)
    for (let k = 1; k < ys.length; k++) {
      if (r.get(ys[k]!) !== r.get(ys[k - 1]!) && !bands.valleys.some((v) => ys[k - 1]! < v && ys[k]! >= v)) {
        bad.push(id)
        break
      }
    }
    if (c.touched.length === 1 && new Set(r.values()).size > 1) bad.push(id)
  }
  if (bad.length) fails.push(`components ${[...new Set(bad)].join(',')} are cut away from a valley row`)
  if (fails.length) return { result: { pass: false, detail: fails.join('; ') }, autoPass: notes.autoPass, reviewedPass: notes.reviewedPass }
  return { ...notes, result: { pass: notes.result.pass, detail: notes.result.detail } }
}

// ---------------------------------------------------------------------------------------------------------------
// P4: note fidelity and recall (R27)

import { shearedColumn } from './runs.ts'
import { NOTE_FAINT_REACH_PX } from './constants.ts'

export interface P4Part {
  line: number
  /** Sheared boundary columns of the line's words; null for a whole line. */
  boundaries: number[] | null
  fromWord: number
  toWord: number
  /** Core-band middle of the line (page rows). */
  yMid: number
}

export interface P4Input {
  noteId: string
  width: number
  height: number
  /** Line per page pixel, -1 where there is no owned ink. */
  owner: Int16Array
  /** Every binarised ink pixel of the page, owned or not. */
  pageInk: Uint8Array
  s: number
  parts: P4Part[]
  /** The decoded note-<id>.png and where it sits in the page. */
  png: Rgba
  pageBox: [number, number, number, number]
  /** Present when the note is scored against a fixture (R27.4). */
  recall?: { value: number; threshold: number }
}

/** The note mask stated from the owner map and the word regions alone (no use of the build's own mask). */
export function independentMask(i: Pick<P4Input, 'width' | 'height' | 'owner' | 's' | 'parts'>): Uint8Array {
  const { width: w, height: h } = i
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = i.owner[y * w + x]!
      if (o < 0) continue
      const part = i.parts.find((p) => p.line === o)
      if (!part) continue
      if (part.boundaries) {
        const c = shearedColumn(x, y, part.yMid, i.s)
        let j = 0
        while (j < part.boundaries.length && c > part.boundaries[j]!) j++
        if (j < part.fromWord || j > part.toWord) continue
      }
      m[y * w + x] = 1
    }
  return m
}

/**
 * Every pixel with alpha > 0 is a mask pixel (owned by a quoted line, inside its word region when aligned), or a
 * non-ink pixel within 2 px of the mask and more than 1 px from any ink pixel outside the mask (design 3.6).
 * Scored notes also need recall >= the fixture's threshold.
 */
export function checkP4(i: P4Input): PropResult {
  const { width: W, height: H } = i
  const mask = independentMask(i)
  const [bx0, by0] = i.pageBox
  const R = NOTE_FAINT_REACH_PX
  const fails: string[] = []
  let foreign = 0
  let outside = 0
  let faintBad = 0
  let first = ''
  let lit = 0
  for (let y = 0; y < i.png.height; y++)
    for (let x = 0; x < i.png.width; x++) {
      if (!i.png.data[(y * i.png.width + x) * 4 + 3]) continue
      lit++
      const gx = x + bx0
      const gy = y + by0
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) {
        outside++
        continue
      }
      const g = gy * W + gx
      if (mask[g]) continue
      const o = i.owner[g]!
      if (o >= 0 || i.pageInk[g]) {
        foreign++
        if (!first) first = `(${gx},${gy}) is ink ${o >= 0 ? `owned by line ${o}` : 'not owned by any line'}${o >= 0 && i.parts.some((p) => p.line === o) ? ' outside the quoted words' : ''}`
        continue
      }
      let nearMask = false
      let nearOther = false
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = gx + dx
          const yy = gy + dy
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue
          const q = yy * W + xx
          if (mask[q]) nearMask = true
          else if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (i.owner[q]! >= 0 || i.pageInk[q])) nearOther = true
        }
      if (!nearMask || nearOther) {
        faintBad++
        if (!first) first = `(${gx},${gy}) is a non-ink pixel ${nearMask ? 'within 1 px of ink outside the note' : 'farther than 2 px from the note'}`
      }
    }
  if (outside) fails.push(`${outside} lit pixels outside the page`)
  if (foreign) fails.push(`${foreign} lit pixels are ink not owned by the quoted words`)
  if (faintBad) fails.push(`${faintBad} lit non-ink pixels break the 2 px / 1 px rule`)
  if (first) fails.push(`first: ${first}`)
  if (i.recall && !(i.recall.value >= i.recall.threshold)) fails.push(`recall ${i.recall.value.toFixed(4)} under the fixture threshold ${i.recall.threshold}`)
  if (fails.length) return { pass: false, detail: `${i.noteId}: ${fails.join('; ')}` }
  return { pass: true, detail: `${i.noteId}: ${lit} lit px, all owned by the quoted words or within the shell${i.recall ? `; recall ${i.recall.value.toFixed(4)} >= ${i.recall.threshold}` : ''}` }
}
