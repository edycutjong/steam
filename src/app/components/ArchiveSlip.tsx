import { QUOTED, SLIP } from '../../copy/strings.ts'
import { regionUrl } from '../../data/provenance.ts'
import type { BundleNote, RecipeBundle } from '../../data/schema.ts'

/** `<credit>, <licence label>`, from the bundle (R3.3). */
export const creditLine = (b: RecipeBundle): string => SLIP.credit_line(b.source.credit, b.source.licence.label)

/** The reading line of R3.5. */
export function readersLine(b: RecipeBundle): string {
  const t = b.transcription
  return t.readers[0] === 'fallback' ? SLIP.readersFallback(t.by ?? '') : SLIP.readersKiro
}

interface Props {
  bundle: RecipeBundle
  /** The full provenance of R3.4. */
  expanded?: boolean
  /** Limits the ownership and word-boundary lines to these notes (default: every note of the bundle). */
  notes?: readonly BundleNote[]
  /** One line, for under the glass in Cook Mode. */
  compact?: boolean
  /** With `compact`: the revealed note, whose region on the archive's server gets a "verify at source" link (a2a-arch-r05 B10). */
  verifyNote?: BundleNote
  id?: string
  className?: string
}

/** The archive slip: where the scan comes from, in the archive's words (R3.1, R3.2). Every value is read from the bundle. */
export default function ArchiveSlip({ bundle, expanded = false, notes, compact = false, verifyNote, id, className = '' }: Props) {
  const s = bundle.source
  const list = notes ?? bundle.notes
  if (compact) {
    const verifyHref = verifyNote ? regionUrl(bundle, verifyNote) : null
    // One line under the glass: the same fields, run together (Cook Mode, R3.1).
    return (
      <section id={id} className={`slip slip--compact ${className}`} aria-label={SLIP.label}>
        <span>{s.institution}</span>
        <span>{s.shelfmark}</span>
        <span>{s.page}</span>
        <span>{s.date}</span>
        <a href={s.licence.url} target="_blank" rel="noopener noreferrer">
          {s.licence.label}
        </a>
        {verifyHref ? (
          <a className="slip__verify" href={verifyHref} target="_blank" rel="noopener noreferrer" aria-label={QUOTED.verifyName}>
            {QUOTED.verify}
          </a>
        ) : null}
      </section>
    )
  }
  return (
    <section id={id} className={`slip ${expanded ? 'slip--expanded' : ''} ${className}`} aria-label={SLIP.label}>
      <dl className="slip__grid">
        <div><dt>{SLIP.institution}</dt><dd>{s.institution}</dd></div>
        <div><dt>{SLIP.shelfmark}</dt><dd>{s.shelfmark}</dd></div>
        <div><dt>{SLIP.page}</dt><dd>{s.page}</dd></div>
        <div><dt>{SLIP.date}</dt><dd>{s.date}</dd></div>
        <div>
          <dt>{SLIP.licence}</dt>
          <dd><a href={s.licence.url} target="_blank" rel="noopener noreferrer">{s.licence.label}</a></dd>
        </div>
        <div><dt>{SLIP.credit}</dt><dd>{s.credit}</dd></div>
      </dl>
      {expanded ? (
        <div className="slip__more">
          <dl className="slip__grid slip__grid--long">
            <div><dt>{SLIP.workUrl}</dt><dd><a href={s.workUrl} target="_blank" rel="noopener noreferrer">{s.workUrl}</a></dd></div>
            <div><dt>{SLIP.manifest}</dt><dd><a href={s.manifest} target="_blank" rel="noopener noreferrer">{s.manifest}</a></dd></div>
            <div><dt>{SLIP.canvas}</dt><dd>{s.canvas?.id}</dd></div>
            <div><dt>{SLIP.imageService}</dt><dd>{s.imageService}</dd></div>
            <div><dt>{SLIP.retrieved}</dt><dd>{s.retrieved}</dd></div>
          </dl>
          <ul className="slip__lines">
            <li>{readersLine(bundle)}</li>
            <li>{SLIP.disagreements(bundle.transcription.disagreements.length)}</li>
            {bundle.review ? <li>{SLIP.reviewedBy(bundle.review.reviewedBy, bundle.review.reviewedAt)}</li> : null}
            {bundle.ownership.reviewed
              .filter((r) => list.some((n) => n.id === r.note))
              .map((r) => (
                <li key={r.note}>{SLIP.ownership(r.note, r.reviewer)}</li>
              ))}
            {list
              .filter((n) => n.alignmentBy)
              .map((n) => (
                <li key={n.id}>
                  {n.id}: {SLIP.boundaries(n.alignmentBy!)}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
