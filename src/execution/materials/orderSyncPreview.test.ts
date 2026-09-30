import { describe, expect, it } from 'vitest'
import { createOrder, seedOrderCollection } from '../order-machine/orderCollection'
import { applyReservationCommand, createReservationState, reservationOrdersFromCollection, reservationSnapshot } from './reservations'
import { createOrderSyncPreview } from './orderSyncPreview'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const source = seedOrderCollection()
const sync = { kind: 'sync-orders' as const, requestId: id(1), expectedRevision: 0, collection: source }
const synced = applyReservationCommand(createReservationState(), sync).state
const snapshot = reservationSnapshot(synced)
const allFields = ['line', 'phase', 'archived', 'sourceRevision', 'target']
function reserved(lotId = 'MAT-ALLOY', requestId = id(2), state = synced) {
  return applyReservationCommand(state, { kind: 'reserve', requestId, expectedRevision: state.revision,
    orderId: 'PO-8842', lotId, quantity: 10, note: 'Production planning hold' }).state
}

describe('non-mutating order synchronization review', () => {
  it('previews initial additions without creating orders, events, or receipts', () => {
    const state = createReservationState(), before = structuredClone(state), sourceBefore = structuredClone(source)
    const result = createOrderSyncPreview(reservationSnapshot(state), source)
    expect(result).toMatchObject({ revision: 0, sourceCount: 6, unchanged: 0, added: 6, updated: 0, removed: 0, blocked: 0 })
    expect(result.changes[0]).toEqual({ id: 'PO-8842', kind: 'added', before: null,
      after: reservationOrdersFromCollection(source)[0], fields: allFields, activeHoldIds: [] })
    expect(state).toEqual(before); expect(source).toEqual(sourceBefore)
  })

  it('ignores source ordering and unrelated genealogy/history while retaining true no-op semantics', () => {
    const collection = { ...source, orders: source.orders.toReversed().map(order => ({ ...order,
      aggregate: { ...order.aggregate, causalHistory: [...order.aggregate.causalHistory, { revision: 1, action: 'review', source: 'preview test' }] } })),
      lotIndexes: source.lotIndexes.map(lot => ({ ...lot, available: !lot.available })) }
    expect(createOrderSyncPreview(snapshot, collection)).toEqual({ revision: 1, sourceCount: 6, unchanged: 6,
      added: 0, updated: 0, removed: 0, blocked: 0, changes: [] })
  })

  it('lists additions, complete field updates, and removals with exact before/after values', () => {
    const added = createOrder(source, 'PO-9901', 'assembly', 'LOT-55')
    const collection = { ...added, orders: added.orders.filter(order => order.id !== 'PO-8843').map(order => order.id === 'PO-8842'
      ? { ...order, line: 'packaging', archived: true, aggregate: { ...order.aggregate,
        order: { ...order.aggregate.order, phase: 'ready' as const, revision: 2, target: 125 } } } : order) }
    const result = createOrderSyncPreview(snapshot, collection)
    expect(result).toMatchObject({ revision: 1, sourceCount: 6, unchanged: 4, added: 1, updated: 1, removed: 1, blocked: 0 })
    expect(result.changes.map(change => [change.id, change.kind, change.fields])).toEqual([
      ['PO-8842', 'updated', allFields], ['PO-8843', 'removed', allFields], ['PO-9901', 'added', allFields],
    ])
    expect(result.changes[0]?.before).toEqual(snapshot.orders[0])
    expect(result.changes[0]?.after).toMatchObject({ line: 'packaging', phase: 'ready', archived: true, sourceRevision: 2, target: 125 })
    expect(result.changes[1]?.after).toBeNull(); expect(result.changes[2]?.before).toBeNull()
  })

  it('makes a source revision downgrade visible instead of changing existing sync behavior', () => {
    const collection = { ...source, orders: source.orders.map(order => order.id === 'PO-8842'
      ? { ...order, aggregate: { ...order.aggregate, order: { ...order.aggregate.order, revision: 0 } } } : order) }
    const result = createOrderSyncPreview(snapshot, collection)
    expect(result.changes[0]).toMatchObject({ kind: 'updated', fields: ['sourceRevision'], before: { sourceRevision: 1 }, after: { sourceRevision: 0 } })
    expect(result.blocked).toBe(0)
  })

  it('counts blocking changed orders, not holds, and never blocks an unchanged held order', () => {
    const state = reserved('MAT-FASTENER', id(3), reserved())
    expect(createOrderSyncPreview(reservationSnapshot(state), source).blocked).toBe(0)
    const collection = { ...source, orders: source.orders.filter(order => order.id !== 'PO-8842') }
    const result = createOrderSyncPreview(reservationSnapshot(state), collection)
    expect(result).toMatchObject({ blocked: 1, removed: 1, unchanged: 5 })
    expect(result.changes[0]?.activeHoldIds).toEqual([id(2), id(3)])
    expect(() => applyReservationCommand(state, { ...sync, requestId: id(4), expectedRevision: state.revision, collection })).toThrow('active material holds')
  })

  it('does not treat released historical holds as blockers', () => {
    const state = applyReservationCommand(reserved(), { kind: 'release', requestId: id(3), expectedRevision: 2,
      reservationId: id(2), reason: 'Changed production plan' }).state
    const result = createOrderSyncPreview(reservationSnapshot(state), { ...source, orders: [] })
    expect(result).toMatchObject({ sourceCount: 0, removed: 6, blocked: 0, unchanged: 0 })
    expect(result.changes.every(change => change.activeHoldIds.length === 0 && change.after === null)).toBe(true)
  })

  it('sorts IDs by Unicode code point, never locale or caller order', () => {
    const first = source.orders[0]
    if (!first) throw new Error('Missing fixture order.')
    const identifiers = ['\u{10000}', '\ue000', 'z', 'a']
    const collection = { ...source, orders: identifiers.map(orderId => ({ ...first, id: orderId,
      aggregate: { ...first.aggregate, order: { ...first.aggregate.order, id: orderId } } })) }
    expect(createOrderSyncPreview(reservationSnapshot(createReservationState()), collection).changes.map(change => change.id))
      .toEqual(['a', 'z', '\ue000', '\u{10000}'])
  })

  it.each([null, {}, { ...snapshot, revision: 99 }, { ...reservationSnapshot(reserved()), orders: [] }])('rejects invalid complete snapshots: %j', malformed => {
    expect(() => createOrderSyncPreview(malformed, source)).toThrow('could not be verified')
  })

  it.each(['nested', 'identity', 'lot-reference', 'quantity', 'duplicate'])('validates the full source, including %s', issue => {
    const first = source.orders[0]
    if (!first) throw new Error('Missing fixture order.')
    const orders = issue === 'nested' ? [{ ...first, aggregate: { ...first.aggregate, recallJob: { status: 'unknown' } } }]
      : issue === 'identity' ? [{ ...first, id: 'different' }]
        : issue === 'lot-reference' ? [{ ...first, lotIndexId: 'missing' }]
          : issue === 'quantity' ? [{ ...first, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, produced: 121 } } }]
            : [first, first]
    expect(() => createOrderSyncPreview(snapshot, { ...source, orders })).toThrow('full production-order collection is invalid')
  })

  it('returns detached review values and preserves legacy command fingerprints and retries', () => {
    const initial = createReservationState(), before = structuredClone(synced)
    const result = createOrderSyncPreview(reservationSnapshot(initial), source)
    const first = result.changes[0]?.after
    if (!first) throw new Error('Missing review order.')
    first.target = 999
    expect(source).toEqual(sync.collection)
    expect(reservationOrdersFromCollection(source)[0]?.target).toBe(120)
    const applied = applyReservationCommand(initial, sync)
    expect(applied.state.receipts[0]?.fingerprint).toBe(JSON.stringify({ kind: 'sync-orders', requestId: id(1),
      expectedRevision: 0, orders: reservationOrdersFromCollection(source) }))
    expect(applyReservationCommand(applied.state, sync).replayed).toBe(true)
    expect(synced).toEqual(before)
  })
})
