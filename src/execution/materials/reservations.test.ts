import { describe, expect, it } from 'vitest'
import { createOrder, seedOrderCollection } from '../order-machine/orderCollection'
import {
  applyReservationCommand, createReservationState, ReservationError, reservationSnapshot,
  validateReservationSnapshot, validateReservationState,
} from './reservations'
import type { ReservationCommand, ReservationState } from './reservations'

const requestId = (number: number) => `00000000-0000-4000-8000-${number.toString(16).padStart(12, '0')}`
const source = () => seedOrderCollection()
const imported = () => applyReservationCommand(createReservationState(), {
  kind: 'sync-orders', requestId: requestId(1), expectedRevision: 0, collection: source(),
}).state
const reserve = (overrides: Partial<Extract<ReservationCommand, { kind: 'reserve' }>> = {}): ReservationCommand => ({
  kind: 'reserve', requestId: requestId(2), expectedRevision: 1, orderId: 'PO-8842', lotId: 'MAT-ALLOY',
  quantity: 120, note: 'Reserve for scheduled production', ...overrides,
})
const release = (overrides: Partial<Extract<ReservationCommand, { kind: 'release' }>> = {}): ReservationCommand => ({
  kind: 'release', requestId: requestId(3), expectedRevision: 2, reservationId: requestId(2),
  reason: 'Production schedule was cancelled', ...overrides,
})
const held = () => applyReservationCommand(imported(), reserve()).state
function expectCode(action: () => unknown, code: string): void {
  try { action(); expect.unreachable('Expected a reservation domain error') }
  catch (error) { expect(error).toBeInstanceOf(ReservationError); expect(error).toMatchObject({ code }) }
}

describe('material reservation source and demo stock', () => {
  it('starts with no imported orders and clearly identified demo materials', () => {
    const state = createReservationState()
    expect(state).toMatchObject({ version: 1, revision: 0, orders: [], reservations: [], events: [], receipts: [] })
    expect(state.lots.map(lot => [lot.id, lot.onHand, lot.demo])).toEqual([
      ['MAT-ALLOY', 240, true], ['MAT-FASTENER', 480, true], ['MAT-PACK', 240, true],
    ])
    expect(validateReservationState(state)).toEqual(state)
    expectCode(() => applyReservationCommand(state, reserve({ expectedRevision: 0 })), 'not_found')
  })

  it('explicitly projects the full current collection without touching its source', () => {
    const collection = source()
    const before = structuredClone(collection)
    const result = applyReservationCommand(createReservationState(), {
      kind: 'sync-orders', requestId: requestId(1), expectedRevision: 0, collection,
    })
    expect(result.snapshot.orders).toHaveLength(6)
    expect(result.snapshot.orders[0]).toEqual({ id: 'PO-8842', line: 'assembly', phase: 'material-hold', archived: false, sourceRevision: 1, target: 120 })
    expect(result.snapshot.events[0]).toMatchObject({ sequence: 1, kind: 'sync-orders', orderId: null })
    expect(collection).toEqual(before)
    expect(result.state.receipts[0]?.fingerprint).not.toContain('causalHistory')
  })

  it('never treats an empty imported collection as an instruction to seed orders', () => {
    const result = applyReservationCommand(imported(), {
      kind: 'sync-orders', requestId: requestId(2), expectedRevision: 1,
      collection: { orders: [], lotIndexes: [], events: [] },
    })
    expect(result.snapshot.orders).toEqual([])
    expect(result.snapshot.revision).toBe(2)
  })

  it.each(['nested', 'identity', 'lot-reference', 'quantity', 'line', 'duplicate'])('rejects invalid full source collections: %s', issue => {
    const collection = structuredClone(source())
    const first = collection.orders[0]!
    const malformed: unknown = issue === 'nested' ? { ...collection, orders: [{ ...first, aggregate: { ...first.aggregate, recallJob: { status: 'unknown' } } }] }
      : issue === 'identity' ? { ...collection, orders: [{ ...first, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, id: 'PO-0000' } } }] }
      : issue === 'lot-reference' ? { ...collection, orders: [{ ...first, lotIndexId: 'missing' }] }
      : issue === 'quantity' ? { ...collection, orders: [{ ...first, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, produced: 121 } } }] }
      : issue === 'line' ? { ...collection, orders: [{ ...first, line: 'warehouse' }] }
      : { ...collection, orders: [first, first] }
    expectCode(() => applyReservationCommand(createReservationState(), {
      kind: 'sync-orders', requestId: requestId(1), expectedRevision: 0, collection: malformed,
    }), 'invalid_command')
  })

  it('does not interpret genealogy availability as physical material stock', () => {
    const collection = source()
    const state = applyReservationCommand(createReservationState(), {
      kind: 'sync-orders', requestId: requestId(1), expectedRevision: 0,
      collection: { ...collection, lotIndexes: collection.lotIndexes.map(lot => ({ ...lot, available: false })) },
    }).state
    expect(applyReservationCommand(state, reserve()).snapshot.reservations[0]?.quantity).toBe(120)
  })
})

describe('material hold commands', () => {
  it('creates one immutable, attributable hold and releases it with retained history', () => {
    const initial = imported()
    const before = structuredClone(initial)
    const reserved = applyReservationCommand(initial, reserve())
    expect(initial).toEqual(before)
    expect(reserved.snapshot.reservations[0]).toEqual({ id: requestId(2), orderId: 'PO-8842', lotId: 'MAT-ALLOY',
      quantity: 120, note: 'Reserve for scheduled production', status: 'active', sourceRevision: 1,
      createdRevision: 2, releasedRevision: null, releaseReason: null })
    const released = applyReservationCommand(reserved.state, release())
    expect(released.snapshot.reservations[0]).toMatchObject({ status: 'released', releasedRevision: 3, releaseReason: 'Production schedule was cancelled' })
    expect(released.snapshot.events.map(event => event.kind)).toEqual(['sync-orders', 'reserve', 'release'])
    expect(released.snapshot.lots).toEqual(initial.lots)
    expect(validateReservationState(released.state)).toEqual(released.state)
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid quantity %s without advancing history', quantity => {
    const initial = imported()
    expectCode(() => applyReservationCommand(initial, reserve({ quantity })), 'invalid_command')
    expect(initial.revision).toBe(1)
    expect(initial.events).toHaveLength(1)
    expect(initial.reservations).toHaveLength(0)
  })

  it.each(['', 'short', 'a'.repeat(241), 'valid text\u0000with control'])('rejects invalid hold intent', note => {
    expectCode(() => applyReservationCommand(imported(), reserve({ note })), 'invalid_command')
    expectCode(() => applyReservationCommand(held(), release({ reason: note })), 'invalid_command')
  })

  it('preserves multiline intent, carriage returns, and tabs through persistence and retry', () => {
    const note = '  Production shift one\nAssembly line\r\n\tPlanner reviewed  '
    const reason = '  Schedule changed\nRelease the full hold\tfor replanning  '
    const reserved = applyReservationCommand(imported(), reserve({ note })).state
    const released = applyReservationCommand(reserved, release({ reason })).state
    const encoded: unknown = JSON.parse(JSON.stringify(released))
    const persisted = validateReservationState(encoded)
    expect(persisted.reservations[0]).toMatchObject({ note: note.trim(), releaseReason: reason.trim() })
    expect(applyReservationCommand(persisted, reserve({ note: note.trim() })).replayed).toBe(true)
    expect(applyReservationCommand(persisted, release({ reason: reason.trim() })).replayed).toBe(true)
    expectCode(() => applyReservationCommand(imported(), reserve({ orderId: 'PO-8842\n' })), 'invalid_command')
  })

  it('supports exactly available stock but rejects duplicate active order/material pairs', () => {
    const result = applyReservationCommand(imported(), reserve({ quantity: 240 }))
    expect(result.snapshot.reservations[0]?.quantity).toBe(240)
    expectCode(() => applyReservationCommand(result.state, reserve({ requestId: requestId(3), expectedRevision: 2 })), 'reservation_conflict')
    const released = applyReservationCommand(result.state, release()).state
    expect(applyReservationCommand(released, reserve({ requestId: requestId(4), expectedRevision: 3, quantity: 240 })).snapshot.reservations).toHaveLength(2)
  })

  it('shares availability across orders and rejects overbooking without a partial write', () => {
    const collection = createOrder(source(), 'PO-9000', 'assembly', 'LOT-55')
    const importedState = applyReservationCommand(createReservationState(), { kind: 'sync-orders', requestId: requestId(1), expectedRevision: 0, collection }).state
    const first = applyReservationCommand(importedState, reserve({ quantity: 200 })).state
    const before = structuredClone(first)
    expectCode(() => applyReservationCommand(first, reserve({ requestId: requestId(3), expectedRevision: 2, orderId: 'PO-9000', quantity: 41 })), 'insufficient_stock')
    expect(first).toEqual(before)
    const second = applyReservationCommand(first, reserve({ requestId: requestId(3), expectedRevision: 2, orderId: 'PO-9000', quantity: 40 }))
    expect(second.snapshot.reservations.reduce((sum, item) => sum + item.quantity, 0)).toBe(240)
  })

  it('rejects completed, archived, incompatible, and unknown records', () => {
    expectCode(() => applyReservationCommand(imported(), reserve({ orderId: 'PO-8843' })), 'order_conflict')
    expectCode(() => applyReservationCommand(imported(), reserve({ orderId: 'PO-8847' })), 'order_conflict')
    expectCode(() => applyReservationCommand(imported(), reserve({ lotId: 'MAT-PACK' })), 'order_conflict')
    expectCode(() => applyReservationCommand(imported(), reserve({ orderId: 'PO-9999' })), 'not_found')
    expectCode(() => applyReservationCommand(imported(), reserve({ lotId: 'missing' })), 'not_found')
  })

  it('rejects a second release with a different request and preserves stock and history', () => {
    const state = applyReservationCommand(held(), release()).state
    expectCode(() => applyReservationCommand(state, release({ requestId: requestId(4), expectedRevision: 3 })), 'reservation_conflict')
    expectCode(() => applyReservationCommand(state, release({ requestId: requestId(4), expectedRevision: 3, reservationId: requestId(999) })), 'not_found')
    expect(state.revision).toBe(3)
  })

  it.each(['missing', 'archive', 'phase', 'revision', 'line', 'target'])('blocks incompatible order refresh while active: %s', mutation => {
    const state = held()
    const collection = source()
    const orders = collection.orders.flatMap(item => {
      if (item.id !== 'PO-8842') return [item]
      if (mutation === 'missing') return []
      return [{ ...item, archived: mutation === 'archive', line: mutation === 'line' ? 'packaging' : item.line,
        aggregate: { ...item.aggregate, order: { ...item.aggregate.order,
          phase: mutation === 'phase' ? 'running' as const : item.aggregate.order.phase,
          revision: mutation === 'revision' ? 2 : item.aggregate.order.revision,
          target: mutation === 'target' ? 240 : item.aggregate.order.target,
        } } }]
    })
    const command = { kind: 'sync-orders', requestId: requestId(4), expectedRevision: 2, collection: { ...collection, orders } }
    expectCode(() => applyReservationCommand(state, command), 'order_conflict')
    expect(state.revision).toBe(2)
    const released = applyReservationCommand(state, release()).state
    expect(applyReservationCommand(released, { ...command, expectedRevision: 3 }).snapshot.revision).toBe(4)
  })

  it('allows harmless source refresh while preserving holds', () => {
    const collection = source()
    const result = applyReservationCommand(held(), { kind: 'sync-orders', requestId: requestId(3), expectedRevision: 2,
      collection: { ...collection, events: [...collection.events, { sequence: 1, action: 'reviewed', targetId: 'PO-8842', relatedIds: [], actor: 'planner', sourceRevision: 1 }] } })
    expect(result.snapshot.reservations[0]?.status).toBe('active')
    expect(result.snapshot.revision).toBe(3)
  })
})

describe('revision and idempotency boundaries', () => {
  it('replays an identical request before checking its old revision and returns the current snapshot', () => {
    const initial = held()
    const released = applyReservationCommand(initial, release()).state
    const replay = applyReservationCommand(released, reserve())
    expect(replay.replayed).toBe(true)
    expect(replay.snapshot.revision).toBe(3)
    expect(replay.snapshot.reservations[0]?.status).toBe('released')
    expect(replay.state).toEqual(released)
  })

  it('canonicalizes trimmed intent and UUID case without changing command identity', () => {
    const command = reserve({ requestId: 'abcdefab-abcd-4abc-8abc-abcdefabcdef', note: '   Planned material hold   ' })
    const state = applyReservationCommand(imported(), command).state
    expect(applyReservationCommand(state, { ...command, requestId: command.requestId.toUpperCase(), note: 'Planned material hold' }).replayed).toBe(true)
  })

  it('canonicalizes source order order but retains projected semantic changes', () => {
    const collection = source()
    const state = imported()
    const command = { kind: 'sync-orders', requestId: requestId(1), expectedRevision: 0, collection: { ...collection, orders: [...collection.orders].reverse() } }
    expect(applyReservationCommand(state, command).replayed).toBe(true)
    expectCode(() => applyReservationCommand(state, { ...command, collection: { ...collection, orders: [] } }), 'idempotency_conflict')
  })

  it('rejects changed contents with the same key and stale new requests', () => {
    expectCode(() => applyReservationCommand(held(), reserve({ quantity: 80 })), 'idempotency_conflict')
    expectCode(() => applyReservationCommand(held(), reserve({ expectedRevision: 2 })), 'idempotency_conflict')
    expectCode(() => applyReservationCommand(held(), reserve({ requestId: requestId(3) })), 'revision_conflict')
  })

  it.each([null, {}, { kind: 'erase' }, { ...reserve(), requestId: 'not-a-uuid' }, { ...reserve(), expectedRevision: -1 }, { ...reserve(), extra: true }])('rejects malformed command envelopes', command => {
    expectCode(() => applyReservationCommand(imported(), command), 'invalid_command')
  })
})

describe('durable ledger and public snapshot validation', () => {
  it('roundtrips durable state but excludes receipts from the independent public snapshot', () => {
    const state = applyReservationCommand(held(), release()).state
    const encoded: unknown = JSON.parse(JSON.stringify(state))
    expect(validateReservationState(encoded)).toEqual(state)
    const snapshot = reservationSnapshot(state)
    expect(snapshot).not.toHaveProperty('receipts')
    expect(validateReservationSnapshot(snapshot)).toEqual(snapshot)
    snapshot.orders[0]!.target = 999
    snapshot.lots[0]!.onHand = 999
    snapshot.reservations[0]!.quantity = 999
    snapshot.events[0]!.summary = 'Changed outside ledger'
    expect(state.orders[0]?.target).toBe(120)
    expect(state.lots[0]?.onHand).toBe(240)
    expect(state.reservations[0]?.quantity).toBe(120)
    expect(state.events[0]?.summary).toBe('Production-order references imported.')
  })

  it.each(['receipt', 'fingerprint', 'receipt-revision', 'quantity', 'note', 'missing-event', 'stock', 'dangling', 'source-revision'])('rejects damaged persistent state without repair: %s', mutation => {
    const state = held()
    const malformed = mutation === 'receipt' ? { ...state, receipts: [] }
      : mutation === 'fingerprint' ? { ...state, receipts: state.receipts.map(item => ({ ...item, fingerprint: '{}' })) }
      : mutation === 'receipt-revision' ? { ...state, receipts: state.receipts.map(item => ({ ...item, revision: 3 })) }
      : mutation === 'quantity' ? { ...state, reservations: state.reservations.map(item => ({ ...item, quantity: 121 })) }
      : mutation === 'note' ? { ...state, reservations: state.reservations.map(item => ({ ...item, note: 'Tampered intent text' })) }
      : mutation === 'missing-event' ? { ...state, events: [] }
      : mutation === 'stock' ? { ...state, lots: state.lots.map(item => ({ ...item, onHand: 999 })) }
      : mutation === 'dangling' ? { ...state, orders: [] }
      : { ...state, reservations: state.reservations.map(item => ({ ...item, sourceRevision: 100 })) }
    const before = structuredClone(malformed)
    expectCode(() => validateReservationState(malformed), 'invalid_state')
    expect(malformed).toEqual(before)
  })

  it('rejects altered release evidence and mismatched event references', () => {
    const state = applyReservationCommand(held(), release()).state
    expectCode(() => validateReservationSnapshot({ ...reservationSnapshot(state), reservations: state.reservations.map(item => ({ ...item, releasedRevision: 1 })) }), 'invalid_state')
    expectCode(() => validateReservationSnapshot({ ...reservationSnapshot(state), events: state.events.map(item => ({ ...item, reservationId: requestId(99) })) }), 'invalid_state')
  })

  it('bounds imported records and refuses invalid state at the command boundary', () => {
    const collection = source()
    const first = collection.orders[0]!
    const orders = Array.from({ length: 1001 }, (_, index) => ({ ...first, id: `PO-${String(10000 + index)}`, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, id: `PO-${String(10000 + index)}` } } }))
    expectCode(() => applyReservationCommand(createReservationState(), { kind: 'sync-orders', requestId: requestId(1), expectedRevision: 0, collection: { ...collection, orders } }), 'invalid_command')
    const invalidState: ReservationState = { ...imported(), revision: 99 }
    expectCode(() => applyReservationCommand(invalidState, reserve()), 'invalid_state')
  })

  // Replays the full 5000-command bound repeatedly; verifies capacity correctness, not latency.
  it('reserves the last ledger slot for releasing a hold instead of trapping stock at capacity', () => {
    const initial = held()
    const extra = Array.from({ length: 4997 }, (_, index) => ({
      kind: 'sync-orders' as const, requestId: requestId(index + 100), expectedRevision: index + 2, orders: initial.orders,
    }))
    const full: ReservationState = { ...initial, revision: 4999,
      events: [...initial.events, ...extra.map(command => ({ sequence: command.expectedRevision + 1,
        requestId: command.requestId, kind: command.kind, orderId: null, reservationId: null, summary: 'Production-order references imported.' }))],
      receipts: [...initial.receipts, ...extra.map(command => ({ requestId: command.requestId,
        fingerprint: JSON.stringify(command), revision: command.expectedRevision + 1 }))],
    }
    expectCode(() => applyReservationCommand(full, { kind: 'sync-orders', requestId: requestId(9999), expectedRevision: 4999, collection: source() }), 'capacity_exceeded')
    const released = applyReservationCommand(full, release({ requestId: requestId(9999), expectedRevision: 4999 }))
    expect(released.snapshot.revision).toBe(5000)
    expect(released.snapshot.reservations[0]?.status).toBe('released')
    expect(applyReservationCommand(released.state, reserve()).replayed).toBe(true)
    expectCode(() => applyReservationCommand(released.state, { kind: 'sync-orders', requestId: requestId(10000), expectedRevision: 5000, collection: source() }), 'capacity_exceeded')
  }, 15000)
})
