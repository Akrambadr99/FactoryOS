import type { StoragePort } from '../../workspace/repository'
import { advanceExecution, initialExecution } from './execution'
import type { Execution, ExecutionAction } from './execution'

export interface OrderAggregate {
  order: Execution
  recallOpened: boolean
  recallJob: { id: string; sourceRevision: number; status: 'queued' | 'failed' | 'complete'; attempts: number; failureReason: string | null; owner?: RecallActor } | null
  recoveryAssignments?: readonly RecallRecoveryAssignment[] | undefined
  causalHistory: readonly { revision: number; action: string; source: string; actor?: RecallActor; reason?: string }[]
}
export interface RecallRecoveryAssignment {
  id: string
  jobId: string
  sourceRevision: number
  assignee: RecallActor
  assigneeId?: string | null
  status: 'open' | 'superseded' | 'completed' | 'stale'
  supersedesId?: string
  reason: string
}
export type RecallActor = 'production planner' | 'quality approver'
export interface RecallPolicy { allowed: boolean; blockers: string[]; queue: 'reconciliation' | 'recovery' | 'complete' }
const key = 'factoryos:order:PO-8842:v1'
export const initialOrderAggregate: OrderAggregate = { order: initialExecution, recallOpened: false, recallJob: null, recoveryAssignments: [], causalHistory: [] }
export function readOrderAggregate(storage: StoragePort): OrderAggregate {
  const raw = storage.getItem(key)
  if (!raw) return initialOrderAggregate
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || !('order' in value) || !value.order ||
    typeof value.order !== 'object' || !('phase' in value.order) || !('revision' in value.order) ||
    !('recallOpened' in value) || typeof value.recallOpened !== 'boolean' ||
    !('causalHistory' in value) || !Array.isArray(value.causalHistory)) throw new Error('Invalid production-order record.')
  const record = value as OrderAggregate
  return { ...record, recallJob: record.recallJob ? { ...record.recallJob, owner: record.recallJob.owner ?? 'production planner' } : null,
    recoveryAssignments: record.recoveryAssignments ?? [] }
}
export function recoveryQueue(aggregate: OrderAggregate, actor: RecallActor): RecallRecoveryAssignment[] {
  return (aggregate.recoveryAssignments ?? []).filter(item => item.assignee === actor && item.status === 'open')
}
export function executeOrder(aggregate: OrderAggregate, action: ExecutionAction): OrderAggregate {
  const order = advanceExecution(aggregate.order, action)
  return { ...aggregate, order, causalHistory: [...aggregate.causalHistory,
    { revision: order.revision, action: action.type, source: 'order-execution' }] }
}
export function recallBlockers(aggregate: OrderAggregate): string[] {
  return aggregate.order.phase === 'complete' ? [] : ['Order PO-8842 must complete quality release before recall scope can be opened.']
}
export function openRecall(aggregate: OrderAggregate, requestId = 'RECALL-LOT-91'): OrderAggregate {
  if (recallBlockers(aggregate).length) throw new Error(recallBlockers(aggregate)[0])
  if (aggregate.recallJob?.id === requestId) return aggregate
  if (aggregate.recallOpened) throw new Error('Recall scope is already open.')
  return { ...aggregate, recallOpened: true, recallJob: { id: requestId, sourceRevision: aggregate.order.revision, status: 'queued', attempts: 0, failureReason: null, owner: 'production planner' }, causalHistory: [...aggregate.causalHistory,
    { revision: aggregate.order.revision, action: 'recall-opened', source: 'lot-genealogy' }] }
}
export function processRecall(aggregate: OrderAggregate): OrderAggregate {
  const job = aggregate.recallJob
  if (job?.status !== 'queued') throw new Error('No queued recall reconciliation exists.')
  if (aggregate.order.revision !== job.sourceRevision) throw new Error('Order revision changed; create a new reconciliation.')
  const attempts = job.attempts + 1
  const status = attempts === 1 ? 'failed' : 'complete'
  const assignment: RecallRecoveryAssignment | null = status === 'failed' ? {
    id: `RECOVERY-${job.id}-${String(attempts)}`, jobId: job.id, sourceRevision: job.sourceRevision,
    assignee: job.owner ?? 'production planner', status: 'open', reason: 'Incomplete lot genealogy index',
  } : null
  return { ...aggregate, recoveryAssignments: [...(aggregate.recoveryAssignments ?? []).map(item =>
    item.status === 'open' ? { ...item, status: 'completed' as const } : item), ...(assignment ? [assignment] : [])],
    recallJob: { ...job, attempts, status,
    failureReason: status === 'failed' ? 'LOT-55 genealogy index was temporarily incomplete.' : null },
    causalHistory: [...aggregate.causalHistory, { revision: aggregate.order.revision, action: 'recall-' + status, source: 'lot-genealogy' }] }
}
export function recallRecoveryPolicy(aggregate: OrderAggregate, actor: RecallActor): RecallPolicy {
  const job = aggregate.recallJob
  const blockers: string[] = []
  if (job?.status !== 'failed') blockers.push('Only a failed recall reconciliation can be retried.')
  if (job && aggregate.order.revision !== job.sourceRevision) blockers.push('Order revision changed; create a new reconciliation.')
  if (job?.owner && job.owner !== actor) blockers.push(`Recall recovery belongs to ${job.owner}.`)
  if (aggregate.recoveryAssignments?.length && !recoveryQueue(aggregate, actor).some(item =>
    item.jobId === job?.id && item.sourceRevision === aggregate.order.revision)) blockers.push('A current recovery assignment must belong to this actor.')
  if (job && job.attempts > 1 && actor !== 'quality approver') blockers.push('Repeated failure requires quality-approver recovery.')
  return { allowed: blockers.length === 0, blockers, queue: job?.status === 'complete' ? 'complete' : job?.status === 'failed' ? 'recovery' : 'reconciliation' }
}
export function reassignRecall(aggregate: OrderAggregate, actor: RecallActor, owner: RecallActor, reason: string): OrderAggregate {
  const job = aggregate.recallJob
  if (actor !== 'quality approver') throw new Error('Only the quality approver may reassign recall recovery.')
  if (job?.status !== 'failed') throw new Error('Only failed recall recovery can be reassigned.')
  if (reason.trim().length < 12) throw new Error('Explain the recall ownership change.')
  if (job.owner === owner) throw new Error('Recall recovery is already assigned to this owner.')
  const current = (aggregate.recoveryAssignments ?? []).find(item => item.jobId === job.id && item.status === 'open')
  const successor: RecallRecoveryAssignment = { id: `RECOVERY-${job.id}-${String(job.attempts)}-${String(aggregate.causalHistory.length + 1)}`,
    jobId: job.id, sourceRevision: job.sourceRevision, assignee: owner, status: 'open', reason,
    ...(current ? { supersedesId: current.id } : {}) }
  return { ...aggregate, recallJob: { ...job, owner },
    recoveryAssignments: [...(aggregate.recoveryAssignments ?? []).map(item => item.id === current?.id ?
      { ...item, status: 'superseded' as const } : item), successor], causalHistory: [...aggregate.causalHistory,
    { revision: aggregate.order.revision, action: 'recall-reassigned', source: 'lot-genealogy', actor, reason }] }
}
export function retryRecall(aggregate: OrderAggregate, actor: RecallActor = 'production planner', operatorId?: string): OrderAggregate {
  const job = aggregate.recallJob
  const policy = recallRecoveryPolicy(aggregate, actor)
  if (!policy.allowed) throw new Error(policy.blockers[0])
  if (!job) throw new Error('No recall reconciliation exists.')
  const claimed = (aggregate.recoveryAssignments ?? []).find(item => item.status === 'open' && item.jobId === job.id)
  if (claimed?.assigneeId && claimed.assigneeId !== operatorId) throw new Error('Recall recovery belongs to another named operator.')
  return { ...aggregate, recallJob: { ...job, status: 'queued', failureReason: null },
    recoveryAssignments: aggregate.recoveryAssignments?.map(item => item.status === 'open' ?
      { ...item, status: 'completed' as const } : item),
    causalHistory: [...aggregate.causalHistory, { revision: aggregate.order.revision, action: 'recall-retried', source: 'lot-genealogy', actor }] }
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
