// Frozen numbers of the ingest pipeline (design section 4, R39.5).
// Pixel sizes are stated for a page frame 1600 px wide and scale with scaleOf(frame).
// A value here is never changed to make a page pass; the table records why it has its value and which commit froze it.

export const SAUVOLA_WINDOW = 41
export const SAUVOLA_K = 0.2
export const SAUVOLA_R = 128
export const INK_MEDIAN_GUARD = 25
export const MIN_COMPONENT_PX = 30
/**
 * Least owned ink (pixels of components that are not specks) a word box must hold for a word alignment to be believed.
 * Equal to MIN_COMPONENT_PX on purpose: a word holds at least as much ink as the smallest thing the pipeline counts as a
 * piece of writing. Not tuned: fixed in the first commit of the word-align-speck spec, before the page was re-measured.
 */
export const WORD_INK_MIN_PX = MIN_COMPONENT_PX
/**
 * Largest factor by which a word's share of the line's width may differ from its share of the line's characters, either
 * way (word-cut-inside-word, design 3.5). Fixed in the spec's first commit, before the page was measured with it.
 */
export const WORD_SHAPE_RATIO_MAX = 2
export const CORE_FRACTION = 0.6
export const PROFILE_SIGMA = 6
export const PEAK_MIN_FRACTION = 0.25
export const PEAK_MIN_DISTANCE = 40
export const SPLIT_SHARE_MAX = 0.02
export const RUN_MIN_PX = 4
export const RUN_RATIO = 1.5
export const CONTRAST_MIN = 40
export const PATH_COVERAGE_MIN = 0.95
export const NOTE_MARGIN_PX = 32
export const ALPHA_DARKNESS_RANGE = 90
export const PAPER_WINDOW = 31
export const DESKEW_RANGE_DEG = 5
export const DESKEW_STEP = 0.1
export const DESKEW_APPLY_MIN = 0.5
export const SLANT_RANGE: readonly [number, number] = [-0.5, 0.8]
export const SLANT_STEP = 0.05
export const SLANT_ZERO_BELOW = 0.05
export const LICENCE_ALLOW: readonly string[] = ['pdm', 'cc0', 'cc-by']
/** Pixels (at 1600 px frame width) around an owned component within which faint ink joins are kept (addendum, design 3.6). */
export const NOTE_FAINT_REACH_PX = 2

export interface ConstantRow {
  name: string
  value: unknown
  reason: string
  source: string
  /** Short hash of the commit that froze the value. */
  frozenBy: string
}

const F = '43aa1f6' // "[kiro] ingest-pipeline: requirements, design, tasks"
const row = (name: string, value: unknown, reason: string, source: string, frozenBy: string = F): ConstantRow => ({ name, value, reason, source, frozenBy })

export const CONSTANTS_TABLE: readonly ConstantRow[] = [
  row('SAUVOLA_WINDOW', SAUVOLA_WINDOW, 'one documented threshold for ink', 'request, spike'),
  row('SAUVOLA_K', SAUVOLA_K, 'Sauvola sensitivity', 'request, spike'),
  row('SAUVOLA_R', SAUVOLA_R, 'Sauvola dynamic range', 'request, spike'),
  row('INK_MEDIAN_GUARD', INK_MEDIAN_GUARD, 'keeps paper texture out of the ink map', 'spike'),
  row('MIN_COMPONENT_PX', MIN_COMPONENT_PX, 'specks do not create lines or count as pieces', 'request'),
  row('WORD_INK_MIN_PX', WORD_INK_MIN_PX, 'a word box holds at least one piece of writing: alignment is rejected when any word box holds less (word-align-speck)', 'this spec (word-align-speck), = MIN_COMPONENT_PX, not tuned', '676fb65'),
  row('WORD_SHAPE_RATIO_MAX', WORD_SHAPE_RATIO_MAX, 'a word is at most 2x wider or narrower than its share of the line\'s characters predicts; otherwise the cut is implausible (word-cut-inside-word)', 'this spec (word-cut-inside-word), fixed before measuring, not tuned', '399ac56'),
  row('CORE_FRACTION', CORE_FRACTION, 'core band = rows at or above 60% of the line peak', 'request'),
  row('PROFILE_SIGMA', PROFILE_SIGMA, 'row projection smoothing', 'spike'),
  row('PEAK_MIN_FRACTION', PEAK_MIN_FRACTION, 'peak height floor against the global maximum', 'spike'),
  row('PEAK_MIN_DISTANCE', PEAK_MIN_DISTANCE, 'two peaks closer than this are one line', 'spike'),
  row('SPLIT_SHARE_MAX', SPLIT_SHARE_MAX, 'share of a note cut from joined strokes that may pass without review', 'product constitution'),
  row('RUN_MIN_PX', RUN_MIN_PX, 'narrowest zero-ink run that can be a word gap', 'request'),
  row('RUN_RATIO', RUN_RATIO, 'k-1 th run must be 1.5x the median of the unselected runs', 'request'),
  row('CONTRAST_MIN', CONTRAST_MIN, 'paper minus ink luminance, of 255', 'request'),
  row('PATH_COVERAGE_MIN', PATH_COVERAGE_MIN, 'traced path must cover 95% of the skeleton', 'request'),
  row('NOTE_MARGIN_PX', NOTE_MARGIN_PX, 'renderer needs at least 24 px transparent margin', 'spike'),
  row('ALPHA_DARKNESS_RANGE', ALPHA_DARKNESS_RANGE, 'paper minus darkest ink luminance used to normalise alpha', 'spike'),
  row('PAPER_WINDOW', PAPER_WINDOW, 'local paper estimate window', 'spike'),
  row('DESKEW_RANGE_DEG', DESKEW_RANGE_DEG, 'tilt search range', 'this spec'),
  row('DESKEW_STEP', DESKEW_STEP, 'tilt search step', 'this spec'),
  row('DESKEW_APPLY_MIN', DESKEW_APPLY_MIN, 'below this angle the frame is kept and the angle only recorded', 'this spec'),
  row('SLANT_RANGE', SLANT_RANGE, 'shear search range', 'this spec'),
  row('SLANT_STEP', SLANT_STEP, 'shear search step', 'this spec'),
  row('SLANT_ZERO_BELOW', SLANT_ZERO_BELOW, 'below this the page counts as vertical', 'this spec'),
  row('LICENCE_ALLOW', LICENCE_ALLOW, 'only open material is ingested', 'request'),
  row('NOTE_FAINT_REACH_PX', NOTE_FAINT_REACH_PX, 'faint hairline joins within 2 px of owned components stay in the note alpha (design 3.6)', 'renderer round-3 review'),
]
