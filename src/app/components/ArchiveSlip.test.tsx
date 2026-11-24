// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { css, loaded, mount, text, unmountAll } from '../render.fixture.tsx'
import ArchiveSlip, { creditLine } from './ArchiveSlip.tsx'

afterEach(unmountAll)
const r = loaded()

describe('ArchiveSlip (R3.1 to R3.9)', () => {
  it('shows institution, shelfmark, page, date and the licence linked to its url, from the bundle', () => {
    const host = mount(<ArchiveSlip bundle={r.bundle} />)
    const t = text(host)
    for (const v of ['Wellcome Collection', 'MS.1810', 'p.23', 'c. 1750 (IIIF manifest)', 'Public Domain Mark']) expect(t).toContain(v)
    const a = host.querySelector('a')!
    expect(a.textContent).toBe('Public Domain Mark')
    expect(a.getAttribute('href')).toBe(r.bundle.source.licence.url)
  })
  it('the credit line is built from the bundle', () => {
    expect(creditLine(r.bundle)).toBe('Wellcome Collection, Public Domain Mark')
    const b = loaded((x) => { x.source.credit = 'Elsewhere'; x.source.licence.label = 'CC0' })
    expect(creditLine(b.bundle)).toBe('Elsewhere, CC0')
  })
  it('is set in DM Mono caps on a --rule hairline (class and rule)', () => {
    const host = mount(<ArchiveSlip bundle={r.bundle} />)
    expect(host.querySelector('section')!.classList.contains('slip')).toBe(true)
    const rule = /\.slip\s*\{[^}]*\}/.exec(css('src/app/app.css'))![0]
    expect(rule).toMatch(/font-family:\s*var\(--face-data\)/)
    expect(rule).toMatch(/border-top:\s*var\(--hair\)/)
    expect(rule).toMatch(/text-transform:\s*uppercase/)
    expect(rule).toMatch(/letter-spacing:\s*0\.08em/)
    expect(css('src/app/app.css')).toMatch(/--hair:\s*1px solid var\(--rule\)/)
    expect(css('src/app/app.css')).toMatch(/--face-data:\s*'DM Mono'/)
  })
  it('expanded: work URL, manifest, canvas, image service, retrieved date and the recorded lines, verbatim', () => {
    const t = text(mount(<ArchiveSlip bundle={r.bundle} expanded />))
    for (const v of [r.bundle.source.workUrl, r.bundle.source.manifest, r.bundle.source.canvas!.id, r.bundle.source.imageService, r.bundle.source.retrieved]) expect(t).toContain(v)
    expect(t).toContain('Read by the Kiro readers, scribe and second-reader: two independent readings, merged by code.')
    expect(t).toContain(`The readers disagree in ${r.bundle.transcription.disagreements.length} places.`)
    expect(t).toContain('Reviewed by: Claude Code builder agent (autopilot P1b), not a human, 2026-11-25')
    expect(t).toContain('Ownership of full-ripe reviewed by Kiro (agent), turn-18, Kiro (agent), turn-21')
    expect(t).toContain('Ownership of till-it-looks-red-smooth reviewed by Kiro (agent), turn-18')
    expect(t).toContain('Word boundaries chosen by Kiro (agent), turn-24')
    for (const w of ['curator', 'verified', 'approved', 'editor', 'expert']) expect(t.toLowerCase()).not.toContain(w)
  })
  it('a fallback reading credits its reader verbatim', () => {
    const b = loaded((x) => { x.transcription.readers = ['fallback']; x.transcription.by = 'Test Reader'; delete x.review })
    expect(text(mount(<ArchiveSlip bundle={b.bundle} expanded />))).toContain('Read by Test Reader (fallback reading, not by the Kiro readers)')
  })
})
