import { orderCollectionRule } from '../order-machine/collectionValidation'
import type { OrderPhase } from '../order-machine/execution'

export interface ReservationOrder {
  id: string
  line: 'assembly' | 'packaging'
  phase: OrderPhase
  archived: boolean
  sourceRevision: number
  target: number
}
export interface MaterialLot {
  id: string
  label: string
  line: ReservationOrder['line']
  unit: 'units'
  onHand: number
  demo: true
}
export interface MaterialReservation {
  id: string
  orderId: string
  lotId: string
  quantity: number
  note: string
  status: 'active' | 'released'
  sourceRevision: number
  createdRevision: number
  releasedRevision: number | null
  releaseReason: string | null
}
export interface ReservationEvent {
  sequence: number
  requestId: string
  kind: ReservationCommand['kind']
  orderId: string | null
  reservationId: string | null
  summary: string
}
export interface ReservationSnapshot {
  version: 1
  revision: number
  orders: readonly ReservationOrder[]
  lots: readonly MaterialLot[]
  reservations: readonly MaterialReservation[]
  events: readonly ReservationEvent[]
}
export interface ReservationReceipt { requestId: string; fingerprint: string; revision: number }
export interface ReservationState extends ReservationSnapshot { receipts: readonly ReservationReceipt[] }
interface CommandBase { requestId: string; expectedRevision: number }
export type ReservationCommand = CommandBase & (
  | { kind: 'sync-orders'; collection: unknown }
  | { kind: 'reserve'; orderId: string; lotId: string; quantity: number; note: string }
  | { kind: 'release'; reservationId: string; reason: string }
)
type NormalizedCommand = Exclude<ReservationCommand, { kind: 'sync-orders' }> | (
  CommandBase & { kind: 'sync-orders'; orders: readonly ReservationOrder[] }
)
export type ReservationErrorCode = 'invalid_command' | 'invalid_state' | 'revision_conflict'
  | 'idempotency_conflict' | 'capacity_exceeded' | 'order_conflict' | 'not_found'
  | 'insufficient_stock' | 'reservation_conflict'
export class ReservationError extends Error {
  readonly code: ReservationErrorCode
  constructor(code: ReservationErrorCode, message: string) {
    super(message)
    this.name = 'ReservationError'
    this.code = code
  }
}

const MAX_ORDERS = 1000
const MAX_RESERVATIONS = 1000
const MAX_COMMANDS = 5000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const phases = ['material-hold', 'ready', 'running', 'quality-hold', 'complete'] as const
function fail(code: ReservationErrorCode, message: string): never { throw new ReservationError(code, message) }
function invalid(): never { return fail('invalid_command', 'The reservation request contains invalid or unsupported data.') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) invalid()
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid()
  return value
}
function containsControls(value: string, allowFormatting: boolean): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if ((code < 32 || code === 127) && !(allowFormatting && [9, 10, 13].includes(code))) return true
  }
  return false
}
function text(value: unknown, min = 1, max = 120, allowFormatting = false): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max
    || containsControls(value, allowFormatting)) invalid()
  return value.trim()
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid()
  return value.toLowerCase()
}
function flag(value: unknown): boolean { if (typeof value !== 'boolean') invalid(); return value }
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid()
  return value as T
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid()
  return value as unknown[]
}
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) invalid() }
function parseOrder(value: unknown): ReservationOrder {
  const item = record(value)
  keys(item, ['id', 'line', 'phase', 'archived', 'sourceRevision', 'target'])
  return { id: text(item['id']), line: choice(item['line'], ['assembly', 'packaging']),
    phase: choice(item['phase'], phases), archived: flag(item['archived']),
    sourceRevision: integer(item['sourceRevision']), target: integer(item['target']) }
}
function parseOrders(value: unknown): ReservationOrder[] {
  const orders = list(value, MAX_ORDERS).map(parseOrder)
  unique(orders.map(order => order.id))
  return orders.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}
function importedOrders(value: unknown): ReservationOrder[] {
  try {
    const collection = orderCollectionRule(value)
    if (collection.orders.length > MAX_ORDERS || collection.lotIndexes.length > MAX_ORDERS || collection.events.length > 10000) invalid()
    const lotIds = new Set(collection.lotIndexes.map(lot => lot.id))
    const orders = collection.orders.map(item => {
      if (item.id !== item.aggregate.order.id || !lotIds.has(item.lotIndexId) || item.aggregate.order.produced > item.aggregate.order.target) invalid()
      return { id: item.id, line: item.line, phase: item.aggregate.order.phase, archived: item.archived,
        sourceRevision: item.aggregate.order.revision, target: item.aggregate.order.target }
    })
    return parseOrders(orders)
  } catch { return fail('invalid_command', 'The full production-order collection is invalid. Repair its source data before importing.') }
}
function normalizeCommand(value: unknown, fromReceipt = false): NormalizedCommand {
  const item = record(value)
  const base = { requestId: uuid(item['requestId']), expectedRevision: integer(item['expectedRevision']) }
  switch (item['kind']) {
    case 'sync-orders':
      keys(item, ['kind', 'requestId', 'expectedRevision', fromReceipt ? 'orders' : 'collection'])
      return { kind: 'sync-orders', ...base, orders: fromReceipt ? parseOrders(item['orders']) : importedOrders(item['collection']) }
    case 'reserve':
      keys(item, ['kind', 'requestId', 'expectedRevision', 'orderId', 'lotId', 'quantity', 'note'])
      return { kind: 'reserve', ...base, orderId: text(item['orderId']), lotId: text(item['lotId']),
        quantity: integer(item['quantity'], 1), note: text(item['note'], 8, 240, true) }
    case 'release':
      keys(item, ['kind', 'requestId', 'expectedRevision', 'reservationId', 'reason'])
      return { kind: 'release', ...base, reservationId: uuid(item['reservationId']), reason: text(item['reason'], 8, 240, true) }
    default: return invalid()
  }
}
export function createReservationState(): ReservationState {
  return { version: 1, revision: 0, orders: [], lots: [
    { id: 'MAT-ALLOY', label: 'Demo alloy blanks', line: 'assembly', unit: 'units', onHand: 240, demo: true },
    { id: 'MAT-FASTENER', label: 'Demo fastener sets', line: 'assembly', unit: 'units', onHand: 480, demo: true },
    { id: 'MAT-PACK', label: 'Demo packaging kits', line: 'packaging', unit: 'units', onHand: 240, demo: true },
  ], reservations: [], events: [], receipts: [] }
}
/** Copies public data so UI consumers cannot mutate the durable state or its receipts. */
export function reservationSnapshot(state: ReservationState): ReservationSnapshot {
  return { version: 1, revision: state.revision, orders: state.orders.map(item => ({ ...item })),
    lots: state.lots.map(item => ({ ...item })), reservations: state.reservations.map(item => ({ ...item })),
    events: state.events.map(item => ({ ...item })) }
}
function eligible(order: ReservationOrder): boolean {
  return !order.archived && (order.phase === 'material-hold' || order.phase === 'ready')
}
function execute(state: ReservationState, command: NormalizedCommand): ReservationState {
  if (state.revision !== command.expectedRevision) fail('revision_conflict', 'The reservation workspace changed. Refresh it before trying this change again.')
  if (state.receipts.length >= MAX_COMMANDS) fail('capacity_exceeded', 'The reservation ledger reached its command limit. Existing history has been preserved.')
  // A new command must not consume the durable history space needed to release existing holds.
  const activeHolds = state.reservations.filter(item => item.status === 'active').length
  if (command.kind !== 'release' && state.receipts.length + 1 + activeHolds + (command.kind === 'reserve' ? 1 : 0) > MAX_COMMANDS) {
    fail('capacity_exceeded', 'The remaining ledger space is reserved for releasing active holds. Existing history has been preserved.')
  }
  const revision = state.revision + 1
  let orders = state.orders
  let reservations = state.reservations
  let orderId: string | null = null
  let reservationId: string | null = null
  let summary: string
  switch (command.kind) {
    case 'sync-orders': {
      const next = new Map(command.orders.map(order => [order.id, order]))
      for (const hold of state.reservations.filter(item => item.status === 'active')) {
        const previous = state.orders.find(order => order.id === hold.orderId)
        const replacement = next.get(hold.orderId)
        if (!replacement || !previous || JSON.stringify(previous) !== JSON.stringify(replacement)) {
          fail('order_conflict', 'An order with active material holds changed or disappeared. Release its holds before importing changed orders.')
        }
      }
      orders = command.orders
      summary = 'Production-order references imported.'
      break
    }
    case 'reserve': {
      const order = state.orders.find(item => item.id === command.orderId)
      const lot = state.lots.find(item => item.id === command.lotId)
      if (!order || !lot) fail('not_found', 'The selected order or material lot is not available. Refresh and select an existing record.')
      if (!eligible(order) || order.line !== lot.line) fail('order_conflict', 'This order cannot reserve the selected material. Check its phase, archive state, and production line.')
      if (state.reservations.some(item => item.status === 'active' && item.orderId === order.id && item.lotId === lot.id)) {
        fail('reservation_conflict', 'This order already has an active hold for this material. Release that hold before reserving again.')
      }
      const reserved = state.reservations.filter(item => item.status === 'active' && item.lotId === lot.id).reduce((sum, item) => sum + item.quantity, 0)
      if (command.quantity > lot.onHand - reserved) fail('insufficient_stock', 'There is not enough unreserved demo stock for this quantity. Refresh availability or reduce the quantity.')
      if (state.reservations.length >= MAX_RESERVATIONS) fail('capacity_exceeded', 'The reservation history reached its record limit. Existing holds and history have been preserved.')
      reservations = [...state.reservations, { id: command.requestId, orderId: order.id, lotId: lot.id,
        quantity: command.quantity, note: command.note, status: 'active', sourceRevision: order.sourceRevision,
        createdRevision: revision, releasedRevision: null, releaseReason: null }]
      orderId = order.id
      reservationId = command.requestId
      summary = 'Material hold reserved.'
      break
    }
    case 'release': {
      const hold = state.reservations.find(item => item.id === command.reservationId)
      if (!hold) fail('not_found', 'The material hold is not available. Refresh and select an existing hold.')
      if (hold.status !== 'active') fail('reservation_conflict', 'This material hold has already been released. No stock was changed.')
      reservations = state.reservations.map(item => item.id === hold.id
        ? { ...item, status: 'released', releasedRevision: revision, releaseReason: command.reason } : item)
      orderId = hold.orderId
      reservationId = hold.id
      summary = 'Material hold released.'
      break
    }
  }
  return { ...state, revision, orders, reservations,
    events: [...state.events, { sequence: revision, requestId: command.requestId, kind: command.kind, orderId, reservationId, summary }],
    receipts: [...state.receipts, { requestId: command.requestId, fingerprint: JSON.stringify(command), revision }] }
}

function parseSnapshot(value: unknown): ReservationSnapshot {
  const input = record(value)
  keys(input, ['version', 'revision', 'orders', 'lots', 'reservations', 'events'])
  if (input['version'] !== 1) invalid()
  const revision = integer(input['revision'])
  const orders = parseOrders(input['orders'])
  const lots = createReservationState().lots
  if (JSON.stringify(input['lots']) !== JSON.stringify(lots)) invalid()
  const reservations = list(input['reservations'], MAX_RESERVATIONS).map(value => {
    const item = record(value)
    keys(item, ['id', 'orderId', 'lotId', 'quantity', 'note', 'status', 'sourceRevision', 'createdRevision', 'releasedRevision', 'releaseReason'])
    return { id: uuid(item['id']), orderId: text(item['orderId']), lotId: text(item['lotId']), quantity: integer(item['quantity'], 1),
      note: text(item['note'], 8, 240, true), status: choice(item['status'], ['active', 'released']), sourceRevision: integer(item['sourceRevision']),
      createdRevision: integer(item['createdRevision'], 1), releasedRevision: item['releasedRevision'] === null ? null : integer(item['releasedRevision'], 1),
      releaseReason: item['releaseReason'] === null ? null : text(item['releaseReason'], 8, 240, true) }
  })
  const events = list(input['events'], MAX_COMMANDS).map(value => {
    const item = record(value)
    keys(item, ['sequence', 'requestId', 'kind', 'orderId', 'reservationId', 'summary'])
    return { sequence: integer(item['sequence'], 1), requestId: uuid(item['requestId']), kind: choice(item['kind'], ['sync-orders', 'reserve', 'release']),
      orderId: item['orderId'] === null ? null : text(item['orderId']), reservationId: item['reservationId'] === null ? null : uuid(item['reservationId']),
      summary: text(item['summary']) }
  })
  unique(reservations.map(item => item.id))
  unique(events.map(item => item.requestId))
  if (revision !== events.length || events.some((event, index) => event.sequence !== index + 1)) invalid()
  const activePairs: string[] = []
  for (const hold of reservations) {
    const lot = lots.find(item => item.id === hold.lotId)
    const creation = events[hold.createdRevision - 1]
    if (!lot || hold.quantity > lot.onHand || creation?.kind !== 'reserve' || creation.requestId !== hold.id || creation.reservationId !== hold.id || creation.orderId !== hold.orderId) invalid()
    if (hold.status === 'active') {
      const order = orders.find(item => item.id === hold.orderId)
      if (hold.releasedRevision !== null || hold.releaseReason !== null || !order || !eligible(order) || order.line !== lot.line || order.sourceRevision !== hold.sourceRevision) invalid()
      activePairs.push(JSON.stringify([hold.orderId, hold.lotId]))
    } else {
      if (hold.releasedRevision === null || hold.releaseReason === null || hold.releasedRevision <= hold.createdRevision) invalid()
      const release = events[hold.releasedRevision - 1]
      if (release?.kind !== 'release' || release.reservationId !== hold.id || release.orderId !== hold.orderId) invalid()
    }
  }
  unique(activePairs)
  for (const lot of lots) {
    if (reservations.filter(item => item.status === 'active' && item.lotId === lot.id).reduce((sum, item) => sum + item.quantity, 0) > lot.onHand) invalid()
  }
  for (const event of events) {
    if (event.kind === 'sync-orders') {
      if (event.orderId !== null || event.reservationId !== null || event.summary !== 'Production-order references imported.') invalid()
    } else {
      const hold = reservations.find(item => item.id === event.reservationId)
      if (event.orderId !== hold?.orderId || (event.kind === 'reserve' ? hold.createdRevision : hold.releasedRevision) !== event.sequence
        || event.summary !== (event.kind === 'reserve' ? 'Material hold reserved.' : 'Material hold released.')) invalid()
    }
  }
  return { version: 1, revision, orders, lots: lots.map(item => ({ ...item })), reservations, events }
}
/** Public responses are validated independently of the private idempotency ledger. */
export function validateReservationSnapshot(value: unknown): ReservationSnapshot {
  try { return parseSnapshot(value) }
  catch { return fail('invalid_state', 'The reservation workspace could not be verified. Its data has not been reset.') }
}
/** Replay checks both cross-record invariants and every durable receipt against the saved state. */
export function validateReservationState(value: unknown): ReservationState {
  try {
    const input = record(value)
    keys(input, ['version', 'revision', 'orders', 'lots', 'reservations', 'events', 'receipts'])
    const snapshot = parseSnapshot({ version: input['version'], revision: input['revision'], orders: input['orders'],
      lots: input['lots'], reservations: input['reservations'], events: input['events'] })
    const receipts = list(input['receipts'], MAX_COMMANDS)
    if (receipts.length !== snapshot.revision) invalid()
    let rebuilt = createReservationState()
    for (const [index, value] of receipts.entries()) {
      const receipt = record(value)
      keys(receipt, ['requestId', 'fingerprint', 'revision'])
      const requestId = uuid(receipt['requestId'])
      const receiptRevision = integer(receipt['revision'], 1)
      if (typeof receipt['fingerprint'] !== 'string' || receipt['fingerprint'].length > 500000) invalid()
      const decoded: unknown = JSON.parse(receipt['fingerprint'])
      const command = normalizeCommand(decoded, true)
      if (receiptRevision !== index + 1 || command.requestId !== requestId || JSON.stringify(command) !== receipt['fingerprint']
        || rebuilt.receipts.some(item => item.requestId === requestId)) invalid()
      rebuilt = execute(rebuilt, command)
    }
    if (JSON.stringify(reservationSnapshot(rebuilt)) !== JSON.stringify(snapshot)) invalid()
    return rebuilt
  } catch { return fail('invalid_state', 'The reservation ledger could not be verified. Its data has not been reset.') }
}
export function applyReservationCommand(state: ReservationState, value: unknown): {
  state: ReservationState; snapshot: ReservationSnapshot; replayed: boolean
} {
  const current = validateReservationState(state)
  const command = normalizeCommand(value)
  const previous = current.receipts.find(receipt => receipt.requestId === command.requestId)
  if (previous) {
    if (previous.fingerprint !== JSON.stringify(command)) fail('idempotency_conflict', 'This request identifier already belongs to a different change. Refresh before creating a new request.')
    return { state: current, snapshot: reservationSnapshot(current), replayed: true }
  }
  const next = execute(current, command)
  return { state: next, snapshot: reservationSnapshot(next), replayed: false }
}
