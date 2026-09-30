import { useEffect, useRef, useState } from 'react'
import type { OrderSyncField, OrderSyncPreview } from './orderSyncPreview'
import type { ReservationOrder } from './reservations'

const fieldNames: Record<OrderSyncField, string> = {
  line: 'Production line', phase: 'Phase', archived: 'Archive state', sourceRevision: 'Source revision', target: 'Target units',
}
function value(order: ReservationOrder | null, field: OrderSyncField): string {
  if (!order) return 'Not present'
  if (field === 'archived') return order.archived ? 'Archived' : 'Active'
  return String(order[field]).replaceAll('-', ' ')
}
interface Props {
  preview: OrderSyncPreview
  stale: boolean
  focusOnOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  onRefresh: () => void
}

/** Review is a full catalog replacement, never a selectable partial import. */
export function OrderSyncReview({ preview, stale, focusOnOpen, onConfirm, onCancel, onRefresh }: Props) {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(1)
  const [acknowledged, setAcknowledged] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (focusOnOpen) heading.current?.focus() }, [focusOnOpen])
  const changes = preview.changes.filter(change => change.id.toLowerCase().includes(query.trim().toLowerCase()) &&
    (filter === 'all' || (filter === 'blocked' ? change.activeHoldIds.length > 0 : change.kind === filter)))
  const pageCount = Math.max(1, Math.ceil(changes.length / 8))
  const visiblePage = Math.min(page, pageCount)
  const visible = changes.slice((visiblePage - 1) * 8, visiblePage * 8)
  const cannotConfirm = stale || preview.blocked > 0 || preview.changes.length === 0 || (preview.removed > 0 && !acknowledged)

  return <section className="order-sync-review" aria-label="Review order synchronization">
    <header><div><p className="reservation-meta">ORDER REFERENCE REVIEW · LEDGER r{preview.revision}</p>
      <h2 ref={heading} tabIndex={-1}>Review order synchronization</h2></div>
      <button type="button" onClick={onCancel}>Cancel sync review</button></header>
    <p>This replaces the service’s order references with the captured browser collection. It does not merge selected rows, change browser orders, release holds, or transfer ownership to the service. Nothing has been saved.</p>
    <dl className="order-sync-counts"><div><dt>Added</dt><dd>{preview.added}</dd></div><div><dt>Updated</dt><dd>{preview.updated}</dd></div>
      <div><dt>Removed</dt><dd>{preview.removed}</dd></div><div><dt>Unchanged</dt><dd>{preview.unchanged}</dd></div></dl>
    <p className="reservation-meta">{preview.sourceCount} order references after confirmation. Filtering below changes only this review, never the set to synchronize.</p>
    {stale && <p className="reservation-warning" role="status">This review is out of date. Review the latest saved orders before confirming. No sync request was sent.</p>}
    {preview.blocked > 0 && <p className="reservation-warning">{preview.blocked} changed orders have active material holds. Cancel this review, resolve the holds, then review again. The entire synchronization is blocked; no partial changes will be saved.</p>}
    {preview.changes.length === 0 ? <p className="reservation-empty">Order references already match. No synchronization is needed and no history entry will be added.</p> : <>
      <div className="order-sync-filters"><label>Find changed order<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /></label>
        <label>Review changes<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1) }}>
          <option value="all">All changes</option><option value="added">Added</option><option value="updated">Updated</option><option value="removed">Removed</option><option value="blocked">Blocked by holds</option>
        </select></label></div>
      <p className="reservation-meta" role="status">{changes.length} matching changes · Page {visiblePage} of {pageCount}</p>
      {visible.length ? <ul className="order-sync-changes">{visible.map(change => <li key={change.id}>
        <h3>{change.id} · {change.kind === 'added' ? 'Add' : change.kind === 'updated' ? 'Update' : 'Remove'}</h3>
        {change.activeHoldIds.length > 0 && <p className="reservation-field-error">Blocked by {change.activeHoldIds.length} active holds. Existing reservations and history stay intact.</p>}
        <dl>{change.fields.map(field => <div key={field}><dt>{fieldNames[field]}</dt><dd><span>Before: {value(change.before, field)}</span><span>After: {value(change.after, field)}</span></dd></div>)}</dl>
      </li>)}</ul> : <p className="reservation-empty">No changes match this filter. Clear the search or choose another change type.</p>}
      <div className="reservation-actions"><button type="button" disabled={visiblePage === 1} onClick={() => { setPage(visiblePage - 1) }}>Previous changes</button>
        <button type="button" disabled={visiblePage === pageCount} onClick={() => { setPage(visiblePage + 1) }}>Next changes</button></div>
    </>}
    {preview.removed > 0 && <label className="order-sync-acknowledgment"><input type="checkbox" checked={acknowledged} onChange={event => { setAcknowledged(event.target.checked) }} />
      <span>I understand removed order references leave this ledger; recorded history stays.</span></label>}
    <footer><p className="reservation-meta">Confirmation uses this reviewed ledger revision. Another service change can still cause a conflict; it will not be silently rebased.</p>
      <div className="reservation-actions"><button type="button" onClick={onRefresh}>Review latest saved orders</button>
        <button type="button" className="primary" disabled={cannotConfirm} onClick={onConfirm}>Confirm order sync</button></div></footer>
  </section>
}
