import { describe, expect, it } from 'vitest'
import { createOrder, seedOrderCollection } from '../order-machine/orderCollection'
import { applyReservationCommand, applyReservationReleaseBatch, createReservationState, normalizeReservationReleaseBatch,
  ReservationError, reservationSnapshot, validateReservationState, type ReservationReleaseBatch } from './reservations'

const id = (value: number) => `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`
function held(count = 2) {
  let collection = seedOrderCollection()
  const orders = ['PO-8842']
  for (let index = 1; index < count; index++) {
    const orderId = 'PO-' + String(9900 + index)
    collection = createOrder(collection, orderId, 'assembly', 'LOT-55'); orders.push(orderId)
  }
  let state = applyReservationCommand(createReservationState(), { kind: 'sync-orders', requestId: id(1), expectedRevision: 0, collection }).state
  for (const [index, orderId] of orders.entries()) state = applyReservationCommand(state, { kind: 'reserve', requestId: id(100 + index),
    expectedRevision: state.revision, orderId, lotId: 'MAT-ALLOY', quantity: 1, note: 'Production planning hold' }).state
  const batch: ReservationReleaseBatch = { expectedRevision: state.revision, reason: 'Changed production schedule',
    releases: state.reservations.map((hold, index) => ({ requestId: id(1000 + index), reservationId: hold.id })) }
  return { state, batch, collection }
}
function command(batch: ReservationReleaseBatch, index: number) {
  const item = batch.releases[index]
  if (!item) throw new Error('Missing batch fixture release.')
  return { kind: 'release' as const, requestId: item.requestId, expectedRevision: batch.expectedRevision + index,
    reservationId: item.reservationId, reason: batch.reason }
}
function expectCode(action: () => unknown, code: string) {
  try { action(); expect.unreachable('Expected a release-batch error.') }
  catch (error) { expect(error).toBeInstanceOf(ReservationError); expect(error).toMatchObject({ code }) }
}

describe('atomic selected-hold release domain', () => {
  it('returns a complete release state without modifying its input or changing legacy event/receipt formats', () => {
    const { state, batch } = held(), before = structuredClone(state), captured = structuredClone(batch)
    const result = applyReservationReleaseBatch(state, batch)
    expect(result.replayed).toBe(false)
    expect(result.snapshot.revision).toBe(state.revision + 2)
    expect(result.snapshot.reservations.every(hold => hold.status === 'released')).toBe(true)
    expect(result.state.receipts.slice(-2).map(receipt => receipt.fingerprint)).toEqual([JSON.stringify(command(batch, 0)), JSON.stringify(command(batch, 1))])
    expect(result.state.events.slice(-2).map(event => event.kind)).toEqual(['release', 'release'])
    expect(validateReservationState(result.state)).toEqual(result.state)
    expect(state).toEqual(before); expect(batch).toEqual(captured)
  })

  it('accepts a one-item batch and the full bound of 25 releases', () => {
    for (const count of [1, 25]) {
      const { state, batch } = held(count)
      const result = applyReservationReleaseBatch(state, batch)
      expect(result.state.revision).toBe(state.revision + count)
      expect(result.state.reservations.filter(hold => hold.status === 'released')).toHaveLength(count)
      expect(validateReservationState(result.state)).toEqual(result.state)
    }
  })

  it('normalizes UUID case and reason boundaries while preserving internal formatting and item order', () => {
    const { state, batch } = held()
    const input = { ...batch, reason: '  Changed schedule\n\tRetain this formatting\r\nReviewed by planning  ',
      releases: batch.releases.toReversed().map(item => ({ requestId: item.requestId.toUpperCase(), reservationId: item.reservationId.toUpperCase() })) }
    const before = structuredClone(input), normalized = normalizeReservationReleaseBatch(input)
    expect(normalized).toEqual({ expectedRevision: batch.expectedRevision, reason: input.reason.trim(), releases: batch.releases.toReversed() })
    expect(input).toEqual(before)
    const first = normalized.releases[0]
    if (!first) throw new Error('Missing normalized release.')
    first.requestId = id(9000)
    expect(input).toEqual(before)
    const result = applyReservationReleaseBatch(state, input)
    expect(result.snapshot.reservations.every(hold => hold.releaseReason === input.reason.trim())).toBe(true)
  })

  it.each(['empty', 'too-many', 'extra-root-key', 'extra-item-key', 'missing-reason', 'invalid-id', 'duplicate-request', 'duplicate-hold'])('rejects invalid batch shape: %s', issue => {
    const { batch } = held(), first = batch.releases[0], second = batch.releases[1]
    if (!first || !second) throw new Error('Missing duplicate fixtures.')
    const malformed = issue === 'empty' ? { ...batch, releases: [] }
      : issue === 'too-many' ? { ...batch, releases: Array.from({ length: 26 }, (_, index) => ({ requestId: id(2000 + index), reservationId: id(3000 + index) })) }
        : issue === 'extra-root-key' ? { ...batch, kind: 'release-batch' }
          : issue === 'extra-item-key' ? { ...batch, releases: [{ ...first, quantity: 1 }] }
            : issue === 'missing-reason' ? { expectedRevision: batch.expectedRevision, releases: batch.releases }
              : issue === 'invalid-id' ? { ...batch, releases: [{ ...first, reservationId: 'not-a-uuid' }] }
                : issue === 'duplicate-request' ? { ...batch, releases: [first, { ...second, requestId: first.requestId.toUpperCase() }] }
                  : { ...batch, releases: [first, { ...second, reservationId: first.reservationId.toUpperCase() }] }
    expectCode(() => normalizeReservationReleaseBatch(malformed), 'invalid_command')
  })

  it.each(['', 'short', 'x'.repeat(241), 'Contains\u0000invalid control'])('rejects invalid common release reason %j', reason => {
    const { state, batch } = held(), before = structuredClone(state)
    expectCode(() => applyReservationReleaseBatch(state, { ...batch, reason }), 'invalid_command')
    expect(state).toEqual(before)
  })

  it('rejects sparse release arrays instead of skipping missing items', () => {
    const { batch } = held()
    expectCode(() => normalizeReservationReleaseBatch({ ...batch, releases: new Array<unknown>(1) }), 'invalid_command')
  })

  it.each([-1, 1.5, NaN, Infinity, '3', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1])('rejects unsafe base or derived revision %j', expectedRevision => {
    const { batch } = held()
    expectCode(() => normalizeReservationReleaseBatch({ ...batch, expectedRevision }), 'invalid_command')
  })

  it('validates the entire input before executing and leaves all holds active if a later hold is absent', () => {
    const { state, batch } = held(), before = structuredClone(state), first = batch.releases[0]
    if (!first) throw new Error('Missing fixture release.')
    expectCode(() => applyReservationReleaseBatch(state, { ...batch, releases: [first, { requestId: id(7000), reservationId: id(8000) }] }), 'not_found')
    expect(state).toEqual(before)
    expect(state.reservations.every(hold => hold.status === 'active')).toBe(true)
    expectCode(() => applyReservationReleaseBatch(state, { ...batch, releases: [first, { requestId: 'invalid', reservationId: id(8000) }] }), 'invalid_command')
    expect(state).toEqual(before)
  })

  it('rejects a stale new batch and preserves every existing hold', () => {
    const { state, batch } = held(), before = structuredClone(state)
    expectCode(() => applyReservationReleaseBatch(state, { ...batch, expectedRevision: state.revision - 1 }), 'revision_conflict')
    expect(state).toEqual(before)
  })

  it('does not partially release an earlier item when a later hold was already released by another request', () => {
    const { state, batch } = held()
    const changed = applyReservationCommand(state, { ...command(batch, 1), requestId: id(8000), expectedRevision: state.revision }).state
    const before = structuredClone(changed)
    expectCode(() => applyReservationReleaseBatch(changed, { ...batch, expectedRevision: changed.revision }), 'reservation_conflict')
    expect(changed).toEqual(before)
    expect(changed.reservations[0]?.status).toBe('active')
  })

  it('replays every matching receipt before checking a newer current revision', () => {
    const { state, batch, collection } = held()
    const saved = applyReservationReleaseBatch(state, batch)
    const newer = applyReservationCommand(saved.state, { kind: 'sync-orders', requestId: id(8000), expectedRevision: saved.state.revision, collection }).state
    const before = structuredClone(newer), replay = applyReservationReleaseBatch(newer, batch)
    expect(replay).toEqual({ state: newer, snapshot: reservationSnapshot(newer), replayed: true })
    expect(newer).toEqual(before)
    const canonicalRetry = { ...batch, reason: '  ' + batch.reason + '  ', releases: batch.releases.map(item => ({
      requestId: item.requestId.toUpperCase(), reservationId: item.reservationId.toUpperCase(),
    })) }
    expect(applyReservationReleaseBatch(newer, canonicalRetry).replayed).toBe(true)
  })

  it('rejects partial matching receipts rather than completing the missing releases', () => {
    const { state, batch } = held()
    const partial = applyReservationCommand(state, command(batch, 0)).state, before = structuredClone(partial)
    expectCode(() => applyReservationReleaseBatch(partial, batch), 'idempotency_conflict')
    expect(() => applyReservationReleaseBatch(partial, batch)).toThrow('Only part of this release batch')
    expect(partial).toEqual(before)
    expect(partial.reservations.filter(hold => hold.status === 'active')).toHaveLength(1)
  })

  it.each(['reason', 'order', 'base', 'hold'])('rejects an existing receipt with changed %s intent', issue => {
    const { state, batch } = held(), saved = applyReservationReleaseBatch(state, batch).state
    const changed = issue === 'reason' ? { ...batch, reason: 'A different cancellation reason' }
      : issue === 'order' ? { ...batch, releases: batch.releases.toReversed() }
        : issue === 'base' ? { ...batch, expectedRevision: batch.expectedRevision + 1 }
          : { ...batch, releases: batch.releases.map((item, index) => ({ ...item, reservationId: id(9000 + index) })) }
    expectCode(() => applyReservationReleaseBatch(saved, changed), 'idempotency_conflict')
  })

  it('accepts identical consecutive individual receipts as a safe replay without inventing batch provenance', () => {
    const { state, batch } = held()
    const first = applyReservationCommand(state, command(batch, 0)).state
    const second = applyReservationCommand(first, command(batch, 1)).state
    expect(applyReservationReleaseBatch(second, batch)).toEqual({ state: second, snapshot: reservationSnapshot(second), replayed: true })
  })

  it('fails closed for a corrupt source ledger', () => {
    const { state, batch } = held()
    expectCode(() => applyReservationReleaseBatch({ ...state, revision: 999 }, batch), 'invalid_state')
  })
})
