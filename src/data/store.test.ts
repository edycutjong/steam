import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openStore } from './store.ts'

const session = { recipeId: 'r1', stepIndex: 2 }

describe('device store (R18.1, R18.8, R18.9)', () => {
  it('puts, gets and deletes a session; persistent is true', async () => {
    const s = await openStore(new IDBFactory())
    expect(s.persistent).toBe(true)
    expect(await s.getSession('r1')).toBeNull()
    await s.putSession(session)
    expect(await s.getSession('r1')).toEqual(session)
    await s.deleteSession('r1')
    expect(await s.getSession('r1')).toBeNull()
  })
  it('puts, gets and deletes timing overrides per recipe', async () => {
    const s = await openStore(new IDBFactory())
    await s.putTiming('r1', 'a', 60)
    await s.putTiming('r1', 'b', 90)
    await s.putTiming('r2', 'a', 30)
    expect(await s.getTiming('r1')).toEqual({ a: 60, b: 90 })
    await s.deleteTiming('r1', 'a')
    expect(await s.getTiming('r1')).toEqual({ b: 90 })
    expect(await s.getTiming('r2')).toEqual({ a: 30 })
  })
  it('stores settings', async () => {
    const s = await openStore(new IDBFactory())
    expect(await s.getSetting('muted')).toBeUndefined()
    await s.putSetting('muted', true)
    expect(await s.getSetting<boolean>('muted')).toBe(true)
  })
  it('data survives re-opening the store', async () => {
    const f = new IDBFactory()
    const a = await openStore(f)
    await a.putSession(session)
    await a.putTiming('r1', 'a', 60)
    await a.putSetting('introSeen', true)
    const b = await openStore(f)
    expect(await b.getSession('r1')).toEqual(session)
    expect(await b.getTiming('r1')).toEqual({ a: 60 })
    expect(await b.getSetting('introSeen')).toBe(true)
  })
  it('creates database "steam" v1 with stores sessions, timing, settings', async () => {
    const f = new IDBFactory()
    await openStore(f)
    const db = await new Promise<IDBDatabase>((res) => { const r = f.open('steam'); r.onsuccess = () => res(r.result) })
    expect(db.version).toBe(1)
    expect([...db.objectStoreNames].sort()).toEqual(['sessions', 'settings', 'timing'])
  })
  it('with indexedDB undefined it works in memory, not persistent, nothing throws', async () => {
    const s = await openStore(undefined)
    expect(s.persistent).toBe(false)
    await s.putSession(session)
    expect(await s.getSession('r1')).toEqual(session)
    await s.putTiming('r1', 'a', 30)
    expect(await s.getTiming('r1')).toEqual({ a: 30 })
  })
  it('with an open that throws it works in memory', async () => {
    const broken = { open: () => { throw new Error('denied') } } as unknown as IDBFactory
    const s = await openStore(broken)
    expect(s.persistent).toBe(false)
    await s.putSetting('k', 1)
    expect(await s.getSetting('k')).toBe(1)
  })
  it('with a transaction that aborts it falls back to memory and persistent turns false', async () => {
    const f = new IDBFactory()
    const s = await openStore(f)
    expect(s.persistent).toBe(true)
    const orig = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function () { throw new Error('QuotaExceededError') }
    try {
      await s.putSession(session)
      expect(s.persistent).toBe(false)
      expect(await s.getSession('r1')).toEqual(session)
    } finally {
      IDBDatabase.prototype.transaction = orig
    }
  })
})
