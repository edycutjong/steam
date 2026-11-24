// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testApp } from './app.fixture.tsx'
import Edition from './Edition.tsx'
import { click, css, flush, loaded, mount, stubBrowser, text, unmountAll } from './render.fixture.tsx'

beforeEach(() => { stubBrowser(); location.hash = '#/r/quinces-marmalade' })
afterEach(unmountAll)
const open = async (r = loaded()) => {
  const { wrap } = testApp({ recipes: [r] })
  const h = mount(wrap(<Edition recipe={r} />))
  await flush()
  return h
}

describe('Edition view (R5.5, R6, R7)', () => {
  it('lists 12 rows numbered 00 to 11; row 03 has two marks and row 10 one', async () => {
    const h = await open()
    const rows = [...h.querySelectorAll('[role="listitem"]')]
    expect(rows.map((r) => r.querySelector('.tline__n')!.textContent)).toEqual(['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'])
    expect(rows[3]!.querySelectorAll('.mark').length).toBe(2)
    expect(rows[10]!.querySelectorAll('.mark').length).toBe(1)
    expect(text(rows[3])).toContain('†[(N.26)|] take out the †[Cores|cores] and seeds, & boil the')
  })
  it('the legend, the reading credit and the disagreement count read from the bundle', async () => {
    const r = loaded()
    const t = text(await open(r))
    expect(t).toContain('† marks a place where the two readers disagree; both readings are shown.')
    expect(t).toContain('Read by the Kiro readers, scribe and second-reader')
    expect(t).toContain(`The readers disagree in ${r.bundle.transcription.disagreements.length} places.`)
  })
  it('rows 01, 07, 08, 09 and 10 carry the judgement glyph and its text; each judgement shows "with its step"', async () => {
    const r = loaded()
    const h = await open(r)
    const lines = new Set(r.notes.flatMap((n) => n.groups.map((g) => g.line)))
    expect([...lines].sort((a, b) => a - b)).toEqual([1, 7, 8, 9, 10])
    const rows = [...h.querySelectorAll('[role="listitem"]')]
    rows.forEach((row, i) => {
      const g = row.querySelector('.tline__glyph')!
      expect(g.getAttribute('aria-hidden')).toBe('true')
      expect(g.getAttribute('data-on')).toBe(lines.has(i) ? 'true' : 'false')
    })
    expect(text(rows[1])).toContain('Judgement note on this line: full ripe')
    expect(text(rows[9])).toContain('Judgement note on this line: till it Looks red & smooth')
    expect((text(h).match(/with its step/g) ?? []).length).toBe(3)
  })
  it('a corrected line shows the merged text beneath, labelled "as merged"', async () => {
    const h = await open(loaded((b) => { b.lines[2]!.corrected = 'them, and pare them' }))
    const m = h.querySelectorAll('[role="listitem"]')[2]!.querySelector('.tline__merged')!
    expect(m.getAttribute('data-label')).toBe('as merged')
    expect(text(m)).toBe('them, & pare them, & Quarter them, then')
  })
  it('a withheld note gives the notice and its line stays', async () => {
    const r = loaded((b) => { b.notes.find((n) => n.id === 'when-tender')!.verifyBox = [1, 1, 0, 0] })
    const h = await open(r)
    expect(text(h)).toContain('1 note withheld: the source of the note could not be checked.')
    const rows = h.querySelectorAll('[role="listitem"]')
    expect(text(rows[7])).toContain('the Quince, in that Liquor, & when')
    expect(rows[7]!.querySelector('.tline__glyph')!.getAttribute('data-on')).toBe('false')
  })
  it('a primary "Cook it" button starts fresh, and a link goes back to the shelf', async () => {
    const h = await open()
    const cook = [...h.querySelectorAll('button')].find((b) => b.textContent === 'Cook it')!
    expect(cook.className).toContain('btn--primary')
    expect(h.querySelector('a[href="#/"]')).not.toBeNull()
    click(cook)
    await flush()
    expect(location.hash).toBe('#/r/quinces-marmalade/cook')
  })
  it('the layout switches to two columns at 1025 px', () => {
    const c = css('src/app/app.css')
    expect(c).toMatch(/@media \(min-width: 1025px\)\s*\{\s*\.edition__grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/)
    expect(c).toMatch(/\.facsimile__viewport\s*\{[^}]*height:\s*40vh/)
  })
})
