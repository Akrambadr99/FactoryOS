import { describe, expect, it } from 'vitest'
import { initialOrderAggregate, retryRecall } from './orderLedger'
import type { OrderAggregate } from './orderLedger'
import { claimRecovery, recoveryWorkInbox } from './recoveryWorkload'

function failed(id: string): OrderAggregate {
  return { ...initialOrderAggregate, order: { ...initialOrderAggregate.order, phase: 'complete', revision: 7 },
    recallOpened: true, recallJob: { id, sourceRevision: 7, status: 'failed', attempts: 1,
      failureReason: 'Genealogy index unavailable.', owner: 'production planner' },
    recoveryAssignments: [{ id: `R-${id}`, jobId: id, sourceRevision: 7, assignee: 'production planner',
      status: 'open', reason: 'Genealogy index unavailable.' }] }
}

describe('named recall recovery routing', () => {
  it('projects multiple orders and requires the named claimant to retry', () => {
    const first = { orderId: 'PO-1', line: 'assembly', aggregate: failed('R-1') }
    const second = { orderId: 'PO-2', line: 'assembly', aggregate: failed('R-2') }
    const records = [first, second]
    expect(recoveryWorkInbox(records).map(item => item.orderId)).toEqual(['PO-1', 'PO-2'])
    const claimed = claimRecovery(first, 'planner-ada', records, 7)
    expect(() => retryRecall(claimed, 'production planner', 'planner-jon')).toThrow(/another named/)
    expect(retryRecall(claimed, 'production planner', 'planner-ada').recallJob?.status).toBe('queued')
    expect(() => claimRecovery({ ...first, aggregate: claimed }, 'planner-ada', records, 7)).toThrow(/already claimed/)
  })

  it('enforces line qualification, role and a stale order revision', () => {
    const record = { orderId: 'PO-1', line: 'assembly', aggregate: failed('R-1') }
    expect(() => claimRecovery(record, 'planner-jon', [record], 7)).toThrow(/production line/)
    expect(() => claimRecovery(record, 'quality-ines', [record], 7)).toThrow(/department role/)
    expect(() => claimRecovery(record, 'planner-ada', [record], 6)).toThrow(/revision changed/)
  })
})
