import { reservationOrdersFromCollection, validateReservationSnapshot, type ReservationOrder } from './reservations'

export type OrderSyncField = Exclude<keyof ReservationOrder, 'id'>
export interface OrderSyncChange {
  id: string
  kind: 'added' | 'updated' | 'removed'
  before: ReservationOrder | null
  after: ReservationOrder | null
  fields: readonly OrderSyncField[]
  activeHoldIds: readonly string[]
}
export interface OrderSyncPreview {
  revision: number
  sourceCount: number
  unchanged: number
  added: number
  updated: number
  removed: number
  blocked: number
  changes: readonly OrderSyncChange[]
}
const fields: readonly OrderSyncField[] = ['line', 'phase', 'archived', 'sourceRevision', 'target']
function compareIds(left: string, right: string): number {
  const first = Array.from(left, character => character.codePointAt(0) ?? 0)
  const second = Array.from(right, character => character.codePointAt(0) ?? 0)
  for (let index = 0; index < Math.min(first.length, second.length); index++) {
    const difference = (first[index] ?? 0) - (second[index] ?? 0)
    if (difference) return difference
  }
  return first.length - second.length
}

/** Pure review of the complete replacement projection; never applies a command. */
export function createOrderSyncPreview(snapshot: unknown, collection: unknown): OrderSyncPreview {
  const current = validateReservationSnapshot(snapshot)
  const proposed = reservationOrdersFromCollection(collection)
  const before = new Map(current.orders.map(order => [order.id, order]))
  const after = new Map(proposed.map(order => [order.id, order]))
  const identities = [...new Set([...before.keys(), ...after.keys()])].sort(compareIds)
  const changes: OrderSyncChange[] = []
  let unchanged = 0
  for (const id of identities) {
    const previous = before.get(id) ?? null, next = after.get(id) ?? null
    const changed = previous && next ? fields.filter(field => previous[field] !== next[field]) : [...fields]
    if (!changed.length) { unchanged++; continue }
    changes.push({ id, kind: previous === null ? 'added' : next === null ? 'removed' : 'updated',
      before: previous, after: next, fields: changed,
      activeHoldIds: current.reservations.filter(hold => hold.orderId === id && hold.status === 'active').map(hold => hold.id).sort(compareIds) })
  }
  return { revision: current.revision, sourceCount: proposed.length, unchanged,
    added: changes.filter(change => change.kind === 'added').length,
    updated: changes.filter(change => change.kind === 'updated').length,
    removed: changes.filter(change => change.kind === 'removed').length,
    blocked: changes.filter(change => change.activeHoldIds.length > 0).length, changes }
}
