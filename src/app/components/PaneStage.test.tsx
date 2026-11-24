// @vitest-environment happy-dom
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { paneNoteFor, buildPlan } from '../../cook/plan.ts'
import { createRevealGate } from '../../cook/revealGate.ts'
import { AssetError } from '../../steam/assets.ts'
import { createPreparer } from '../../steam/prepare.ts'
import type { SteamGlassProps } from '../../steam/SteamGlass.tsx'
import { WIPE_MS, type RevealState } from '../../steam/timeline.ts'
import { loaded, mount, rerender, text, tick, unmountAll } from '../render.fixture.tsx'
import PaneStage, { type StageApi } from './PaneStage.tsx'

beforeEach(() => vi.useFakeTimers())
afterEach(() => { unmountAll(); vi.useRealTimers() })

const r = loaded()
const plan = buildPlan(r.bundle, r.notes, {})
const st = (phase: RevealState['phase']): RevealState => ({ phase, u: 0, thicken: 0, head: 0, wipe: 0, refog: 0 })

// A stand-in for SteamGlass: records its props, exposes a controller, and lets the test say when it is ready.
const glasses = new Map<string, { props: SteamGlassProps; started: number; wiped: number }>()
function FakeGlass(props: SteamGlassProps) {
  useEffect(() => {
    const g = { props, started: 0, wiped: 0 }
    glasses.set(props.noteId, g)
    props.controllerRef.current = { startReveal: () => { g.started++; props.onState?.(st('writing')) }, wipe: () => { g.wiped++; props.onState?.(st('wiped')) } }
    props.onState?.(st(props.initial === 'held' ? 'holding' : 'fogged'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <i data-glass={props.noteId} />
}
const ready = async (n: string) => { glasses.get(n)!.props.onReady?.(); await tick(0) }
const noLoad = createPreparer({ load: () => new Promise(() => {}), derive: () => ({}) as never })

function setup(step: number, held: string[] = [], preparer = noLoad) {
  glasses.clear()
  const applied: string[] = []
  const api: { current: StageApi | null } = { current: null }
  const gate = createRevealGate<{ noteId: string }>((e) => {
    applied.push(e.noteId)
    api.current!.startReveal(e.noteId)
    performance.mark(`cook:reveal:${e.noteId}`)
  })
  const node = (s: number) => <div className="stage"><PaneStage recipe={r} noteId={paneNoteFor(plan, s)} heldAtMount={held} gate={gate} apiRef={api} Glass={FakeGlass} preparer={preparer} /></div>
  const host = mount(node(step))
  return { host, gate, applied, api, go: (s: number) => rerender(host, node(s)) }
}

describe('PaneStage (R15.4 to R15.7, R15.11, R15.12, R26.3)', () => {
  it('the pane follows paneNoteFor', () => {
    for (const [step, n] of [[0, 'full-ripe'], [1, 'when-tender'], [3, 'when-tender'], [4, 'till-it-looks-red-smooth']] as const) {
      const { host } = setup(step)
      expect(host.querySelector('[data-glass]')!.getAttribute('data-glass')).toBe(n)
      unmountAll()
    }
  })
  it('a reveal for a ready pane starts it once and sets the mark; one for a pane not yet ready waits', async () => {
    const mark = vi.spyOn(performance, 'mark')
    const { gate, applied } = setup(4)
    gate.enqueue({ noteId: 'till-it-looks-red-smooth' })
    expect(applied).toEqual([])
    await ready('till-it-looks-red-smooth')
    expect(applied).toEqual(['till-it-looks-red-smooth'])
    expect(glasses.get('till-it-looks-red-smooth')!.started).toBe(1)
    expect(mark.mock.calls.filter((c) => c[0] === 'cook:reveal:till-it-looks-red-smooth').length).toBe(1)
    await ready('till-it-looks-red-smooth')
    expect(applied.length).toBe(1)
  })
  it('after a wipe the outgoing pane stays for WIPE_MS, then fades over 600 ms; never more than two panes', async () => {
    const { host, api, go, gate, applied } = setup(0)
    await ready('full-ripe')
    gate.enqueue({ noteId: 'full-ripe' })
    api.current!.wipe()
    go(1)
    await tick(0)
    expect(host.querySelectorAll('section.pane').length).toBe(2)
    expect(host.querySelector('section.pane--leaving')!.getAttribute('data-note')).toBe('full-ripe')
    await ready('when-tender')
    gate.enqueue({ noteId: 'when-tender' })
    expect(applied).toEqual(['full-ripe']) // blocked while the outgoing pane sweeps
    await tick(WIPE_MS - 10)
    expect(host.querySelector('section.pane--gone')).toBeNull()
    await tick(20)
    expect(host.querySelector('section.pane--gone')).not.toBeNull()
    expect(applied).toEqual(['full-ripe', 'when-tender'])
    await tick(600)
    expect(host.querySelectorAll('section.pane').length).toBe(1)
  })
  it('a restored revealed note gets its pane initial "held"', () => {
    setup(4, ['till-it-looks-red-smooth'])
    expect(glasses.get('till-it-looks-red-smooth')!.props.initial).toBe('held')
  })
  it('a note whose assets fail shows the message and its typed transcription, and the effect is dropped', async () => {
    const { host, gate, applied } = setup(4)
    gate.enqueue({ noteId: 'till-it-looks-red-smooth' })
    glasses.get('till-it-looks-red-smooth')!.props.onError?.(new AssetError('meta', 'x'))
    await tick(0)
    expect(text(host)).toContain('The scan of this note could not be loaded.')
    expect(text(host)).toContain('till it Looks red & smooth,')
    expect(text(host)).toContain('Typed transcription, not the hand')
    expect(gate.pending.length).toBe(0)
    expect(applied).toEqual([])
  })
  it('prepares the current note first, then the others in idle time, none while a pane is writing; the cache is kept', async () => {
    const derive = vi.fn(() => ({}) as never)
    const load = vi.fn(async (stem: string) => ({ meta: { noteId: stem }, toi: {}, noteData: {} }) as never)
    const p = createPreparer({ load, derive })
    setup(4, [], p)
    await tick(0)
    expect(load.mock.calls.map((c) => c[0])).toEqual(['/recipes/quinces-marmalade/note-till-it-looks-red-smooth'])
    glasses.get('till-it-looks-red-smooth')!.props.onState?.(st('writing'))
    await ready('till-it-looks-red-smooth')
    await tick(2000)
    expect(load).toHaveBeenCalledTimes(1) // waits while writing
    glasses.get('till-it-looks-red-smooth')!.props.onState?.(st('holding'))
    await tick(2000)
    expect(load.mock.calls.map((c) => c[0]).slice(1).sort()).toEqual(['/recipes/quinces-marmalade/note-full-ripe', '/recipes/quinces-marmalade/note-when-tender'])
    expect(derive).toHaveBeenCalledTimes(3)
    p.prepare('/recipes/quinces-marmalade/note-full-ripe')
    expect(load).toHaveBeenCalledTimes(3)
  })
})
