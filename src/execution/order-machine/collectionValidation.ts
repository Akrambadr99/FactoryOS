import { array, booleanValue, nonEmptyText, nonNegativeInteger, nullable, object, oneOf, optional, text, uniqueBy } from '../../workspace/storageValidation'
import type { OrderCollection, OrderCollectionEvent, LotIndexRecord, ProductionOrderRecord } from './orderCollection'
import type { OrderAggregate, RecallRecoveryAssignment } from './orderLedger'
import type { Execution } from './execution'

const actor = oneOf('production planner', 'quality approver')
const execution = object<Execution>({
  id: nonEmptyText, phase: oneOf('material-hold', 'ready', 'running', 'quality-hold', 'complete'),
  materialReleased: booleanValue, machineAvailable: booleanValue, produced: nonNegativeInteger,
  target: nonNegativeInteger, qualityApproved: booleanValue, revision: nonNegativeInteger, history: array(text),
})
const recallJob = object<NonNullable<OrderAggregate['recallJob']>>({
  id: nonEmptyText, sourceRevision: nonNegativeInteger, status: oneOf('queued', 'failed', 'complete'),
  attempts: nonNegativeInteger, failureReason: nullable(text), owner: optional(actor),
})
const recoveryAssignment = object<RecallRecoveryAssignment>({
  id: nonEmptyText, jobId: nonEmptyText, sourceRevision: nonNegativeInteger, assignee: actor,
  assigneeId: optional(nullable(nonEmptyText)), status: oneOf('open', 'superseded', 'completed', 'stale'),
  supersedesId: optional(nonEmptyText), reason: text,
})
const aggregate = object<OrderAggregate>({
  order: execution, recallOpened: booleanValue, recallJob: nullable(recallJob),
  recoveryAssignments: optional(uniqueBy(array(recoveryAssignment), 'id')),
  causalHistory: array(object<OrderAggregate['causalHistory'][number]>({
    revision: nonNegativeInteger, action: text, source: text, actor: optional(actor), reason: optional(text),
  })),
})
const order = object<ProductionOrderRecord>({ id: nonEmptyText, line: nonEmptyText, lotIndexId: nonEmptyText, aggregate, archived: booleanValue })
const lot = object<LotIndexRecord>({ id: nonEmptyText, revision: nonNegativeInteger, available: booleanValue })
const event = object<OrderCollectionEvent>({
  sequence: nonNegativeInteger, action: text, targetId: nonEmptyText, relatedIds: array(nonEmptyText), actor: text, sourceRevision: nonNegativeInteger,
})
export const orderCollectionRule = object<OrderCollection>({
  orders: uniqueBy(array(order), 'id'), lotIndexes: uniqueBy(array(lot), 'id'), events: uniqueBy(array(event), 'sequence'),
})
