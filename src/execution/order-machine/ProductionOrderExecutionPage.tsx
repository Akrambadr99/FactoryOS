import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  advanceExecution, executionFinding, initialExecution,
} from './execution'
import type { ExecutionAction } from './execution'

export function ProductionOrderExecutionPage() {
  const { orderId } = useParams()
  const [order, setOrder] = useState(initialExecution)
  const [quantity, setQuantity] = useState(120)
  const [notice, setNotice] = useState('')
  function act(action: ExecutionAction) {
    const finding = executionFinding(order, action)
    if (finding) { setNotice(finding); return }
    setOrder(current => advanceExecution(current, action))
    setNotice(`${action.type} recorded at revision ${String(order.revision + 1)}.`)
  }
  if (orderId && orderId !== order.id) return <main className="suite-page"><p role="alert">Order {orderId} was not found.</p></main>
  return <div className="suite-page">
    <header className="suite-title"><div><small>EXECUTION / MATERIAL + MACHINE + QUALITY</small>
      <h1>Production order execution state machine</h1>
      <p>Order {order.id} · Revision {order.revision} · {order.produced}/{order.target} units</p>
    </div></header>
    <section className="suite-card" aria-label="Execution evidence">
      <h2>Material and machine gates</h2>
      <p>Lot LOT-55: {order.materialReleased ? 'Released' : 'Material hold'}</p>
      <p>Machine M-17: {order.machineAvailable ? 'Available' : 'Downtime incident'}</p>
      <button disabled={order.materialReleased || order.phase === 'complete'} onClick={() => { act({ type: 'release-material' }); }}>Release material lot</button>
      <button disabled={order.machineAvailable || order.phase === 'complete'} onClick={() => { act({ type: 'restore-machine' }); }}>Restore machine</button>
    </section>
    <section className="suite-card" aria-label="Order execution">
      <h2>Production</h2><p>Phase: {order.phase}</p>
      <button disabled={Boolean(executionFinding(order, { type: 'start' }))} onClick={() => { act({ type: 'start' }); }}>Start order</button>
      <label className="suite-field"><span className="suite-field-label">Completed units</span>
        <input type="number" min="1" max={order.target - order.produced} value={quantity}
          onChange={event => { setQuantity(Number(event.target.value)); }} />
      </label>
      <button disabled={order.phase !== 'running'} onClick={() => { act({ type: 'produce', quantity }); }}>Record output</button>
      <p>Target: {order.target} · Recorded: {order.produced}</p>
    </section>
    <section className="suite-card" aria-label="Quality release">
      <h2>Independent quality decision</h2>
      <p>{order.qualityApproved ? 'Quality approval recorded' : 'Quality approval pending'}</p>
      <button disabled={order.phase !== 'quality-hold' || order.qualityApproved}
        onClick={() => { act({ type: 'approve-quality' }); }}>Approve quality</button>
      <button disabled={Boolean(executionFinding(order, { type: 'complete' }))}
        onClick={() => { act({ type: 'complete' }); }}>Complete order</button>
      <p role="status">{notice || 'Complete each gate in sequence.'}</p>
      <details><summary>Execution history</summary>
        <ol>{order.history.map((event, index) => <li key={index}>Revision {index + 2}: {event}</li>)}</ol>
      </details>
    </section>
  </div>
}
