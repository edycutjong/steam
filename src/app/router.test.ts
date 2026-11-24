import { describe, expect, it } from 'vitest'
import { formatRoute, parseRoute } from './router.ts'

const cook = (o: object = {}) => ({ name: 'cook', id: 'quinces-marmalade', pace: 1, note: null, lead: null, fps: false, ...o })

describe('parseRoute (R1.1 to R1.4, R1.7)', () => {
  it('parses the five routes', () => {
    expect(parseRoute('#/')).toEqual({ name: 'shelf' })
    expect(parseRoute('')).toEqual({ name: 'shelf' })
    expect(parseRoute('#/r/quinces-marmalade')).toEqual({ name: 'edition', id: 'quinces-marmalade' })
    expect(parseRoute('#/r/quinces-marmalade/cook')).toEqual(cook())
    expect(parseRoute('#/r/quinces-marmalade/quoted')).toEqual({ name: 'quoted', id: 'quinces-marmalade' })
    expect(parseRoute('#/pane/quinces-marmalade/till-it-looks-red-smooth?t=2000&lead=0')).toEqual({ name: 'pane', id: 'quinces-marmalade', noteId: 'till-it-looks-red-smooth', query: 't=2000&lead=0' })
  })
  it('parses the cook query', () => {
    expect(parseRoute('#/r/quinces-marmalade/cook?pace=12&note=till-it-looks-red-smooth&lead=3&fps=1')).toEqual(cook({ pace: 12, note: 'till-it-looks-red-smooth', lead: 3, fps: true }))
    expect(parseRoute('#/r/quinces-marmalade/cook?pace=4&lead=0.5')).toEqual(cook({ pace: 4, lead: 0.5 }))
  })
  it.each(['pace=7', 'pace=', 'pace=12&pace=4', 'lead=-1', 'lead=NaN', 'lead=999', 'lead=0x10', 'lead=1e1', 'lead=3&lead=4', 'note=Bad_ID', 'note=', 'fps=0', 'fps=true'])('"%s" gives the defaults', (q) => {
    expect(parseRoute(`#/r/quinces-marmalade/cook?${q}`)).toEqual(cook())
  })
  it('ignores unknown keys', () => expect(parseRoute('#/r/quinces-marmalade/cook?zzz=1&pace=4')).toEqual(cook({ pace: 4 })))
  it.each(['#/r/Quinces', '#/r/', '#/x', '#/r/a/b/c', '#/r/quinces-marmalade/other', '#/pane/quinces-marmalade', '#//r/a'])('%s is notFound', (h) => {
    expect(parseRoute(h)).toEqual({ name: 'notFound' })
  })
  it('accepts a trailing slash', () => {
    expect(parseRoute('#/r/quinces-marmalade/')).toEqual({ name: 'edition', id: 'quinces-marmalade' })
    expect(parseRoute('#/r/quinces-marmalade/cook/?pace=4')).toEqual(cook({ pace: 4 }))
  })
  it('formatRoute writes non-default values only, in the order note, pace, lead, fps', () => {
    expect(formatRoute(cook() as never)).toBe('#/r/quinces-marmalade/cook')
    expect(formatRoute(cook({ fps: true, lead: 3, pace: 12, note: 'n-1' }) as never)).toBe('#/r/quinces-marmalade/cook?note=n-1&pace=12&lead=3&fps=1')
    expect(formatRoute({ name: 'shelf' })).toBe('#/')
  })
})
