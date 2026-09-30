import { readOrderCollection } from './orderCollection'
import { SelectedRecordRoute } from './SelectedRecordRoute'
import { useRecordContext } from '../../workspace/RecordScope'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { executionFinding } from './execution'
import type { ExecutionAction } from './execution'
import { executeOrder, readOrderAggregate, reopenOrder, saveOrderAggregate } from './orderLedger'

function RecordContent() {
  const { storage, guard, recordId } = useRecordContext()

  const orderId = recordId
  const selectedOrder = readOrderCollection(storage).orders.find(item => item.id === recordId)
  const [aggregate, setAggregate] = useState(() => readOrderAggregate(storage))
  const order = aggregate.order
  const [quantity, setQuantity] = useState(120)
  const [notice, setNotice] = useState('')
  function act(action: ExecutionAction) {
    const finding = executionFinding(order, action)
    if (finding) { setNotice(finding); return }
    setAggregate(saveOrderAggregate(storage, executeOrder(aggregate, action)))
    setNotice(`${action.type} recorded at revision ${String(order.revision + 1)}.`)
  }
  function reopen() {
    try { setAggregate(saveOrderAggregate(storage, reopenOrder(aggregate))); setNotice('Order reopened for quality review.') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Reopening failed.') }
  }
  if (orderId && orderId !== order.id) return <main className="suite-page"><p role="alert">Order {orderId} was not found.</p></main>
  return <div className="suite-page">
    <header className="suite-title"><div><small>EXECUTION / MATERIAL + MACHINE + QUALITY</small>
      <h1>Production order execution state machine</h1>
      <p>Order {order.id} · Revision {order.revision} · {order.produced}/{order.target} units</p>
    </div></header>
    <section className="suite-card" aria-label="Execution evidence">
      <h2>Material and machine gates</h2>
      <p><Link to={'/execution/reservations?order=' + encodeURIComponent(order.id)}>Review material reservations</Link> · Separate local pilot; reservations do not automatically release this execution gate.</p>
      <p>Lot {selectedOrder?.lotIndexId ?? 'unavailable'}: {order.materialReleased ? 'Released' : 'Material hold'}</p>
      <p>Machine M-17: {order.machineAvailable ? 'Available' : 'Downtime incident'}</p>
      <button disabled={order.materialReleased || order.phase === 'complete'} onClick={guard(() => { act({ type: 'release-material' }); })}>Release material lot</button>
      <button disabled={order.machineAvailable || order.phase === 'complete'} onClick={guard(() => { act({ type: 'restore-machine' }); })}>Restore machine</button>
    </section>
    <section className="suite-card" aria-label="Order execution">
      <h2>Production</h2><p>Phase: {order.phase}</p>
      <button disabled={Boolean(executionFinding(order, { type: 'start' }))} onClick={guard(() => { act({ type: 'start' }); })}>Start order</button>
      <label className="suite-field"><span className="suite-field-label">Completed units</span>
        <input type="number" min="1" max={order.target - order.produced} value={quantity}
          onChange={event => { setQuantity(Number(event.target.value)); }} />
      </label>
      <button disabled={order.phase !== 'running'} onClick={guard(() => { act({ type: 'produce', quantity }); })}>Record output</button>
      <p>Target: {order.target} · Recorded: {order.produced}</p>
    </section>
    <section className="suite-card" aria-label="Quality release">
      <h2>Independent quality decision</h2>
      <p>{order.qualityApproved ? 'Quality approval recorded' : 'Quality approval pending'}</p>
      <button disabled={order.phase !== 'quality-hold' || order.qualityApproved}
        onClick={guard(() => { act({ type: 'approve-quality' }); })}>Approve quality</button>
      <button disabled={Boolean(executionFinding(order, { type: 'complete' }))}
        onClick={guard(() => { act({ type: 'complete' }); })}>Complete order</button>
      {order.phase === 'complete' && <button onClick={guard(reopen)}>Reopen completed order</button>}
      <p>Recall scope: {aggregate.recallOpened ? 'open' : 'not opened'}</p>
      <p role="status">{notice || 'Complete each gate in sequence.'}</p>
      <details><summary>Execution history</summary>
        <ol>{order.history.map((event, index) => <li key={index}>Revision {index + 2}: {event}</li>)}</ol>
      </details>
    </section>
  </div>
}

export function ProductionOrderExecutionPage() { return <SelectedRecordRoute><RecordContent /></SelectedRecordRoute> }
