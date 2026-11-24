// Every fixed user-facing string lives here (cook-mode R25.1). Numbers appear only where a constant or a file produces them.

/** The Wipe control's labels (R14.1). */
export const WIPE = {
  next: 'Next step',
  show: 'Show the note',
  wipe: 'Wipe the glass',
  quoted: 'The hand, quoted',
} as const

/** Live-region announcements (R23.3). Numbers come from the caller. */
export const stepOf = (n: number, N: number): string => `Step ${n} of ${N}`
export const ANNOUNCE = {
  stepArrive: (n: number, N: number, text: string): string => `${stepOf(n, N)}. ${text}`,
  noteHandwritten: (span: string): string => `The writer's note, handwritten: ${span}`,
  glassWiped: 'Glass wiped. ',
  resumed: (n: number, N: number): string => `Resumed at step ${n} of ${N}.`,
  started: (n: number, N: number): string => `Started at step ${n} of ${N}.`,
  pace: { 1: 'Pace real time', 4: 'Pace ×4', 12: 'Pace ×12' } as Record<1 | 4 | 12, string>,
  opening: 'Opening the glass…',
} as const
