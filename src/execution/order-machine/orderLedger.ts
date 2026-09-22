import type { StoragePort } from '../../workspace/repository'
import { advanceExecution, initialExecution } from './execution'
import type { Execution, ExecutionAction } from './execution'

export interface OrderAggregate {
  order: Execution
  recallOpened: boolean
  causalHistory: readonly { revision: number; action: string; source: string }[]
}
const key = 'factoryos:order:PO-8842:v1'
export const initialOrderAggregate: OrderAggregate = { order: initialExecution, recallOpened: false, causalHistory: [] }
export function readOrderAggregate(storage: StoragePort): OrderAggregate {
  const raw = storage.getItem(key)
  if (!raw) return initialOrderAggregate
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !('order' in value) || !value.order ||
    typeof value.order !== 'object' || !('phase' in value.order) || !('revision' in value.order) ||
    !('recallOpened' in value) || typeof value.recallOpened !== 'boolean' ||
    !('causalHistory' in value) || !Array.isArray(value.causalHistory)) throw new Error('Invalid production-order record.')
  return value as OrderAggregate
}
export function executeOrder(aggregate: OrderAggregate, action: ExecutionAction): OrderAggregate {
  const order = advanceExecution(aggregate.order, action)
  return { ...aggregate, order, causalHistory: [...aggregate.causalHistory,
    { revision: order.revision, action: action.type, source: 'order-execution' }] }
}
export function recallBlockers(aggregate: OrderAggregate): string[] {
  return aggregate.order.phase === 'complete' ? [] : ['Order PO-8842 must complete quality release before recall scope can be opened.']
}
export function openRecall(aggregate: OrderAggregate): OrderAggregate {
  if (recallBlockers(aggregate).length) throw new Error(recallBlockers(aggregate)[0])
  if (aggregate.recallOpened) throw new Error('Recall scope is already open.')
  return { ...aggregate, recallOpened: true, causalHistory: [...aggregate.causalHistory,
    { revision: aggregate.order.revision, action: 'recall-opened', source: 'lot-genealogy' }] }
}
export function reopenOrder(aggregate: OrderAggregate): OrderAggregate {
  if (aggregate.order.phase !== 'complete') throw new Error('Only a completed order can be reopened.')
  if (aggregate.recallOpened) throw new Error('Open recall scope depends on the completed order.')
  const order: Execution = { ...aggregate.order, phase: 'quality-hold', qualityApproved: false,
    revision: aggregate.order.revision + 1, history: [...aggregate.order.history, 'reopen'] }
  return { ...aggregate, order, causalHistory: [...aggregate.causalHistory,
    { revision: order.revision, action: 'reopened', source: 'order-execution' }] }
}
export function saveOrderAggregate(storage: StoragePort, aggregate: OrderAggregate): OrderAggregate {
  storage.setItem(key, JSON.stringify(aggregate))
  return aggregate
}
