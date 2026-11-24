// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { parseReading } from '../../data/reading.ts'
import { mount, unmountAll } from '../render.fixture.tsx'
import ReadingText, { DISAGREE_DESC_ID, DisagreeDescription } from './ReadingText.tsx'

afterEach(unmountAll)

describe('ReadingText (R6.3, R6.4)', () => {
  it('renders each mark as †[a|b] with role group, its accessible name and the shared description', () => {
    const host = mount(<><ReadingText segments={parseReading('take out the †[Cores|cores] and')} /><DisagreeDescription /></>)
    const g = host.querySelector('[role="group"]')!
    expect(g.textContent).toBe('†[Cores|cores]')
    expect(g.getAttribute('aria-label')).toBe('Readings: “Cores” or “cores”')
    expect(g.getAttribute('aria-describedby')).toBe(DISAGREE_DESC_ID)
    expect(host.querySelector(`#${DISAGREE_DESC_ID}`)!.textContent).toBe('Two independent readers disagree on this word. The hand is shown as written.')
    expect(host.textContent).toContain('take out the †[Cores|cores] and')
  })
  it('an empty reading renders †[(N.26)|] and is named "nothing"', () => {
    const g = mount(<ReadingText segments={parseReading('†[(N.26)|] take')} />).querySelector('[role="group"]')!
    expect(g.textContent).toBe('†[(N.26)|]')
    expect(g.getAttribute('aria-label')).toBe('Readings: “(N.26)” or “nothing”')
  })
})
