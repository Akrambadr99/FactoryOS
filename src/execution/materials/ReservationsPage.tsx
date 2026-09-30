import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageTitle } from '../../components/PageTitle'
import { FocusDialog } from '../../components/FocusDialog'
import { readOrderCollection } from '../order-machine/orderCollection'
import type { OrderCollection } from '../order-machine/orderCollection'
import { createReservationClient, ReservationClientError, type ReservationClient } from './reservationClient'
import { OrderSyncReview } from './OrderSyncReview'
import { ActiveHoldManager } from './ActiveHoldManager'
import type { OrderSyncPreview } from './orderSyncPreview'
import type { MaterialReservation, ReservationCommand, ReservationOrder, ReservationSnapshot, ReservationReleaseBatch } from './reservations'
import './reservations.css'

interface Draft { lotId: string; quantity: string; note: string }
type Pending = { command: ReservationCommand; summary: string } | { batch: ReservationReleaseBatch; summary: string }
interface SyncReview { collection: OrderCollection; sourceFingerprint: string; preview: OrderSyncPreview; stale: boolean; focusOnOpen: boolean }
function eligible(order: ReservationOrder) { return !order.archived && ['material-hold', 'ready'].includes(order.phase) }
function errorMessage(error: unknown) {
  return error instanceof ReservationClientError ? error.message : 'This action could not be completed safely. Your input and saved browser orders are unchanged.'
}
export function ReservationsPage({ client: suppliedClient }: { client?: ReservationClient }) {
  const client = useMemo(() => suppliedClient ?? createReservationClient(), [suppliedClient])
  const [params, setParams] = useSearchParams()
  const latestParams = useRef(params)
  // Search-param setters do not queue functional updates like React state.
  // Compose rapid local edits synchronously; committed navigation also handles Back/Forward.
  useLayoutEffect(() => { latestParams.current = params }, [params])
  const [ledger, setLedger] = useState<ReservationSnapshot | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [release, setRelease] = useState<MaterialReservation | null>(null)
  const [reason, setReason] = useState('')
  const [releaseSelection, setReleaseSelection] = useState<readonly string[]>([])
  const [batchReview, setBatchReview] = useState<{ revision: number; holds: readonly MaterialReservation[] } | null>(null)
  const [batchReason, setBatchReason] = useState('')
  const [syncReview, setSyncReview] = useState<SyncReview | null>(null)
  const [previewing, setPreviewing] = useState(false), [reviewFailed, setReviewFailed] = useState(false)
  const reviewRef = useRef<SyncReview | null>(null), reviewVersion = useRef(0)
  const reviewAbort = useRef<AbortController | null>(null)
  const syncControl = useRef<HTMLButtonElement>(null), focusSync = useRef(false)
  const ledgerRef = useRef<ReservationSnapshot | null>(null)
  const readVersion = useRef(0), writeVersion = useRef(0)
  const readAbort = useRef<AbortController | null>(null), writeAbort = useRef<AbortController | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const feedback = useRef<HTMLParagraphElement>(null)
  const focusFeedback = useRef(false)
  const retryControl = useRef<HTMLButtonElement>(null)
  const focusRetry = useRef(false)
  const selectedId = params.get('order') ?? ''
  const query = params.get('q') ?? ''
  const showAll = params.get('state') === 'all'
  const sort = params.get('sort') === 'line' ? 'line' : 'id'
  const selected = ledger?.orders.find(order => order.id === selectedId)
  const lots = ledger?.lots.filter(lot => lot.line === selected?.line) ?? []
  const draft = drafts[selectedId] ?? { lotId: lots[0]?.id ?? '', quantity: '', note: '' }
  const selectedLot = lots.find(lot => lot.id === draft.lotId)
  const holds = ledger?.reservations.filter(hold => hold.orderId === selectedId) ?? []
  const active = ledger?.reservations.filter(hold => hold.status === 'active') ?? []
  const available = (lotId: string) => (ledger?.lots.find(lot => lot.id === lotId)?.onHand ?? 0) - active.filter(hold => hold.lotId === lotId).reduce((sum, hold) => sum + hold.quantity, 0)
  const quantity = Number(draft.quantity)
  const quantityInvalid = Boolean(draft.quantity) && (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > available(draft.lotId))
  const noteInvalid = Boolean(draft.note) && (draft.note.trim().length < 8 || draft.note.trim().length > 240)
  const alreadyReserved = holds.some(hold => hold.status === 'active' && hold.lotId === draft.lotId)
  useEffect(() => () => {
    readVersion.current++; writeVersion.current++; reviewVersion.current++
    readAbort.current?.abort(); writeAbort.current?.abort(); reviewAbort.current?.abort()
  }, [client])
  useEffect(() => {
    if (saving) return
    if (focusSync.current) { focusSync.current = false; syncControl.current?.focus() }
    else if (focusRetry.current) { focusRetry.current = false; retryControl.current?.focus() }
    else if (focusFeedback.current) {
      focusFeedback.current = false
      const activeElement = document.activeElement
      // Recover focus after removed/disabled decision controls, without stealing
      // it from a newer draft or selection edited while this request was pending.
      if (activeElement === document.body || (activeElement instanceof HTMLButtonElement && activeElement.disabled)) feedback.current?.focus()
    }
  }, [error, notice, saving, previewing])

  function view(changes: Record<string, string>, replace = false) {
    const next = new URLSearchParams(latestParams.current)
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key) }
    latestParams.current = next
    setParams(next, { replace })
  }
  function accept(next: ReservationSnapshot) {
    if (ledgerRef.current && next.revision < ledgerRef.current.revision) {
      throw new ReservationClientError('older_revision', 'The service returned an older ledger. Your current view was kept. Check which data directory the service is using.')
    }
    ledgerRef.current = next; setLedger(next)
  }
  async function refresh() {
    invalidateReview()
    const version = ++readVersion.current
    readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller
    setLoading(true); setError(''); setNotice('')
    try {
      const next = await client.read(controller.signal)
      if (version !== readVersion.current) return
      accept(next); setNotice('Reservations refreshed. Your selection, drafts and any pending request are preserved.')
    } catch (error) { if (version === readVersion.current) setError(errorMessage(error)) }
    finally { if (version === readVersion.current) setLoading(false) }
  }
  async function submit(attempt: Pending) {
    const version = ++writeVersion.current
    const controller = new AbortController(); writeAbort.current = controller
    readVersion.current++; readAbort.current?.abort(); setLoading(false)
    setSaving(true); setError(''); setNotice('')
    try {
      const result = 'batch' in attempt ? await client.releaseBatch(attempt.batch, controller.signal) : await client.execute(attempt.command, controller.signal)
      if (version !== writeVersion.current) return
      readVersion.current++; readAbort.current?.abort(); setLoading(false)
      accept(result.snapshot); pendingRef.current = null; setPending(null)
      if ('batch' in attempt) {
        const completed = new Set(attempt.batch.releases.map(item => item.reservationId))
        setReleaseSelection(current => current.filter(id => !completed.has(id)))
      }
      if ('batch' in attempt || attempt.command.kind === 'release' || attempt.command.kind === 'sync-orders') focusFeedback.current = true
      setNotice((result.replayed ? 'Existing receipt confirmed. ' : 'Saved. ') + attempt.summary + ' Browser order records were not changed.')
    } catch (error) {
      if (version === writeVersion.current) {
        setError(errorMessage(error))
        const activeElement = document.activeElement
        // The closed release dialog cannot restore a disabled trigger. Recover
        // keyboard focus, but do not interrupt someone already editing a draft.
        if (('batch' in attempt || attempt.command.kind === 'release' || attempt.command.kind === 'sync-orders') && (activeElement === document.body ||
          (activeElement instanceof HTMLButtonElement && activeElement.disabled))) focusRetry.current = true
      }
    }
    finally { if (version === writeVersion.current) setSaving(false) }
  }
  function begin(command: ReservationCommand, summary: string) {
    if (pendingRef.current) return
    invalidateReview()
    const attempt = { command, summary }; pendingRef.current = attempt; setPending(attempt); void submit(attempt)
  }
  function reviewBatch() {
    const current = ledgerRef.current
    if (!current || pendingRef.current || !releaseSelection.length || releaseSelection.length > 25) return
    const selectedHolds = releaseSelection.map(id => current.reservations.find(hold => hold.id === id && hold.status === 'active'))
    if (selectedHolds.some(hold => !hold)) { setError('Some selected holds are no longer active. Review the selection before releasing.'); return }
    invalidateReview(); readVersion.current++; readAbort.current?.abort(); setLoading(false)
    setError(''); setBatchReview({ revision: current.revision, holds: selectedHolds.filter((hold): hold is MaterialReservation => Boolean(hold)).map(hold => ({ ...hold })) })
  }
  function confirmBatch() {
    if (!batchReview || pendingRef.current || batchReason.trim().length < 8 || batchReason.trim().length > 240) return
    if (ledgerRef.current?.revision !== batchReview.revision) { setError('The loaded ledger changed. Close the decision and review selected releases again.'); return }
    const batch: ReservationReleaseBatch = { expectedRevision: batchReview.revision, reason: batchReason.trim(),
      releases: batchReview.holds.map(hold => ({ requestId: crypto.randomUUID(), reservationId: hold.id })) }
    const attempt = { batch, summary: `${String(batch.releases.length)} selected material holds released together.` }
    invalidateReview(); setBatchReview(null); pendingRef.current = attempt; setPending(attempt); void submit(attempt)
  }
  function invalidateReview() {
    reviewVersion.current++; reviewAbort.current?.abort()
    reviewRef.current = null; setSyncReview(null); setPreviewing(false); setReviewFailed(false)
  }
  function cancelReview() {
    invalidateReview(); setError(''); setNotice('Sync review cancelled. No synchronization was submitted; your drafts and selection are preserved.')
    focusSync.current = true
  }
  async function syncOrders() {
    if (!ledgerRef.current || pendingRef.current) return
    invalidateReview()
    const version = reviewVersion.current
    const controller = new AbortController(); reviewAbort.current = controller
    readVersion.current++; readAbort.current?.abort(); setLoading(false)
    setPreviewing(true); setError(''); setNotice('')
    try {
      const collection = readOrderCollection(window.localStorage)
      const sourceFingerprint = JSON.stringify(collection)
      const result = await client.previewOrders(collection, controller.signal)
      if (version !== reviewVersion.current) return
      accept(result.snapshot)
      const focusOnOpen = document.activeElement === document.body || document.activeElement === syncControl.current
      const review = { collection, sourceFingerprint, preview: result.preview, stale: false, focusOnOpen }
      reviewRef.current = review; setSyncReview(review)
      setNotice('Order synchronization reviewed. Nothing has been saved. Check the changes before confirming.')
    } catch (error) {
      if (version === reviewVersion.current) {
        setReviewFailed(true)
        setError(error instanceof ReservationClientError ? error.message : 'Saved orders could not be reviewed safely. Check the recovery workspace and service, then review again. No synchronization was submitted.')
      }
    } finally { if (version === reviewVersion.current) setPreviewing(false) }
  }
  function confirmSync() {
    const review = reviewRef.current
    if (!review || review.stale || review.preview.blocked > 0 || review.preview.changes.length === 0 || pendingRef.current) return
    try {
      if (JSON.stringify(readOrderCollection(window.localStorage)) !== review.sourceFingerprint || ledgerRef.current?.revision !== review.preview.revision) {
        const stale = { ...review, stale: true }; reviewRef.current = stale; setSyncReview(stale)
        setError('Saved orders or the loaded ledger changed after review. Review the latest saved orders before confirming.'); return
      }
    } catch {
      const stale = { ...review, stale: true }; reviewRef.current = stale; setSyncReview(stale)
      setError('Saved orders cannot be verified now. Repair the source, then review again. No synchronization was submitted.'); return
    }
    begin({ kind: 'sync-orders', expectedRevision: review.preview.revision, requestId: crypto.randomUUID(), collection: review.collection }, 'Reviewed order references synchronized.')
  }
  function reserve() {
    if (!ledger || !selected || pendingRef.current) return
    if (!eligible(selected) || selectedLot?.line !== selected.line || quantityInvalid || !draft.quantity || noteInvalid || !draft.note.trim() || alreadyReserved) {
      setError('Review the order, available stock, positive whole units and a note of 8–240 characters before reserving.'); return
    }
    begin({ kind: 'reserve', requestId: crypto.randomUUID(), expectedRevision: ledger.revision, orderId: selected.id,
      lotId: draft.lotId, quantity, note: draft.note.trim() }, `${String(quantity)} units reserved for ${selected.id}.`)
  }
  const filtered = (ledger?.orders ?? []).filter(order => (showAll || eligible(order)) &&
    [order.id, order.line, order.phase].some(value => value.toLowerCase().includes(query.trim().toLowerCase())))
    .toSorted((a, b) => (sort === 'line' ? a.line.localeCompare(b.line) : 0) || a.id.localeCompare(b.id))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 8))
  const rawPage = Number(params.get('page') ?? 1)
  const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(rawPage, pageCount)) : 1
  const visible = filtered.slice((page - 1) * 8, page * 8)
  function edit(change: Partial<Draft>) { setDrafts(current => ({ ...current, [selectedId]: { ...draft, ...change } })) }

  return <section className="suite-page reservations-page" aria-label="Material reservations workspace">
    <PageTitle eyebrow="FACTORYOS / MATERIAL CONTROL" title="Material reservations" detail="Coordinate stock commitments before production. Review one order, reserve available units, and keep a traceable release history." />
    <div className="reservation-context"><span className="reservation-environment">Local pilot · Demo inventory</span><p>This separate ledger uses simulated stock quantities. Syncing copies saved order references to this computer’s service. It does not release material in the browser execution workflow, consume stock, or prove real inventory availability.</p></div>
    <section className="reservation-service" aria-label="Reservation service">
      <div><h2>{ledger ? 'Last loaded reservation ledger' : 'Connect your local service'}</h2><p>{ledger ? `Ledger revision ${String(ledger.revision)} · Last successfully loaded state` : 'Start npm run build:server, then npm run start:server. Nothing is sent automatically.'}</p></div>
      <div className="reservation-actions"><button type="button" disabled={loading || saving} onClick={() => { void refresh() }}>{ledger ? 'Refresh reservations' : 'Connect reservation service'}</button>
        {ledger && <button type="button" ref={syncControl} disabled={saving || Boolean(pending) || previewing} onClick={() => { void syncOrders() }}>Sync saved orders</button>}</div>
    </section>
    {!ledger && <details className="reservation-upgrade-help"><summary>Upgrading an existing JSON ledger?</summary>
      <p>The service will not replace it automatically. Stop the service, then run this read-only preview from the repository:</p>
      <code>npm run reservations:migrate -- preview</code>
      <p>Review the counts and source checksum. Apply requires that exact checksum; the original JSON remains preserved. Use the same data directory for preview, apply and the service. Run the migration command with --help for its syntax.</p>
    </details>}
    <p className="reservation-announcement" role="status" aria-live="polite" tabIndex={-1} ref={feedback}>{saving ? 'Saving the captured request… Your newer draft edits will be kept.' : previewing ? 'Reviewing saved orders against the service… No changes are being saved.' : loading ? 'Loading reservation ledger…' : notice}</p>
    {error && <p className="reservation-error" role="alert">{error}</p>}
    {(previewing || reviewFailed) && <section className="order-sync-review" aria-label="Order synchronization preview">
      <h2>{previewing ? 'Preparing order review' : 'Order review unavailable'}</h2><p>Your selection and reservation drafts are preserved. No synchronization was submitted.</p>
      <div className="reservation-actions">{reviewFailed && <button type="button" onClick={() => { void syncOrders() }}>Review latest saved orders</button>}
        <button type="button" onClick={cancelReview}>Cancel sync review</button></div>
    </section>}
    {syncReview && <OrderSyncReview preview={syncReview.preview} stale={syncReview.stale} focusOnOpen={syncReview.focusOnOpen} onCancel={cancelReview} onConfirm={confirmSync} onRefresh={() => { void syncOrders() }} />}
    {pending && <section className="reservation-pending" aria-label="Pending reservation request"><h2>{saving ? 'Request in progress' : 'Request not confirmed'}</h2><p>{pending.summary}</p>
      <p>A retry sends the same captured values and revision. A lost response may mean it already saved. For a revision conflict, refresh, discard this request, then review and submit again explicitly.</p>
      <div className="reservation-actions"><button type="button" ref={retryControl} disabled={saving} onClick={() => { void submit(pending) }}>Retry same request</button><button type="button" disabled={saving} onClick={() => {
        pendingRef.current = null; setPending(null); setError(''); setNotice('Pending request discarded locally. Any saved server change remains; refresh before making another reservation.')
      }}>Discard pending request</button></div><details><summary>Captured request</summary>{'batch' in pending ? <>
        <p>Release batch · Expected revision {pending.batch.expectedRevision} · {pending.batch.releases.length} holds</p><p>Reason: {pending.batch.reason}</p>
        <ul>{pending.batch.releases.map(item => <li key={item.requestId}>{item.reservationId} · Request {item.requestId}</li>)}</ul>
      </> : <p>{pending.command.kind} · Expected revision {pending.command.expectedRevision} · {pending.command.requestId}</p>}</details>
    </section>}
    {ledger && <>
      <dl className="reservation-metrics"><div><dt>Synced orders</dt><dd>{ledger.orders.length}</dd></div><div><dt>Eligible to reserve</dt><dd>{ledger.orders.filter(eligible).length}</dd></div><div><dt>Active holds</dt><dd>{active.length}</dd></div><div><dt>Recorded changes</dt><dd>{ledger.events.length}</dd></div></dl>
      <ActiveHoldManager snapshot={ledger} selection={releaseSelection} onSelection={setReleaseSelection} onReview={reviewBatch} pending={saving || Boolean(pending)} />
      {!ledger.orders.length && <section className="reservation-empty"><h2>Bring your saved orders into view</h2><p>Use Sync saved orders to review the current browser collection, then confirm explicitly. No order is imported automatically. Demo stock is separate from the genealogy indexes used by existing workflows.</p></section>}
      <div className="reservation-layout"><section className="reservation-master" aria-label="Synced orders"><h2>Production orders</h2>
        <label>Find order<input type="search" value={query} onChange={event => { view({ q: event.target.value, page: '' }, true) }} /></label>
        <div className="reservation-filter-row"><label>Order state<select value={showAll ? 'all' : 'eligible'} onChange={event => { view({ state: event.target.value, page: '' }) }}><option value="eligible">Eligible to reserve</option><option value="all">All synced orders</option></select></label>
          <label>Sort orders<select value={sort} onChange={event => { view({ sort: event.target.value, page: '' }) }}><option value="id">Order ID</option><option value="line">Production line</option></select></label></div>
        <p className="reservation-meta">{filtered.length} matching · Page {page} of {pageCount}</p>
        {visible.length ? <ul className="reservation-order-list">{visible.map(order => <li key={order.id}><button type="button" aria-label={'Select order ' + order.id} aria-pressed={selectedId === order.id} onClick={() => { view({ order: order.id }) }}>
          <span><strong>{order.id}</strong><small>{order.line} · Source r{order.sourceRevision}</small></span><span>{order.archived ? 'Archived' : order.phase.replaceAll('-', ' ')}</span>
        </button></li>)}</ul> : <p className="reservation-empty">No orders match. Clear the search, show all orders, or sync your saved collection.</p>}
        <div className="reservation-actions"><button type="button" disabled={page === 1} onClick={() => { view({ page: String(page - 1) }) }}>Previous orders</button><button type="button" disabled={page === pageCount} onClick={() => { view({ page: String(page + 1) }) }}>Next orders</button></div>
      </section><section className="reservation-detail" aria-label="Selected order reservations">{selected ? <>
        <div className="reservation-detail-title"><div><small>SELECTED ORDER</small><h2>{selected.id}</h2><p>{selected.line} · Target {selected.target} units · {selected.archived ? 'Archived' : selected.phase.replaceAll('-', ' ')}</p></div><Link to={'/execution/orders/' + encodeURIComponent(selected.id)}>Open browser order</Link></div>
        {!visible.some(order => order.id === selected.id) && <p className="reservation-meta">This selection remains open outside the current list view.</p>}
        {!eligible(selected) && <p className="reservation-warning">This order cannot receive new reservations. Only non-archived material-hold or ready orders are eligible. Existing holds can still be released.</p>}
        <form className="reservation-form" onSubmit={event => { event.preventDefault(); reserve() }}>
          <h3>Reserve stock</h3><label>Stock lot<select value={draft.lotId} onChange={event => { edit({ lotId: event.target.value }) }}>{!selectedLot && <option value={draft.lotId} disabled>Choose a compatible lot · retained draft needs review</option>}{lots.map(lot => <option key={lot.id} value={lot.id}>{lot.label} · {lot.id}</option>)}</select></label>
          {!selectedLot && <p className="reservation-warning">The draft lot is not compatible with this order’s current production line. Choose a listed lot; your quantity and note have been kept.</p>}
          {selectedLot && <p className="reservation-stock" aria-live="polite"><strong>{available(selectedLot.id)} available</strong> of {selectedLot.onHand} demo units · Shared across all orders</p>}
          <label>Units to reserve<input type="number" min="1" step="1" max={available(draft.lotId)} value={draft.quantity} aria-invalid={quantityInvalid} aria-describedby="reservation-quantity-help" onChange={event => { edit({ quantity: event.target.value }) }} /></label>
          <p id="reservation-quantity-help" className={quantityInvalid ? 'reservation-field-error' : 'reservation-meta'}>{quantityInvalid ? 'Enter positive whole units no greater than the available stock.' : 'Use whole units. Final availability is checked atomically by the service.'}</p>
          <label>Reservation note<textarea rows={3} maxLength={240} value={draft.note} aria-invalid={noteInvalid} aria-describedby="reservation-note-help" onChange={event => { edit({ note: event.target.value }) }} /></label>
          <p id="reservation-note-help" className={noteInvalid ? 'reservation-field-error' : 'reservation-meta'}>Explain the purpose in 8–240 characters. Do not include confidential or customer information.</p>
          {alreadyReserved && <p className="reservation-warning">This order already has an active hold on this lot. Release it before creating a replacement.</p>}
          <button className="primary" type="submit" disabled={saving || Boolean(pending) || !eligible(selected) || !selectedLot || alreadyReserved || quantityInvalid || !draft.quantity || noteInvalid || !draft.note.trim()}>Reserve material</button>
        </form>
        <section className="reservation-holds" aria-label="Order material holds"><h3>Reservation history</h3>{holds.length ? <ul>{holds.toReversed().map(hold => <li key={hold.id}>
          <div><strong>{hold.quantity} units · {hold.lotId}</strong><span>{hold.status === 'active' ? 'Active hold' : 'Released'} · Revision {hold.createdRevision}</span><p>{hold.note}</p>{hold.releaseReason && <p>Release: {hold.releaseReason}</p>}</div>
          {hold.status === 'active' && <button type="button" aria-label={'Release ' + hold.id} disabled={saving || Boolean(pending)} onClick={() => { invalidateReview(); setReason(''); setRelease(hold) }}>Release hold</button>}
        </li>)}</ul> : <p>No reservations for this order yet.</p>}</section>
      </> : <div className="reservation-empty"><h2>{selectedId ? 'Order is not in this ledger' : 'Select an order'}</h2><p>{selectedId ? 'Sync saved orders or choose a synced order. Your URL selection has been kept.' : 'Choose a production order to review available stock and reservation history.'}</p></div>}</section></div>
      <details className="reservation-audit"><summary>Ledger activity · {ledger.events.length} changes</summary><ol>{ledger.events.toReversed().slice(0, 30).map(event => <li key={event.sequence}><span>r{event.sequence}</span> {event.summary}</li>)}</ol><p>Showing the latest 30 changes. The service retains the bounded ledger history.</p></details>
    </>}
    {batchReview && <FocusDialog title="Release selected material holds" onClose={() => { setBatchReview(null) }}>
      <p>Release all units in these {batchReview.holds.length} captured holds together? Either every release is saved or none is. The holds and their history remain recorded.</p>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- This labelled overflow container needs keyboard focus for scrolling; Chromium covers its full 25-row capture. */}
      <ul className="release-batch-capture" aria-label="Captured holds" tabIndex={0}>{batchReview.holds.map(hold => <li key={hold.id}><strong>{hold.orderId}</strong><span>{hold.lotId} · {hold.quantity} units</span></li>)}</ul>
      <p>Reviewed ledger revision {batchReview.revision}. Another service change may cause a conflict; it will not be silently rebased.</p>
      {ledger?.revision !== batchReview.revision && <p role="alert">The loaded ledger changed. Close and review selected releases again before confirming.</p>}
      <form onSubmit={event => { event.preventDefault(); confirmBatch() }}><label>Batch release reason<textarea rows={3} maxLength={240} value={batchReason}
        aria-invalid={Boolean(batchReason) && batchReason.trim().length < 8} aria-describedby="batch-release-help" onChange={event => { setBatchReason(event.target.value) }} /></label>
        <p id="batch-release-help">Give a shared reason, 8–240 characters. It will be recorded on every captured release.</p>
        <div className="reservation-actions"><button type="button" onClick={() => { setBatchReview(null) }}>Keep selected holds</button>
          <button type="submit" disabled={batchReason.trim().length < 8 || batchReason.trim().length > 240 || saving || Boolean(pending) || ledger?.revision !== batchReview.revision}>Release selected holds</button></div>
      </form>
    </FocusDialog>}
    {release && ledger && <FocusDialog title="Release material reservation" onClose={() => { setRelease(null) }}>
      <p>Release all {release.quantity} units of {release.lotId} held for <strong>{release.orderId}</strong>? Units become available to other orders. The reservation and its history remain recorded.</p>
      <form onSubmit={event => { event.preventDefault(); if (reason.trim().length < 8 || reason.trim().length > 240 || pendingRef.current) return
        const command: ReservationCommand = { kind: 'release', requestId: crypto.randomUUID(), expectedRevision: ledger.revision, reservationId: release.id, reason: reason.trim() }
        const summary = `Reservation released for ${release.orderId}.`; setRelease(null); begin(command, summary)
      }}><label>Release reason<textarea value={reason} maxLength={240} rows={3} aria-describedby="release-reason-help" onChange={event => { setReason(event.target.value) }} /></label>
        <p id="release-reason-help">Give a specific reason, 8–240 characters.</p><div className="reservation-actions"><button type="button" onClick={() => { setRelease(null) }}>Keep reservation</button><button type="submit" disabled={reason.trim().length < 8 || saving || Boolean(pending)}>Release reservation</button></div></form>
    </FocusDialog>}
  </section>
}
