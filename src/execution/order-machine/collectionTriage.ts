import type { ExplorerPolicy } from '../../workspace/collectionExplorer'
import type { ProductionOrderRecord } from './orderCollection'

// Recovery evidence takes precedence over the underlying production phase.
export const orderTriage: ExplorerPolicy<ProductionOrderRecord> = {
  searchText: record => [record.id, record.line, record.lotIndexId,
    ...(record.aggregate.recoveryAssignments ?? []).filter(item => item.status === 'open').map(item => item.assigneeId ?? '')].join(' '),
  revision: record => record.aggregate.order.revision,
  state: record => {
    const { aggregate } = record
    if (aggregate.recoveryAssignments?.some(item => item.status === 'stale')) return 'stale'
    if (aggregate.recallJob) return `recall-${aggregate.recallJob.status}`
    return aggregate.order.phase === 'complete' ? 'production-complete' : 'production-active'
  },
  states: [
    { value: 'stale', label: 'Stale recovery evidence' },
    { value: 'recall-failed', label: 'Failed recall' },
    { value: 'recall-queued', label: 'Queued recall' },
    { value: 'recall-complete', label: 'Completed recall' },
    { value: 'production-complete', label: 'Production complete' },
    { value: 'production-active', label: 'Production not complete' },
  ],
}
