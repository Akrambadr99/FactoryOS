export interface WorkflowRecord { id: string; status: string }
export interface BulkTransition { recordId: string; from: string; to: string }
export interface BulkSkip { recordId: string; reason: string }
export function planBulkTransition(records: readonly WorkflowRecord[], selectedIds: ReadonlySet<string>, to: string, transitions: Readonly<Record<string, readonly string[]>>): { operations: BulkTransition[]; skipped: BulkSkip[] } {
  const operations: BulkTransition[] = []
  const skipped: BulkSkip[] = []
  for (const record of records.filter(item => selectedIds.has(item.id))) {
    if (record.status === to) skipped.push({ recordId: record.id, reason: 'Record already has the target status.' })
    else if (!(transitions[record.status] ?? []).includes(to)) skipped.push({ recordId: record.id, reason: 'Transition is not allowed.' })
    else operations.push({ recordId: record.id, from: record.status, to })
  }
  return { operations, skipped }
}
