import { describe, expect, it } from 'vitest'
import { compareCollectionSnapshot, createCollectionSnapshot } from '../../workspace/collectionSnapshot'
import { collectionSnapshotAdapter as adapter } from './collectionSnapshot'
import { seedOrderCollection, setLotIndexAvailability } from './orderCollection'
import { initialOrderAggregate } from './orderLedger'

const key = 'factoryos:production-orders:v1'
const seed = seedOrderCollection()
function storage(entries: [string, string][] = [[key, JSON.stringify(seed)]]) {
  const values = new Map(entries), writes: string[] = []
  return { values, writes, getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, raw: string) => { writes.push(name); values.set(name, raw) } }
}
function snapshot(payload: unknown) {
  return JSON.stringify({ format: 'collection-snapshot', version: 1, product: 'FactoryOS',
    scope: 'production-orders', createdAt: '2026-09-30T12:00:00.000Z', payload })
}

describe('FactoryOS collection snapshot adapter', () => {
  it('exports the complete validated domain collection and compares it without writes', () => {
    const port = storage(), before = new Map(port.values)
    const raw = createCollectionSnapshot(adapter, port, '2026-09-30T12:00:00.000Z')
    expect(JSON.parse(raw)).toMatchObject({ product: 'FactoryOS', scope: 'production-orders', payload: seed })
    const comparison = compareCollectionSnapshot(raw, adapter, port)
    expect(comparison.payloadChanged).toBe(false)
    expect(comparison.rows.every(row => row.status === 'unchanged')).toBe(true)
    expect(adapter.groups(seed).map(group => group.key)).toEqual(['orders', 'lotIndexes'])
    expect(adapter.groups(seed).flatMap(group => group.records).map(record => record.id)).toContain('LOT-55')
    expect(port.values).toEqual(before)
    expect(port.writes).toEqual([])
  })

  it.each([
    ['malformed nested evidence', { ...seed, orders: [{ ...seed.orders[0], aggregate: { ...seed.orders[0]!.aggregate, order: { ...seed.orders[0]!.aggregate.order, phase: 'unknown' } } }] }],
    ['duplicate primary identities', { ...seed, orders: [...seed.orders, seed.orders[0]] }],
    ['duplicate related identities', { ...seed, lotIndexes: [...seed.lotIndexes, seed.lotIndexes[0]] }],
  ])('rejects %s without changing the current collection', (_name, payload) => {
    const port = storage(), before = new Map(port.values)
    expect(() => compareCollectionSnapshot(snapshot(payload), adapter, port)).toThrow()
    expect(port.values).toEqual(before)
    expect(port.writes).toEqual([])
  })

  it('compares a genuine linked domain transition including its related source record', () => {
    const changed = setLotIndexAvailability(seed, 'LOT-55', false, 'quality approver', 1).collection, port = storage()
    const comparison = compareCollectionSnapshot(snapshot(changed), adapter, port)
    expect(comparison.payloadChanged).toBe(true)
    expect(comparison.rows.filter(row => row.status === 'changed').length).toBeGreaterThanOrEqual(2)
    expect(comparison.rows.find(row => row.id === 'LOT-55')?.status).toBe('changed')
    expect(adapter.validate(changed)).toBe(changed)
    expect(port.values.get(key)).toBe(JSON.stringify(seed))
    expect(port.writes).toEqual([])
  })

  it('detects collection history and metadata changes without inventing duplicate audit rows', () => {
    const payload = { ...seed, events: [1, 2].map(sequence => ({ sequence, action: 'reviewed', targetId: 'PO-8842', relatedIds: [], actor: 'production planner', sourceRevision: 1 })), reviewMetadata: { note: 'Retain collection history' } }, port = storage()
    const comparison = compareCollectionSnapshot(snapshot(payload), adapter, port)
    expect(comparison.payloadChanged).toBe(true)
    expect(comparison.rows.every(row => row.status === 'unchanged')).toBe(true)
    expect(adapter.groups(payload)).toHaveLength(2)
    expect(adapter.validate(payload)).toBe(payload)
    expect(port.writes).toEqual([])
  })

  it('exports a valid optional-field legacy read without materializing or modifying storage', () => {
    const legacyRaw = JSON.stringify({ ...initialOrderAggregate, recoveryAssignments: undefined })
    const port = storage([['factoryos:order:PO-8842:v1', legacyRaw], ['unrelated:fixture', 'retained']])
    const before = new Map(port.values)
    const raw = createCollectionSnapshot(adapter, port, '2026-09-30T12:00:00.000Z')
    expect(compareCollectionSnapshot(raw, adapter, port).payloadChanged).toBe(false)
    expect(port.values).toEqual(before)
    expect(port.values.has(key)).toBe(false)
    expect(port.writes).toEqual([])
  })
})
