import { describe, expect, it } from 'vitest'
import { MemoryStorage } from '../../data/memory-storage'
import { executeOrder, openRecall, processRecall, readOrderAggregate, recallBlockers, recallRecoveryPolicy, reassignRecall, reopenOrder, retryRecall, saveOrderAggregate } from './orderLedger'
describe('order execution to recall causality', () => {
  it('persists execution and derives recall eligibility from completed quality release', () => {
    const storage = new MemoryStorage()
    let state = readOrderAggregate(storage)
    expect(recallBlockers(state)).toHaveLength(1)
    for (const action of [{ type: 'release-material' }, { type: 'restore-machine' }, { type: 'start' },
      { type: 'produce', quantity: 120 }, { type: 'approve-quality' }, { type: 'complete' }] as const) {
      state = saveOrderAggregate(storage, executeOrder(state, action))
    }
    expect(readOrderAggregate(storage).order.phase).toBe('complete')
    expect(recallBlockers(state)).toEqual([])
  })
  it('forbids reopening after a recall depends on completed output', () => {
    let state = readOrderAggregate(new MemoryStorage())
    for (const action of [{ type: 'release-material' }, { type: 'restore-machine' }, { type: 'start' },
      { type: 'produce', quantity: 120 }, { type: 'approve-quality' }, { type: 'complete' }] as const) state = executeOrder(state, action)
    expect(reopenOrder(state).order.phase).toBe('quality-hold')
    state = openRecall(state)
    expect(() => reopenOrder(state)).toThrow(/depends/)
    expect(state.causalHistory.at(-1)?.source).toBe('lot-genealogy')
  })
  it('suppresses duplicate recall requests and recovers a deterministic failed reconciliation', () => {
    let state = readOrderAggregate(new MemoryStorage())
    for (const action of [{ type: 'release-material' }, { type: 'restore-machine' }, { type: 'start' },
      { type: 'produce', quantity: 120 }, { type: 'approve-quality' }, { type: 'complete' }] as const) state = executeOrder(state, action)
    const opened = openRecall(state, 'REQ-91')
    expect(openRecall(opened, 'REQ-91')).toBe(opened)
    expect(() => openRecall(opened, 'REQ-92')).toThrow(/already open/)
    const failed = processRecall(opened)
    expect(failed.recallJob).toMatchObject({ status: 'failed', attempts: 1 })
    expect(() => processRecall(failed)).toThrow(/queued/)
    const completed = processRecall(retryRecall(failed))
    expect(completed.recallJob).toMatchObject({ status: 'complete', attempts: 2 })
  })
  it('routes failed recall recovery by durable owner and records supervisor reassignment', () => {
    let state = readOrderAggregate(new MemoryStorage())
    for (const action of [{ type: 'release-material' }, { type: 'restore-machine' }, { type: 'start' },
      { type: 'produce', quantity: 120 }, { type: 'approve-quality' }, { type: 'complete' }] as const) state = executeOrder(state, action)
    const failed = processRecall(openRecall(state))
    expect(recallRecoveryPolicy(failed, 'quality approver')).toMatchObject({ allowed: false, queue: 'recovery' })
    expect(() => retryRecall(failed, 'quality approver')).toThrow(/belongs/)
    expect(() => reassignRecall(failed, 'production planner', 'quality approver', 'Escalate recall recovery.')).toThrow(/Only the quality approver/)
    const reassigned = reassignRecall(failed, 'quality approver', 'quality approver', 'Escalate genealogy-index recovery.')
    expect(recallRecoveryPolicy(reassigned, 'quality approver').allowed).toBe(true)
    expect(recallRecoveryPolicy(reassigned, 'production planner').allowed).toBe(false)
    expect(retryRecall(reassigned, 'quality approver').causalHistory.at(-1)).toMatchObject({ actor: 'quality approver', action: 'recall-retried' })
  })
})
