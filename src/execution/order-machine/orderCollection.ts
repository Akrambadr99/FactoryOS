import { readStored, writeStored } from '../../workspace/storageValidation'
import { orderCollectionRule } from './collectionValidation'
import type { StoragePort } from '../../workspace/repository'
import { initialOrderAggregate, readOrderAggregate, retryRecall } from './orderLedger'
import type { OrderAggregate, RecallActor } from './orderLedger'
import { claimRecovery, recoveryEligibility, recoveryWorkInbox } from './recoveryWorkload'

export interface ProductionOrderRecord {
  id: string
  line: string
  lotIndexId: string
  aggregate: OrderAggregate
  archived: boolean
}
export interface LotIndexRecord { id: string; revision: number; available: boolean }
export interface OrderCollectionEvent {
  sequence: number
  action: string
  targetId: string
  relatedIds: readonly string[]
  actor: string
  sourceRevision: number
}
export interface OrderCollection {
  orders: readonly ProductionOrderRecord[]
  lotIndexes: readonly LotIndexRecord[]
  events: readonly OrderCollectionEvent[]
}
export interface OrderBatchResult {
  collection: OrderCollection
  updated: string[]
  skipped: string[]
  blocked: { id: string; reason: string }[]
}

const collectionKey = 'factoryos:production-orders:v1'

function completedOrder(id: string): OrderAggregate {
  return { ...initialOrderAggregate, order: { ...initialOrderAggregate.order, id, phase: 'complete',
    materialReleased: true, machineAvailable: true, produced: 120, qualityApproved: true, revision: 7,
    history: ['release-material', 'restore-machine', 'start', 'produce', 'approve-quality', 'complete'] } }
}
function failedOrder(id: string): OrderAggregate {
  const complete = completedOrder(id)
  const jobId = `RECALL-${id}`
  return { ...complete, recallOpened: true,
    recallJob: { id: jobId, sourceRevision: 7, status: 'failed', attempts: 1,
      failureReason: 'Lot genealogy index was incomplete.', owner: 'production planner' },
    recoveryAssignments: [{ id: `RECOVERY-${jobId}-1`, jobId, sourceRevision: 7,
      assignee: 'production planner', status: 'open', reason: 'Incomplete lot genealogy index' }] }
}
export function seedOrderCollection(legacy: OrderAggregate = initialOrderAggregate): OrderCollection {
  return { orders: [
    { id: 'PO-8842', line: 'assembly', lotIndexId: 'LOT-55', aggregate: legacy, archived: false },
    { id: 'PO-8843', line: 'assembly', lotIndexId: 'LOT-55', aggregate: failedOrder('PO-8843'), archived: false },
    { id: 'PO-8844', line: 'assembly', lotIndexId: 'LOT-55', aggregate: failedOrder('PO-8844'), archived: false },
    { id: 'PO-8845', line: 'packaging', lotIndexId: 'LOT-76', aggregate: failedOrder('PO-8845'), archived: false },
    { id: 'PO-8846', line: 'packaging', lotIndexId: 'LOT-76', aggregate: completedOrder('PO-8846'), archived: false },
    { id: 'PO-8847', line: 'assembly', lotIndexId: 'LOT-91', aggregate: completedOrder('PO-8847'), archived: true },
  ], lotIndexes: [
    { id: 'LOT-55', revision: 1, available: true },
    { id: 'LOT-76', revision: 1, available: true },
    { id: 'LOT-91', revision: 1, available: true },
  ], events: [] }
}
export function readOrderCollection(storage: StoragePort): OrderCollection {
  return readStored(storage, collectionKey, orderCollectionRule, () => seedOrderCollection(readOrderAggregate(storage)), 'factoryos:order:PO-8842:v1')
}
export function saveOrderCollection(storage: StoragePort, value: OrderCollection): OrderCollection {
  return writeStored(storage, collectionKey, orderCollectionRule, value)
}
export function getOrder(collection: OrderCollection, id: string): ProductionOrderRecord {
  const record = collection.orders.find(item => item.id === id)
  if (!record) throw new Error(`Order ${id} was not found.`)
  return record
}
export function visibleOrders(collection: OrderCollection, query = '', status = 'active'): ProductionOrderRecord[] {
  const needle = query.trim().toLowerCase()
  return collection.orders.filter(item => (status === 'all' || (status === 'archived') === item.archived) &&
    (!needle || [item.id, item.line, item.lotIndexId].some(value => value.toLowerCase().includes(needle))))
    .toSorted((a, b) => a.id.localeCompare(b.id))
}
export function orderRecoveryInbox(collection: OrderCollection, actorId?: string) {
  return recoveryWorkInbox(collection.orders.filter(item => !item.archived).map(item => ({
    orderId: item.id, line: item.line, aggregate: item.aggregate,
  })), actorId)
}
export function orderCollectionSummary(collection: OrderCollection) {
  const active = collection.orders.filter(item => !item.archived)
  const inbox = orderRecoveryInbox(collection)
  return { active: active.length, archived: collection.orders.length - active.length,
    failed: active.filter(item => item.aggregate.recallJob?.status === 'failed').length,
    unclaimed: inbox.filter(item => item.assigneeId === null).length,
    stale: active.reduce((count, item) => count + (item.aggregate.recoveryAssignments ?? []).filter(assignment =>
      assignment.status === 'stale').length, 0) }
}
function event(collection: OrderCollection, action: string, targetId: string, relatedIds: readonly string[],
  actor: string, sourceRevision: number): OrderCollectionEvent {
  return { sequence: collection.events.length + 1, action, targetId, relatedIds, actor, sourceRevision }
}
function replaceOrder(collection: OrderCollection, record: ProductionOrderRecord, action: string, actor: string): OrderCollection {
  return { ...collection, orders: collection.orders.map(item => item.id === record.id ? record : item),
    events: [...collection.events, event(collection, action, record.id, [record.lotIndexId], actor, record.aggregate.order.revision)] }
}
export function claimOrderRecovery(collection: OrderCollection, id: string, actorId: string, expectedRevision: number): OrderCollection {
  const record = getOrder(collection, id)
  if (record.archived) throw new Error('Archived orders cannot be claimed.')
  const aggregate = claimRecovery({ orderId: id, line: record.line, aggregate: record.aggregate }, actorId,
    collection.orders.filter(item => !item.archived).map(item => ({ orderId: item.id, line: item.line, aggregate: item.aggregate })), expectedRevision)
  return replaceOrder(collection, { ...record, aggregate }, 'recovery-claimed', actorId)
}
export function retryOrderRecovery(collection: OrderCollection, id: string, actor: RecallActor, operatorId?: string): OrderCollection {
  const record = getOrder(collection, id)
  if (record.archived) throw new Error('Archived orders cannot be retried.')
  const lot = collection.lotIndexes.find(item => item.id === record.lotIndexId)
  if (!lot?.available) throw new Error('The related lot genealogy index is unavailable.')
  const claim = record.aggregate.recoveryAssignments?.find(item => item.status === 'open')
  if (operatorId && !claim?.assigneeId) {
    const records = collection.orders.filter(item => !item.archived).map(item => ({
      orderId: item.id, line: item.line, aggregate: item.aggregate }))
    const blockers = recoveryEligibility(records, { orderId: record.id, line: record.line, aggregate: record.aggregate }, operatorId)
    if (blockers.length) throw new Error(blockers[0])
  }
  return replaceOrder(collection, { ...record, aggregate: retryRecall(record.aggregate, actor, operatorId) },
    'recovery-retried', operatorId ?? actor)
}
export function bulkRetryOrders(collection: OrderCollection, ids: readonly string[], actor: RecallActor,
  operatorId?: string): OrderBatchResult {
  let next = collection
  const updated: string[] = []
  const skipped: string[] = []
  const blocked: { id: string; reason: string }[] = []
  for (const id of [...new Set(ids)]) {
    const record = next.orders.find(item => item.id === id)
    if (record?.aggregate.recallJob?.status === 'queued' || record?.aggregate.recallJob?.status === 'complete') {
      skipped.push(id)
      continue
    }
    try { next = retryOrderRecovery(next, id, actor, operatorId); updated.push(id) }
    catch (error) { blocked.push({ id, reason: error instanceof Error ? error.message : 'Recovery failed.' }) }
  }
  return { collection: next, updated, skipped, blocked }
}
export function setLotIndexAvailability(collection: OrderCollection, lotId: string, available: boolean,
  actor: string, expectedRevision: number): OrderBatchResult {
  const lot = collection.lotIndexes.find(item => item.id === lotId)
  if (!lot) throw new Error('Lot genealogy index was not found.')
  if (lot.revision !== expectedRevision) throw new Error('Lot index revision changed before update.')
  if (lot.available === available) return { collection, updated: [], skipped: [lotId], blocked: [] }
  const updated: string[] = []
  const skipped: string[] = []
  const orders = collection.orders.map(record => {
    if (record.archived || record.lotIndexId !== lotId) { skipped.push(record.id); return record }
    const active = (record.aggregate.recoveryAssignments ?? []).some(item => item.status === 'open')
    if (!active) { skipped.push(record.id); return record }
    const revision = record.aggregate.order.revision + 1
    const aggregate: OrderAggregate = { ...record.aggregate,
      order: { ...record.aggregate.order, revision },
      recoveryAssignments: record.aggregate.recoveryAssignments?.map(item => item.status === 'open' ?
        { ...item, status: 'stale' as const } : item),
      causalHistory: [...record.aggregate.causalHistory, { revision, action: 'lot-index-changed', source: lotId,
        actor: 'quality approver' as const, reason: available ? 'Index restored; recovery requires new review.' : 'Index unavailable.' }] }
    updated.push(record.id)
    return { ...record, aggregate }
  })
  const revision = lot.revision + 1
  const next = { ...collection, orders, lotIndexes: collection.lotIndexes.map(item => item.id === lotId ?
    { ...item, revision, available } : item),
    events: [...collection.events, event(collection, available ? 'lot-index-restored' : 'lot-index-unavailable',
      lotId, updated, actor, revision)] }
  return { collection: next, updated, skipped, blocked: [] }
}
export function createOrder(collection: OrderCollection, id: string, line: string, lotIndexId: string): OrderCollection {
  if (!/^PO-\d{4,}$/.test(id) || collection.orders.some(item => item.id === id)) throw new Error('Choose a unique production-order ID.')
  if (!collection.lotIndexes.some(item => item.id === lotIndexId)) throw new Error('A referenced lot index is required.')
  if (!['assembly', 'packaging'].includes(line)) throw new Error('A supported production line is required.')
  const aggregate: OrderAggregate = { ...initialOrderAggregate, order: { ...initialOrderAggregate.order, id } }
  const record: ProductionOrderRecord = { id, line, lotIndexId, aggregate, archived: false }
  return { ...collection, orders: [...collection.orders, record], events: [...collection.events,
    event(collection, 'order-created', id, [lotIndexId], 'production planner', aggregate.order.revision)] }
}
export function archiveOrder(collection: OrderCollection, id: string): OrderCollection {
  const record = getOrder(collection, id)
  if (record.archived) return collection
  if (record.aggregate.recallJob && record.aggregate.recallJob.status !== 'complete')
    throw new Error('Open recall reconciliation prevents archival.')
  return replaceOrder(collection, { ...record, archived: true }, 'order-archived', 'production planner')
}
