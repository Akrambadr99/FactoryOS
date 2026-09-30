import { describe, expect, it } from 'vitest'
import type { StoragePort } from '../../workspace/repository'
import { saveCurrentCollection } from '../../workspace/recordStorage'
import { openSelectedRecord } from './selectedRecord'
import { readOrderCollection, saveOrderCollection } from './orderCollection'
import { readOrderAggregate, saveOrderAggregate, executeOrder } from './orderLedger'

class MemoryStorage implements StoragePort {
  data = new Map<string, string>()
  fail = false
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, raw: string) { if (this.fail) throw new Error('Storage full'); this.data.set(key, raw) }
}
const edit: (state: ReturnType<typeof readOrderAggregate>) => ReturnType<typeof readOrderAggregate> = state => executeOrder(state, { type: 'release-material' })
const key = 'factoryos:order:PO-8842:v1'
describe('selected order persistence', () => {
  it('imports legacy history once and retains its original backup', () => {
    const storage = new MemoryStorage()
    const legacy = edit(readOrderAggregate(storage))
    saveOrderAggregate(storage, legacy)
    const backup = storage.getItem(key)
    const bound = openSelectedRecord(storage)
    expect(readOrderAggregate(bound)).toEqual(legacy)
    saveOrderAggregate(bound, legacy)
    expect(readOrderCollection(storage).orders[0]?.aggregate).toEqual(legacy)
    expect(storage.getItem(key)).toBe(backup)
    saveOrderAggregate(storage, readOrderAggregate(new MemoryStorage()))
    expect(readOrderAggregate(openSelectedRecord(storage))).toEqual(legacy)
  })
  it('persists a domain action and preserves every unrelated record', () => {
    const storage = new MemoryStorage(), before = readOrderCollection(storage)
    const bound = openSelectedRecord(storage), changed = edit(readOrderAggregate(bound))
    saveOrderAggregate(bound, changed)
    const after = readOrderCollection(storage)
    expect(after.orders[0]?.aggregate).toEqual(changed)
    expect(after.orders.slice(1)).toEqual(before.orders.slice(1))
    expect(readOrderAggregate(openSelectedRecord(storage))).toEqual(changed)
    expect(after.events.at(-1)).toMatchObject({ action: 'detail-updated', targetId: 'PO-8842' })
  })
  it('rejects stale edits without replacing the newer domain state', () => {
    const storage = new MemoryStorage()
    const first = openSelectedRecord(storage), stale = openSelectedRecord(storage)
    const changed = edit(readOrderAggregate(first))
    saveOrderAggregate(first, changed)
    expect(() => saveOrderAggregate(stale, edit(readOrderAggregate(stale)))).toThrow('changed in another view')
    expect(readOrderAggregate(openSelectedRecord(storage))).toEqual(changed)
  })
  it('merges with an unrelated record archive without losing that edit', () => {
    const storage = new MemoryStorage(), bound = openSelectedRecord(storage)
    const before = readOrderCollection(storage), peer = before.orders[1]
    if (!peer) throw new Error('Peer fixture missing')
    const newer = { ...before, orders: before.orders.map(item => item.id === peer.id ? { ...item, archived: true } : item) }
    saveOrderCollection(storage, newer)
    saveOrderAggregate(bound, edit(readOrderAggregate(bound)))
    expect(readOrderCollection(storage).orders[1]).toEqual(newer.orders[1])
  })
  it('rejects missing and archived targets without writing', () => {
    const storage = new MemoryStorage()
    expect(() => openSelectedRecord(storage, 'missing')).toThrow('not found')
    expect(storage.data.size).toBe(0)
    const before = readOrderCollection(storage)
    saveOrderCollection(storage, { ...before, orders: before.orders.map(item => ({ ...item, archived: true })) })
    const snapshot = [...storage.data]
    expect(() => openSelectedRecord(storage)).toThrow('archived')
    expect([...storage.data]).toEqual(snapshot)
  })
  it('rejects a record archived after the editor opened', () => {
    const storage = new MemoryStorage(), bound = openSelectedRecord(storage)
    const before = readOrderCollection(storage)
    saveOrderCollection(storage, { ...before, orders: before.orders.map(item => ({ ...item, archived: true })) })
    expect(() => saveOrderAggregate(bound, edit(readOrderAggregate(bound)))).toThrow('changed in another view')
  })
  it('preserves retryability after a recoverable storage failure', () => {
    const storage = new MemoryStorage(), bound = openSelectedRecord(storage)
    const changed = edit(readOrderAggregate(bound))
    storage.fail = true
    expect(() => saveOrderAggregate(bound, changed)).toThrow('Storage full')
    storage.fail = false
    saveOrderAggregate(bound, changed)
    expect(readOrderAggregate(openSelectedRecord(storage))).toEqual(changed)
  })
  it('protects a detail edit against a stale whole-workspace save', () => {
    const storage = new MemoryStorage(), stale = readOrderCollection(storage)
    const bound = openSelectedRecord(storage)
    saveOrderAggregate(bound, edit(readOrderAggregate(bound)))
    expect(() => saveCurrentCollection(storage, stale, stale, readOrderCollection, saveOrderCollection)).toThrow('Workspace changed')
    expect(readOrderCollection(storage).orders[0]?.aggregate).not.toEqual(stale.orders[0]?.aggregate)
  })
})
