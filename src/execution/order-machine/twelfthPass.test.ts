import { describe, expect, it } from 'vitest'
import { initialOrderAggregate, processRecall, recallRecoveryPolicy, reassignRecall, recoveryQueue, retryRecall } from './orderLedger'

describe('recall recovery handoff', () => {
  it('moves failed work to quality while preserving the superseded owner', () => {
    const opened = { ...initialOrderAggregate, recallOpened: true, recallJob: {
      id: 'RECALL-91', sourceRevision: initialOrderAggregate.order.revision, status: 'queued' as const,
      attempts: 0, failureReason: null, owner: 'production planner' as const } }
    const failed = processRecall(opened)
    expect(recoveryQueue(failed, 'production planner')).toHaveLength(1)
    const reassigned = reassignRecall(failed, 'quality approver', 'quality approver', 'Quality oversight required after incomplete index.')
    expect(reassigned.recoveryAssignments?.map(item => item.status)).toEqual(['superseded', 'open'])
    expect(recallRecoveryPolicy(reassigned, 'production planner').allowed).toBe(false)
    expect(retryRecall(reassigned, 'quality approver').recoveryAssignments?.at(-1)?.status).toBe('completed')
  })
})
