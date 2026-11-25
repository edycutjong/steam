import { z } from 'zod'
import type { DeadlineTimers } from '../data/deadline.ts'

const Int = z.number().int()

const Rect = z
  .tuple([Int, Int, Int, Int])
  .refine((r) => r[2] > r[0] && r[3] > r[1], { message: 'rect must have positive width and height' })

const Group = z.object({
  line: Int,
  rect: Rect,
  coreBand: z
    .tuple([Int, Int])
    .refine((b) => b[1] > b[0], { message: 'coreBand must be increasing' }),
  t: z
    .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
    .refine((t) => t[1] > t[0], { message: 't must be increasing' }),
  inkPx: Int.nonnegative(),
})

/** Unknown keys (the bundle's `words`, `alignment`, `trace`, `verifyUrl` and the like) are stripped. */
export const NoteMeta = z
  .object({
    noteId: z.string().min(1),
    /** The words shown in the glass (the quoted words with their trailing punctuation). */
    shownText: z.string().min(1),
    source: z.string().min(1),
    size: z.tuple([Int.positive(), Int.positive()]),
    pageBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    groups: z.array(Group).min(1),
  })
  .superRefine((m, ctx) => {
    const [w, h] = m.size
    m.groups.forEach((g, i) => {
      const [x0, y0, x1, y1] = g.rect
      if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) {
        ctx.addIssue({ code: 'custom', path: ['groups', i, 'rect'], message: 'rect lies outside size' })
      }
      if (g.coreBand[0] < y0 || g.coreBand[1] > y1) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', i, 'coreBand'],
          message: 'coreBand lies outside the rect y-range',
        })
      }
      if (i > 0 && g.t[0] < m.groups[i - 1].t[1]) {
        ctx.addIssue({
          code: 'custom',
          path: ['groups', i, 't'],
          message: 'group time ranges must be sorted and must not overlap',
        })
      }
    })
  })

export type NoteMeta = z.infer<typeof NoteMeta>

export class AssetError extends Error {
  readonly field: string
  constructor(field: string, message: string, options?: ErrorOptions) {
    super(`${field}: ${message}`, options)
    this.name = 'AssetError'
    this.field = field
  }
}

export interface NoteAssets {
  meta: NoteMeta
  /** RGBA, decoded without premultiplication or colour conversion. */
  note: ImageBitmap
  /** RGB bytes of the time-of-ink PNG (R ink alpha, G reveal time, B pressure). */
  toi: ImageData
  /** RGBA bytes of the note, read back for derive.ts. */
  noteData: ImageData
}

const DECODE: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }

async function fetchOk(url: string, field: string, signal?: AbortSignal): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new AssetError(field, `could not fetch ${url}`, { cause: e })
  }
  if (!res.ok) throw new AssetError(field, `${url} answered ${res.status}`)
  return res
}

function readBytes(bitmap: ImageBitmap): ImageData {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new AssetError('canvas', 'a 2D context is not available')
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
}

async function decode(url: string, field: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const res = await fetchOk(url, field, signal)
  try {
    return await createImageBitmap(await res.blob(), DECODE)
  } catch (e) {
    throw new AssetError(field, `could not decode ${url}`, { cause: e })
  }
}

/** What the bundle says about the note; the note's own JSON must agree (R15.3). */
export interface NoteCheck {
  noteId: string
  size: readonly [number, number]
}

/**
 * `stem` is the URL without extension, for example `/recipes/<id>/note-<noteId>`.
 * It loads `<stem>.json`, `<stem>.png` and `<stem>.toi.png`. With `check`, the JSON's `noteId` and `size` must equal the bundle's.
 */
export async function loadNoteAssets(stem: string, check?: NoteCheck, signal?: AbortSignal, _opts: { timers?: DeadlineTimers } = {}): Promise<NoteAssets> {
  const jsonRes = await fetchOk(`${stem}.json`, 'meta', signal)
  let raw: unknown
  try {
    raw = await jsonRes.json()
  } catch (e) {
    throw new AssetError('meta', 'not valid JSON', { cause: e })
  }
  const parsed = NoteMeta.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AssetError(`meta.${issue.path.join('.')}`, issue.message)
  }
  const meta = parsed.data
  if (check && meta.noteId !== check.noteId) throw new AssetError('meta.noteId', `${meta.noteId} is not the bundle's note ${check.noteId}`)
  if (check && (meta.size[0] !== check.size[0] || meta.size[1] !== check.size[1])) {
    throw new AssetError('meta.size', `${meta.size.join('x')} differs from the bundle's ${check.size.join('x')}`)
  }

  const [note, toiBitmap] = await Promise.all([
    decode(`${stem}.png`, 'note', signal),
    decode(`${stem}.toi.png`, 'toi', signal),
  ])
  const [w, h] = meta.size
  if (note.width !== w || note.height !== h) {
    throw new AssetError('note', `size ${note.width}x${note.height} differs from meta.size ${w}x${h}`)
  }
  if (toiBitmap.width !== w || toiBitmap.height !== h) {
    throw new AssetError('toi', `size ${toiBitmap.width}x${toiBitmap.height} differs from meta.size ${w}x${h}`)
  }
  const noteData = readBytes(note)
  const toi = readBytes(toiBitmap)
  toiBitmap.close()
  return { meta, note, toi, noteData }
}
