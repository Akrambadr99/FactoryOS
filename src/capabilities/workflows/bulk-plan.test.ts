import { describe, expect, it } from 'vitest'
import { planBulkTransition } from './bulk-plan'
const records = [{ id: 'a', status: 'draft' }, { id: 'b', status: 'active' }, { id: 'c', status: 'closed' }]
describe('bulk transition plan', () => {
  it('separates eligible and skipped records', () => { const plan = planBulkTransition(records, new Set(['a', 'b', 'c']), 'active', { draft: ['active'], active: ['closed'], closed: [] }); expect(plan.operations.map(item => item.recordId)).toEqual(['a']); expect(plan.skipped).toHaveLength(2) })
  it('ignores records outside the selection', () => expect(planBulkTransition(records, new Set(['a']), 'active', { draft: ['active'] }).operations).toHaveLength(1))
})
