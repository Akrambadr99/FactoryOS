import { describe, expect, it } from 'vitest'
import { StoredDataError } from '../../workspace/storageValidation'
import { readOrderCollection, saveOrderCollection, seedOrderCollection, setLotIndexAvailability } from './orderCollection'
import type { OrderCollection } from './orderCollection'
import { initialOrderAggregate } from './orderLedger'

const key = 'factoryos:production-orders:v1'
const legacyKey = 'factoryos:order:PO-8842:v1'
function storage(entries: [string, string][] = []) {
  const values = new Map(entries), writes: string[] = []
  return { values, writes, getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, raw: string) => { writes.push(name); values.set(name, raw) } }
}
const seed = seedOrderCollection(), first = seed.orders[0]!, failed = seed.orders[1]!
const replace = (record: unknown) => ({ ...seed, orders: [record] })
describe('production collection integrity', () => {
  it.each([
    ['null record', replace(null)], ['missing aggregate', replace({ ...first, aggregate: {} })],
    ['phase enum', replace({ ...first, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, phase: 'launched' } } })],
    ['fractional revision', replace({ ...first, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, revision: 1.5 } } })],
    ['invalid production quantity', replace({ ...first, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, produced: '120' } } })],
    ['recall enum', replace({ ...failed, aggregate: { ...failed.aggregate, recallJob: { ...failed.aggregate.recallJob, status: 'unknown' } } })],
    ['negative attempts', replace({ ...failed, aggregate: { ...failed.aggregate, recallJob: { ...failed.aggregate.recallJob, attempts: -1 } } })],
    ['invalid recovery role', replace({ ...failed, aggregate: { ...failed.aggregate, recoveryAssignments: [{ ...failed.aggregate.recoveryAssignments?.[0], assignee: 'visitor' }] } })],
    ['null history event', replace({ ...first, aggregate: { ...first.aggregate, causalHistory: [null] } })],
    ['duplicate orders', { ...seed, orders: [first, first] }],
    ['duplicate lot identities', { ...seed, lotIndexes: [seed.lotIndexes[0], seed.lotIndexes[0]] }],
    ['invalid event references', { ...seed, events: [{ sequence: 1, action: 'created', targetId: first.id, relatedIds: [null], actor: 'planner', sourceRevision: 1 }] }],
    ['non-array optional work', replace({ ...first, aggregate: { ...first.aggregate, recoveryAssignments: {} } })],
  ])('rejects %s without touching saved bytes', (_name, value) => {
    const raw = JSON.stringify(value), port = storage([[key, raw]])
    expect(() => readOrderCollection(port)).toThrow(StoredDataError)
    expect(port.values.get(key)).toBe(raw)
    expect(port.writes).toEqual([])
  })
  it.each(['', '{', 'null'])('does not seed over unreadable primary data %j', raw => {
    const port = storage([[key, raw]])
    expect(() => readOrderCollection(port)).toThrow(StoredDataError)
    expect(port.values.get(key)).toBe(raw)
    expect(port.writes).toEqual([])
  })
  it('preserves metadata and omitted optional legacy work in a valid round trip', () => {
    const port = storage(), value = { ...seed, importMetadata: { batch: 'offline-copy', retained: true },
      orders: [{ ...first, localNote: 'retained', aggregate: { ...first.aggregate, recoveryAssignments: undefined } }] }
    saveOrderCollection(port, value)
    expect(readOrderCollection(port)).toEqual(JSON.parse(JSON.stringify(value)))
    expect(port.writes).toEqual([key])
  })
  it('validates before writing an invalid runtime candidate', () => {
    const raw = JSON.stringify(seed), port = storage([[key, raw]])
    expect(() => saveOrderCollection(port, replace(null) as unknown as OrderCollection)).toThrow(StoredDataError)
    expect(port.values.get(key)).toBe(raw)
    expect(port.writes).toEqual([])
  })
  it('migrates a valid legacy aggregate without modifying either storage key', () => {
    const raw = JSON.stringify({ ...initialOrderAggregate, recoveryAssignments: undefined }), port = storage([[legacyKey, raw]])
    expect(readOrderCollection(port).orders[0]?.aggregate.order).toEqual(initialOrderAggregate.order)
    expect(port.values.get(legacyKey)).toBe(raw)
    expect(port.values.has(key)).toBe(false)
    expect(port.writes).toEqual([])
  })
  it('does not seed over an empty legacy source when the collection is absent', () => {
    const port = storage([[legacyKey, '']])
    expect(() => readOrderCollection(port)).toThrow(StoredDataError)
    expect(port.values.get(legacyKey)).toBe('')
    expect(port.values.has(key)).toBe(false)
    expect(port.writes).toEqual([])
  })
  it('rejects malformed migration output and identifies the retained legacy source', () => {
    const raw = JSON.stringify({ ...initialOrderAggregate, order: { ...initialOrderAggregate.order, phase: 'unknown' } }), port = storage([[legacyKey, raw]])
    try { readOrderCollection(port); expect.fail('Malformed legacy output should fail validation.') }
    catch (error) { expect(error).toBeInstanceOf(StoredDataError); expect(error).toHaveProperty('key', legacyKey) }
    expect(port.values.get(legacyKey)).toBe(raw)
    expect(port.writes).toEqual([])
  })
  it('retains failed recalls, material holds and stale recovery history as valid states', () => {
    const port = storage(), value = setLotIndexAvailability(seed, 'LOT-55', false, 'quality approver', 1).collection
    saveOrderCollection(port, value)
    expect(readOrderCollection(port)).toEqual(value)
  })
})
