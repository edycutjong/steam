// The live-region composer: one string per batch of changes (R23.3, design 6.4). Pure.

import { ANNOUNCE } from '../copy/strings.ts'
import { parseReading, plainText } from '../data/reading.ts'
import type { Pace } from './scheduler.ts'

export type AnnounceCtx =
  | { kind: 'arrive' | 'wipe'; stepIndex: number; stepCount: number; stepText: string; note?: { span: string } | null }
  | { kind: 'resume' | 'deepLink'; stepIndex: number; stepCount: number }
  | { kind: 'pace'; pace: Pace }

/** `stepText` is the step's text with its †[a|b] markers; plain text names the second reader's reading. */
export function compose(ctx: AnnounceCtx): string {
  switch (ctx.kind) {
    case 'pace':
      return ANNOUNCE.pace[ctx.pace]
    case 'resume':
      return ANNOUNCE.resumed(ctx.stepIndex + 1, ctx.stepCount)
    case 'deepLink':
      return ANNOUNCE.started(ctx.stepIndex + 1, ctx.stepCount)
    case 'arrive':
    case 'wipe': {
      const base = ANNOUNCE.stepArrive(ctx.stepIndex + 1, ctx.stepCount, plainText(parseReading(ctx.stepText)))
      const withNote = ctx.note ? `${base} ${ANNOUNCE.noteHandwritten(ctx.note.span)}` : base
      return ctx.kind === 'wipe' ? ANNOUNCE.glassWiped + withNote : withNote
    }
  }
}
