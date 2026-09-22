import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { recoveryOperators } from './recoveryWorkload'
import { archiveOrder, bulkRetryOrders, claimOrderRecovery, createOrder, getOrder,
  orderCollectionSummary, orderRecoveryInbox, readOrderCollection, retryOrderRecovery,
  saveOrderCollection, setLotIndexAvailability, visibleOrders } from './orderCollection'

export function OrderCollectionPage() {
  const [collection, setCollection] = useState(() => readOrderCollection(window.localStorage))
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('active')
  const [operatorId, setOperatorId] = useState('planner-ada')
  const [checked, setChecked] = useState<string[]>([])
  const [newId, setNewId] = useState('')
  const [notice, setNotice] = useState('')
  const selectedId = params.get('order') ?? 'PO-8843'
  const selected = collection.orders.find(item => item.id === selectedId)
  const rows = visibleOrders(collection, query, filter)
  const inbox = orderRecoveryInbox(collection)
  const summary = orderCollectionSummary(collection)
  function persist(next: typeof collection, message: string) {
    setCollection(saveOrderCollection(window.localStorage, next))
    setNotice(message)
  }
  function choose(id: string) { setParams(current => { const next = new URLSearchParams(current); next.set('order', id); return next }) }
  function run(action: () => typeof collection, success: string) {
    try { persist(action(), success) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Order operation failed.') }
  }
  return <main className="suite-page">
    <header className="suite-title"><div><small>PRODUCTION / GENEALOGY RECOVERY</small>
      <h1>Order recovery workspace</h1>
      <p>Persisted orders, lot-index dependencies and named reconciliation responsibility.</p></div></header>
    <section className="metrics" aria-label="Recovery summary">
      <article><small>Active orders</small><strong>{summary.active}</strong></article>
      <article><small>Failed recalls</small><strong>{summary.failed}</strong></article>
      <article><small>Unclaimed recovery</small><strong>{summary.unclaimed}</strong></article>
      <article><small>Archived</small><strong>{summary.archived}</strong></article>
    </section>
    <section className="suite-card" aria-label="Recovery queue">
      <h2>Recovery queue</h2>
      {inbox.length ? <ul>{inbox.map(item => <li key={item.orderId + item.jobId}>
        <button onClick={() => { choose(item.orderId) }}>{item.orderId}</button> · {item.jobId} ·
        {item.assigneeId ?? 'team queue'} · {item.actionable ? 'actionable' : 'blocked'}
      </li>)}</ul> : <p>No open recovery assignments.</p>}
      <label>Recovery operator <select value={operatorId} onChange={event => { setOperatorId(event.target.value) }}>
        {recoveryOperators.map(item => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}
      </select></label>
      <button onClick={() => {
        const role = recoveryOperators.find(item => item.id === operatorId)?.role ?? 'production planner'
        const result = bulkRetryOrders(collection, checked, role, operatorId)
        persist(result.collection, `${String(result.updated.length)} retried; ${String(result.skipped.length)} skipped; ${String(result.blocked.length)} blocked.`)
      }} disabled={!checked.length}>Retry selected recoveries</button>
    </section>
    <section className="suite-card" aria-label="Order collection">
      <h2>Production orders</h2>
      <div className="filters"><label>Search orders <input value={query} onChange={event => { setQuery(event.target.value) }} /></label>
        <label>Show <select value={filter} onChange={event => { setFilter(event.target.value) }}>
          <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
        </select></label></div>
      {rows.length ? <ul>{rows.map(record => <li key={record.id}>
        <label><input type="checkbox" checked={checked.includes(record.id)} onChange={event => {
          setChecked(current => event.target.checked ? [...current, record.id] : current.filter(id => id !== record.id))
        }} /> Select {record.id}</label>
        <button aria-current={selectedId === record.id ? 'true' : undefined} onClick={() => { choose(record.id) }}>
          {record.id} · {record.line} · {record.aggregate.recallJob?.status ?? record.aggregate.order.phase}
        </button><small> r{record.aggregate.order.revision} · {record.lotIndexId}{record.archived ? ' · archived' : ''}</small>
      </li>)}</ul> : <p>No orders match this view.</p>}
      <form onSubmit={event => { event.preventDefault(); run(() => createOrder(collection, newId, 'assembly', 'LOT-55'), 'Order created.'); setNewId('') }}>
        <label>New production order ID <input value={newId} onChange={event => { setNewId(event.target.value) }} pattern="PO-[0-9]{4,}" required /></label>
        <button type="submit">Create assembly order</button>
      </form>
    </section>
    <section className="suite-card" aria-label="Selected order">
      <h2>{selected ? selected.id : 'Select an order'}</h2>
      {selected && <><p>Line {selected.line} · Lot index {selected.lotIndexId} · Order revision {selected.aggregate.order.revision}</p>
        <p>Phase {selected.aggregate.order.phase} · Recall {selected.aggregate.recallJob?.status ?? 'none'}</p>
        <p>Named owner {selected.aggregate.recoveryAssignments?.find(item => item.status === 'open')?.assigneeId ?? 'unclaimed'}</p>
        <button onClick={() => { run(() => claimOrderRecovery(collection, selected.id, operatorId,
          selected.aggregate.order.revision), 'Recovery claimed by named operator.') }}>Claim recovery</button>
        <button onClick={() => { run(() => retryOrderRecovery(collection, selected.id,
          recoveryOperators.find(item => item.id === operatorId)?.role ?? 'production planner', operatorId),
          'Selected recall queued for retry.') }}>Retry selected order</button>
        <button onClick={() => { run(() => archiveOrder(collection, selected.id), 'Order archived.') }}>Archive order</button>
        <button onClick={() => {
          const lot = collection.lotIndexes.find(item => item.id === selected.lotIndexId)
          if (!lot) return
          try { const result = setLotIndexAvailability(collection, lot.id, !lot.available, 'quality approver', lot.revision)
            persist(result.collection, `${String(result.updated.length)} related orders updated; ${String(result.skipped.length)} unchanged.`)
          } catch (error) { setNotice(error instanceof Error ? error.message : 'Lot update failed.') }
        }}>Toggle related lot index</button>
        <p>Lot availability: {collection.lotIndexes.find(item => item.id === selected.lotIndexId)?.available ? 'available' : 'unavailable'}</p>
        <details><summary>Record history</summary><ol>{getOrder(collection, selected.id).aggregate.causalHistory.map((item, index) =>
          <li key={index}>{item.action} · r{item.revision} · {item.source}</li>)}</ol></details>
      </>}
    </section>
    <section className="suite-card" aria-label="Collection audit"><h2>Collection audit</h2>
      <ol>{collection.events.toReversed().slice(0, 8).map(item => <li key={item.sequence}>
        {item.action} · {item.targetId} · related {item.relatedIds.join(', ') || 'none'} · {item.actor}
      </li>)}</ol></section>
    <p role="status">{notice}</p>
  </main>
}
