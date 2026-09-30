import { describe, expect, it } from 'vitest'
import { orderTriage } from './collectionTriage'
import { seedOrderCollection } from './orderCollection'
import { recordDecisionPath } from './recordLinks'
import { evaluateScenario } from '../lot-genealogy/scenario'

describe('production recovery triage', () => {
  it('opens a decision workflow with a valid trace depth', () => {
    const record = seedOrderCollection().orders[0]!
    const url = new URL(recordDecisionPath(record), 'https://test.invalid')
    expect(url.searchParams.get('record')).toBe(record.id)
    expect(() => evaluateScenario(Number(url.searchParams.get('depth')))).not.toThrow()
  })
  it('separates production completion from recall failure', () => {
    const records = seedOrderCollection().orders
    expect(records.map(orderTriage.state)).toEqual(['production-active', 'recall-failed', 'recall-failed', 'recall-failed', 'production-complete', 'production-complete'])
  })
  it('prioritizes stale recovery evidence over a failed recall', () => {
    const record = seedOrderCollection().orders[1]!
    expect(orderTriage.state({ ...record, aggregate: { ...record.aggregate,
      recoveryAssignments: record.aggregate.recoveryAssignments?.map(item => ({ ...item, status: 'stale' })) } })).toBe('stale')
  })
  it('searches linked lot and active named operator without stale claims', () => {
    const record = seedOrderCollection().orders[1]!
    const claimed = { ...record, aggregate: { ...record.aggregate,
      recoveryAssignments: record.aggregate.recoveryAssignments?.map(item => ({ ...item, assigneeId: 'planner-ada' })) } }
    expect(orderTriage.searchText(claimed)).toContain('assembly LOT-55 planner-ada')
    expect(orderTriage.revision(claimed)).toBe(7)
  })
})
