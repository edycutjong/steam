// Every fixed user-facing string lives here (cook-mode R25.1). Numbers appear only where a constant or a file produces them;
// the only digits in this file are those of the pace labels "×4" and "×12". The product title is the one place "Her" may appear.

export const PRODUCT = 'Her Hand in the Steam'
export const titleFor = (screen: string): string => `${screen} · ${PRODUCT}`

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** The Wipe control's labels (R14.1). */
export const WIPE = {
  next: 'Next step',
  show: 'Show the note',
  wipe: 'Wipe the glass',
  quoted: 'The hand, quoted',
  writing: 'The note is being written',
} as const

export const stepOf = (n: number, N: number): string => `Step ${n} of ${N}`
const FIRST_STEP = 1 // the deep link's fallback step, named so that no digit sits in a string

/** Live-region announcements (R23.3). Numbers come from the caller. */
export const ANNOUNCE = {
  stepArrive: (n: number, N: number, text: string): string => `${stepOf(n, N)}. ${text}`,
  noteHandwritten: (span: string): string => `The writer's note, handwritten: ${span}`,
  glassWiped: 'Glass wiped. ',
  resumed: (n: number, N: number): string => `Resumed at step ${n} of ${N}.`,
  started: (n: number, N: number): string => `Started at step ${n} of ${N}.`,
  pace: { 1: 'Pace real time', 4: 'Pace ×4', 12: 'Pace ×12' } as Record<1 | 4 | 12, string>,
  opening: 'Opening the glass…',
  openingShelf: 'Opening the shelf…',
  timing: (span: string, label: string): string => `${span}: ${label}`,
} as const

export const PACE = {
  names: { 1: 'Real time', 4: '×4', 12: '×12' } as Record<1 | 4 | 12, string>,
  valueText: { 1: 'Real time', 4: '×4 pace', 12: '×12 pace' } as Record<1 | 4 | 12, string>,
  badge: { 4: '×4 pace', 12: '×12 pace' } as Record<4 | 12, string>,
  knobLabel: 'Pace of the pot',
} as const

export const SHELF = {
  title: 'Recipes in a hand',
  intro: "Every note you'll see is the writer's own hand, photographed. Nothing is generated.",
  cook: 'Cook it',
  watch: 'Watch it at ×12',
  empty: 'No recipe could be loaded.',
  thumbAlt: (shelfmark: string, page: string): string => `The manuscript page, ${shelfmark} ${page}`,
  hint: (steps: number, notes: number): string =>
    `${steps} ${steps === 1 ? 'step' : 'steps'}. ${notes === 0 ? 'No note' : notes === 1 ? 'One note' : `${notes} notes`} in the writer's own words, shown in the writer's hand at ${notes === 1 ? 'its' : 'their'} step.`,
} as const

export const NOT_FOUND = { title: 'This recipe is not on the shelf', back: 'Back to the shelf' } as const

export const SLIP = {
  label: 'Archive slip',
  institution: 'Institution',
  shelfmark: 'Shelfmark',
  page: 'Page',
  date: 'Date',
  licence: 'Licence',
  credit: 'Credit',
  readProvenance: 'Read the provenance',
  hideProvenance: 'Hide the provenance',
  workUrl: 'Work',
  manifest: 'Manifest',
  canvas: 'Canvas',
  imageService: 'Image service',
  retrieved: 'Retrieved',
  readersKiro: 'Read by the Kiro readers, scribe and second-reader: two independent readings, merged by code.',
  readersFallback: (by: string): string => `Read by ${by} (fallback reading, not by the Kiro readers)`,
  disagreements: (n: number): string => `The readers disagree in ${n} ${plural(n, 'place', 'places')}.`,
  reviewedBy: (by: string, at: string): string => `Reviewed by: ${by}, ${at}`,
  ownership: (note: string, reviewer: string): string => `Ownership of ${note} reviewed by ${reviewer}`,
  boundaries: (by: string): string => `Word boundaries chosen by ${by}`,
  credit_line: (credit: string, licence: string): string => `${credit}, ${licence}`,
} as const

export const EDITION = {
  backToShelf: 'Back to the shelf',
  cook: 'Cook it',
  legend: '† marks a place where the two readers disagree; both readings are shown.',
  asMerged: 'as merged',
  judgementOn: (span: string): string => `Judgement note on this line: ${span}`,
  withheld: (n: number): string => `${n} ${plural(n, 'note', 'notes')} withheld: the source of the note could not be checked.`,
  marksName: (a: string, b: string): string => `Readings: “${a === '' ? 'nothing' : a}” or “${b === '' ? 'nothing' : b}”`,
  marksDescription: 'Two independent readers disagree on this word. The hand is shown as written.',
  transcription: 'Transcription',
  lineLabel: 'Line',
} as const

export const FACSIMILE = {
  alt: 'A photograph of the manuscript page. The transcription beside it gives the same words.',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  reset: 'Reset',
  viewport: 'The manuscript page. Plus and minus zoom, the arrow keys pan.',
} as const

export const TIMING = {
  earlier: 'Earlier',
  later: 'Later',
  reset: "Reset to the manuscript's",
  notSaved: 'Not saved on this device.',
  basis: 'Basis',
  open: 'Change the moment of this note',
} as const

export const COOK = {
  stepText: 'Step text',
  back: 'Back',
  mute: 'Mute',
  unmute: 'Unmute',
  noSound: 'This browser has no sound',
  startAgain: 'Start again',
  unknownNote: (N: number): string => `That note is not on this page. Started at step ${FIRST_STEP} of ${N}.`,
  scanFailed: 'The scan of this note could not be loaded.',
  typedTranscription: 'Typed transcription, not the hand',
  noKeep: 'This browser will not keep your place.',
  loading: 'Opening the glass…',
  noteQuoteLabel: "The writer's note, handwritten",
  slipUnder: 'Where the note comes from',
} as const

export const QUOTED = {
  title: 'The hand, quoted',
  verify: 'verify at source ↗',
  verifyName: 'Verify at source: opens the same pixels on the Wellcome Collection image server in a new tab',
  approximate: "The region is the note's bounding box on the original page and may take in a little of the lines beside it.",
  cookAgain: 'Cook again',
  backToEdition: 'Back to the page and its transcription',
  noteAlt: (span: string): string => `The writer's note, handwritten: ${span}`,
  step: (n: number): string => `Step ${n}`,
} as const

export const FOOT = { honest: 'Not generated. Quoted.' } as const
