// The evidence frame set: both viewports at the same four moments (steam-renderer-v1 R22).
import { DESKTOP, PIXEL5 } from './capture.ts'
import type { Viewport } from './capture.ts'

export const MOMENTS = [-600, 2000, 4000, 6500] as const

export interface FrameSpec {
  name: string
  t: number
  viewport: Viewport
}

export const FRAMES: readonly FrameSpec[] = [
  ...MOMENTS.map((t) => ({ name: `desktop-t${t}`, t, viewport: DESKTOP })),
  ...MOMENTS.map((t) => ({ name: `mobile-t${t}`, t, viewport: PIXEL5 })),
]
