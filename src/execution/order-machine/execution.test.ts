import { describe, expect, it } from 'vitest'
import { advanceExecution, executionFinding, initialExecution } from './execution'

describe('production order execution', () => {
  it('blocks starting while material and machine evidence are absent', () => {
    expect(executionFinding(initialExecution, { type: 'start' })).toMatch(/material hold/)
    const released = advanceExecution(initialExecution, { type: 'release-material' })
    expect(executionFinding(released, { type: 'start' })).toMatch(/downtime/)
  })
  it('requires a positive integral quantity and enforces the target', () => {
    const ready = advanceExecution(advanceExecution(initialExecution, { type: 'release-material' }), { type: 'restore-machine' })
    const running = advanceExecution(ready, { type: 'start' })
    expect(executionFinding(running, { type: 'produce', quantity: 0 })).toMatch(/positive/)
    expect(executionFinding(running, { type: 'produce', quantity: 121 })).toMatch(/exceed/)
    expect(advanceExecution(running, { type: 'produce', quantity: 120 }).phase).toBe('quality-hold')
  })
  it('requires independent quality approval before completion', () => {
    const ready = advanceExecution(advanceExecution(initialExecution, { type: 'release-material' }), { type: 'restore-machine' })
    const held = advanceExecution(advanceExecution(ready, { type: 'start' }), { type: 'produce', quantity: 120 })
    expect(executionFinding(held, { type: 'complete' })).toMatch(/approval/)
    const completed = advanceExecution(advanceExecution(held, { type: 'approve-quality' }), { type: 'complete' })
    expect(completed.phase).toBe('complete')
    expect(completed.revision).toBe(7)
    expect(completed.history).toHaveLength(6)
    expect(() => advanceExecution(completed, { type: 'start' })).toThrow(/cannot be changed/)
  })
})
