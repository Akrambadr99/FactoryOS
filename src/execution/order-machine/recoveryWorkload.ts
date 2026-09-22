import type { OrderAggregate, RecallActor } from './orderLedger'

export interface RecoveryOperator {
  id: string
  name: string
  role: RecallActor
  lines: readonly string[]
  maxOpen: number
  available: boolean
}
export interface OrderRecoveryRecord { orderId: string; line: string; aggregate: OrderAggregate }
export interface RecoveryWorkItem { orderId: string; jobId: string; assigneeId: string | null; attempt: number; actionable: boolean }

export const recoveryOperators: readonly RecoveryOperator[] = [
  { id: 'planner-ada', name: 'Ada Mensah', role: 'production planner', lines: ['assembly'], maxOpen: 2, available: true },
  { id: 'planner-jon', name: 'Jon Vega', role: 'production planner', lines: ['packaging'], maxOpen: 1, available: true },
  { id: 'quality-ines', name: 'Ines Park', role: 'quality approver', lines: ['assembly', 'packaging'], maxOpen: 2, available: true },
]

export function recoveryWorkInbox(records: readonly OrderRecoveryRecord[], actorId?: string): RecoveryWorkItem[] {
  return records.flatMap(({ orderId, aggregate }) => (aggregate.recoveryAssignments ?? [])
    .filter(item => item.status === 'open').map(item => ({ orderId, jobId: item.jobId,
      assigneeId: item.assigneeId ?? null, attempt: aggregate.recallJob?.attempts ?? 0,
      actionable: aggregate.recallJob?.status === 'failed' && aggregate.recallJob.sourceRevision === aggregate.order.revision,
    }))).filter(item => actorId === undefined || item.assigneeId === actorId)
    .sort((a, b) => Number(b.actionable) - Number(a.actionable) || b.attempt - a.attempt || a.orderId.localeCompare(b.orderId))
}
export function recoveryLoad(records: readonly OrderRecoveryRecord[], actorId: string): number {
  return recoveryWorkInbox(records, actorId).filter(item => item.actionable).length
}
export function recoveryEligibility(records: readonly OrderRecoveryRecord[], record: OrderRecoveryRecord, actorId: string): string[] {
  const actor = recoveryOperators.find(item => item.id === actorId)
  const assignment = (record.aggregate.recoveryAssignments ?? []).find(item => item.status === 'open')
  const blockers: string[] = []
  if (!actor?.available) blockers.push('Recovery operator is unavailable.')
  if (actor && !actor.lines.includes(record.line)) blockers.push('Operator is not qualified for this production line.')
  if (actor && assignment && actor.role !== assignment.assignee) blockers.push('Recovery requires the assigned department role.')
  if (actor && recoveryLoad(records, actorId) >= actor.maxOpen) blockers.push('Recovery operator is at capacity.')
  return blockers
}
export function claimRecovery(record: OrderRecoveryRecord, actorId: string, records: readonly OrderRecoveryRecord[], expectedRevision: number): OrderAggregate {
  const state = record.aggregate
  if (state.order.revision !== expectedRevision) throw new Error('Order revision changed before recovery claim.')
  const assignment = (state.recoveryAssignments ?? []).find(item => item.status === 'open')
  if (!assignment || state.recallJob?.status !== 'failed') throw new Error('No failed recall recovery is available.')
  if (assignment.assigneeId) throw new Error('Recovery is already claimed by an operator.')
  const blockers = recoveryEligibility(records, record, actorId)
  if (blockers.length) throw new Error(blockers[0])
  return { ...state, recoveryAssignments: state.recoveryAssignments?.map(item => item.id === assignment.id ?
    { ...item, assigneeId: actorId } : item), causalHistory: [...state.causalHistory,
      { revision: state.order.revision, action: 'recovery-claimed', source: 'recovery-work-queue', actor: assignment.assignee, reason: actorId }] }
}
