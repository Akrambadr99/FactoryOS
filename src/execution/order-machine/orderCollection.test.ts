import { describe, expect, it } from 'vitest'
import { MemoryStorage } from '../../data/memory-storage'
import { archiveOrder, bulkRetryOrders, claimOrderRecovery, createOrder, getOrder,
  orderCollectionSummary, orderRecoveryInbox, readOrderCollection, saveOrderCollection,
  seedOrderCollection, setLotIndexAvailability, visibleOrders } from './orderCollection'

describe('persisted production-order collection', () => {
  it('loads a varied six-order source of truth and persists one named claim without mutating peers', () => {
    const storage = new MemoryStorage()
    const initial = readOrderCollection(storage)
    expect(initial.orders).toHaveLength(6)
    expect(orderRecoveryInbox(initial).map(item => item.orderId)).toEqual(['PO-8843', 'PO-8844', 'PO-8845'])
    const peer = getOrder(initial, 'PO-8844')
    const changed = claimOrderRecovery(initial, 'PO-8843', 'planner-ada', 7)
    expect(getOrder(changed, 'PO-8843').aggregate.recoveryAssignments?.[0]?.assigneeId).toBe('planner-ada')
    expect(getOrder(changed, 'PO-8844')).toEqual(peer)
    expect(() => claimOrderRecovery(changed, 'PO-8843', 'planner-ada', 7)).toThrow(/already claimed/)
    saveOrderCollection(storage, changed)
    expect(readOrderCollection(storage)).toEqual(changed)
    storage.clear()
    expect(readOrderCollection(storage)).toEqual(seedOrderCollection())
  })

  it('propagates one lot-index revision only to related recoveries and preserves unrelated order revisions', () => {
    const initial = seedOrderCollection()
    const unrelated = getOrder(initial, 'PO-8845')
    const result = setLotIndexAvailability(initial, 'LOT-55', false, 'quality approver', 1)
    expect(result.updated).toEqual(['PO-8843', 'PO-8844'])
    expect(getOrder(result.collection, 'PO-8843').aggregate.order.revision).toBe(8)
    expect(getOrder(result.collection, 'PO-8843').aggregate.recoveryAssignments?.[0]?.status).toBe('stale')
    expect(getOrder(result.collection, 'PO-8845')).toEqual(unrelated)
    expect(orderCollectionSummary(result.collection).stale).toBe(2)
    expect(result.collection.events[0]).toMatchObject({ targetId: 'LOT-55', relatedIds: ['PO-8843', 'PO-8844'] })
    expect(() => setLotIndexAvailability(result.collection, 'LOT-55', true, 'quality approver', 1)).toThrow(/revision changed/)
  })

  it('evaluates selected retries separately and keeps blocked work visible', () => {
    const initial = seedOrderCollection()
    const result = bulkRetryOrders(initial, ['PO-8843', 'PO-8845', 'PO-8842', 'PO-8843'], 'production planner', 'planner-ada')
    expect(result.updated).toEqual(['PO-8843'])
    expect(result.blocked.map(item => item.id)).toEqual(['PO-8845', 'PO-8842'])
    expect(getOrder(result.collection, 'PO-8843').aggregate.recallJob?.status).toBe('queued')
    expect(getOrder(result.collection, 'PO-8845').aggregate.recallJob?.status).toBe('failed')
    expect(orderCollectionSummary(result.collection).failed).toBe(2)
  })

  it('creates stable IDs, preserves archive history and blocks active recall archival', () => {
    const initial = seedOrderCollection()
    expect(() => archiveOrder(initial, 'PO-8843')).toThrow(/Open recall/)
    const created = createOrder(initial, 'PO-8848', 'assembly', 'LOT-55')
    expect(getOrder(created, 'PO-8848').aggregate.order.revision).toBe(1)
    expect(() => createOrder(created, 'PO-8848', 'assembly', 'LOT-55')).toThrow(/unique/)
    expect(() => createOrder(created, 'PO-8849', 'assembly', 'LOT-MISSING')).toThrow(/referenced lot/)
    const archived = archiveOrder(created, 'PO-8848')
    expect(visibleOrders(archived).some(item => item.id === 'PO-8848')).toBe(false)
    expect(visibleOrders(archived, 'PO-8848', 'archived')).toHaveLength(1)
    expect(getOrder(archived, 'PO-8848').lotIndexId).toBe('LOT-55')
  })
})
