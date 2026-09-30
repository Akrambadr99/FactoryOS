import { useId, useState, type Dispatch, type SetStateAction } from 'react'
import type { ReservationSnapshot } from './reservations'

interface Props {
  snapshot: ReservationSnapshot
  selection: readonly string[]
  onSelection: Dispatch<SetStateAction<readonly string[]>>
  onReview: () => void
  pending: boolean
}

/** Selection is explicit and independent of the order-detail URL and list filters. */
export function ActiveHoldManager({ snapshot, selection, onSelection, onReview, pending }: Props) {
  const descriptionId = useId()
  const [query, setQuery] = useState(''), [line, setLine] = useState('all'), [page, setPage] = useState(1)
  const active = snapshot.reservations.filter(hold => hold.status === 'active')
  const activeIds = new Set(active.map(hold => hold.id))
  const missing = selection.filter(id => !activeIds.has(id))
  const filtered = active.filter(hold => {
    const holdLine = snapshot.lots.find(lot => lot.id === hold.lotId)?.line
    return (line === 'all' || holdLine === line) && [hold.orderId, hold.lotId, hold.note].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8)), currentPage = Math.min(page, pageCount)
  const visible = filtered.slice((currentPage - 1) * 8, currentPage * 8)
  const visibleIds = new Set(visible.map(hold => hold.id))
  const combined = [...new Set([...selection, ...visibleIds])]
  const hidden = selection.filter(id => !visibleIds.has(id)).length

  return <details className="active-hold-manager"><summary>Manage active holds</summary>
    <section aria-label="Active material holds">
      <h2>Release holds together</h2>
      <p>Choose up to 25 active holds for one atomic release. Review the exact selection and give a reason before anything is saved. This does not sync orders or consume stock.</p>
      <div className="hold-manager-filters"><label>Find active hold<input type="search" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /></label>
        <label>Hold production line<select value={line} onChange={event => { setLine(event.target.value); setPage(1) }}><option value="all">All production lines</option><option value="assembly">Assembly</option><option value="packaging">Packaging</option></select></label></div>
      <p className="reservation-meta">{filtered.length} matching holds · Page {currentPage} of {pageCount}</p>
      <p className="hold-selection-status" role="status">{selection.length} selected · {hidden} outside this view</p>
      {missing.length > 0 && <div className="reservation-warning"><p>{missing.length} selected holds are no longer active in the loaded ledger. Nothing was automatically removed from your selection.</p>
        <button type="button" onClick={() => { onSelection(current => current.filter(id => activeIds.has(id))) }}>Remove unavailable selections</button></div>}
      {selection.length >= 25 && <p className="reservation-meta">Selection limit reached. Deselect a hold before choosing another.</p>}
      {pending && <p className="reservation-meta">Selection changes do not alter your pending request. Retry uses its captured holds and reason.</p>}
      <div className="reservation-actions"><button type="button" disabled={!visible.length || combined.length > 25 || combined.length === selection.length} onClick={() => {
        onSelection(current => { const next = [...new Set([...current, ...visibleIds])]; return next.length <= 25 ? next : current })
      }}>Select visible holds</button>
        <button type="button" disabled={!selection.length} onClick={() => { onSelection(() => []) }}>Clear hold selection</button></div>
      {visible.length ? <ul className="hold-selection-list">{visible.map(hold => <li key={hold.id}>
        <label><input type="checkbox" aria-label={'Select hold ' + hold.id} aria-describedby={descriptionId + '-' + hold.id + '-identity ' + descriptionId + '-' + hold.id + '-quantity'}
          checked={selection.includes(hold.id)} disabled={!selection.includes(hold.id) && selection.length >= 25}
          onChange={event => {
            const checked = event.target.checked
            onSelection(current => checked ? current.includes(hold.id) || current.length >= 25 ? current : [...current, hold.id] : current.filter(id => id !== hold.id))
          }} />
          <span><strong id={descriptionId + '-' + hold.id + '-identity'}>{hold.orderId} · {hold.lotId}</strong><small>Active hold · Created r{hold.createdRevision}</small><span>{hold.note}</span></span>
          <span className="hold-units" id={descriptionId + '-' + hold.id + '-quantity'}>{hold.quantity} units</span></label>
      </li>)}</ul> : <p className="reservation-empty">{active.length ? 'No active holds match. Change the filter; hidden selections remain selected.' : 'No active holds remain. Reservations and release history are preserved.'}</p>}
      <div className="reservation-actions"><button type="button" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1) }}>Previous holds</button>
        <button type="button" disabled={currentPage === pageCount} onClick={() => { setPage(currentPage + 1) }}>Next holds</button>
        <button type="button" className="primary" disabled={pending || !selection.length || selection.length > 25 || missing.length > 0} onClick={onReview}>Review selected releases</button></div>
    </section>
  </details>
}
