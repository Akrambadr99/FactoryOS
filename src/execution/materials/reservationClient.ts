import { normalizeReservationReleaseBatch, validateReservationSnapshot, type ReservationCommand, type ReservationReleaseBatch, type ReservationSnapshot } from './reservations'
import { createOrderSyncPreview, type OrderSyncPreview } from './orderSyncPreview'

export class ReservationClientError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'ReservationClientError'; this.code = code }
}
export interface ReservationClient {
  read(signal?: AbortSignal): Promise<ReservationSnapshot>
  previewOrders(collection: unknown, signal?: AbortSignal): Promise<{ snapshot: ReservationSnapshot; preview: OrderSyncPreview }>
  execute(command: ReservationCommand, signal?: AbortSignal): Promise<{ snapshot: ReservationSnapshot; replayed: boolean }>
  releaseBatch(batch: ReservationReleaseBatch, signal?: AbortSignal): Promise<{ snapshot: ReservationSnapshot; replayed: boolean }>
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function equalJson(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value: unknown, index) => equalJson(actual[index], value))
  if (!object(expected) || !object(actual)) return false
  const keys = Object.keys(expected)
  return Object.keys(actual).length === keys.length && keys.every(key => Object.hasOwn(actual, key) && equalJson(actual[key], expected[key]))
}
export function createReservationClient(fetcher: typeof fetch = globalThis.fetch): ReservationClient {
  async function request(body: unknown, signal?: AbortSignal, route = '/api/reservations'): Promise<unknown> {
    let response: Response
    try {
      response = await fetcher('http://127.0.0.1:4404' + route, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { 'X-FactoryOS-Client': 'reservations', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}),
      })
    } catch (error) {
      if (object(error) && error['name'] === 'AbortError') throw error
      throw new ReservationClientError('connection', 'The local reservation service could not be reached. Start it, then retry. Your draft and captured request have been kept.')
    }
    let value: unknown
    try {
      const raw = await response.text()
      if (raw.length > 16 * 1024 * 1024) throw new Error('Response limit')
      value = JSON.parse(raw) as unknown
    } catch (error) {
      if (object(error) && error['name'] === 'AbortError') throw error
      throw new ReservationClientError('invalid_response', 'The service response could not be verified. Refresh or retry the same request; do not assume it failed to save.')
    }
    if (!response.ok) {
      if (object(value) && object(value['error']) && typeof value['error']['code'] === 'string' &&
        /^[a-z_]{1,60}$/.test(value['error']['code']) && typeof value['error']['message'] === 'string' && value['error']['message'].length <= 400) {
        throw new ReservationClientError(value['error']['code'], value['error']['message'])
      }
      throw new ReservationClientError('service_error', 'The service could not complete this request. Your input is preserved. Refresh and review before retrying.')
    }
    return value
  }
  function parse(value: unknown) {
    try { return validateReservationSnapshot(value) }
    catch { throw new ReservationClientError('invalid_response', 'The service returned an inconsistent ledger. No replacement data was accepted; check the service and retry.') }
  }
  return {
    async read(signal) { return parse(await request(undefined, signal)) },
    async previewOrders(collection, signal) {
      let captured: unknown
      try {
        const envelope: unknown = JSON.parse(JSON.stringify({ collection }))
        if (!object(envelope) || !Object.hasOwn(envelope, 'collection')) throw new Error('Missing collection')
        captured = envelope['collection']
      } catch { throw new ReservationClientError('invalid_source', 'The saved-order collection could not be captured safely. Review its source before requesting a preview.') }
      const value = await request({ collection: captured }, signal, '/api/reservations/order-sync-preview')
      if (!object(value) || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'snapshot') || !Object.hasOwn(value, 'preview')) {
        throw new ReservationClientError('invalid_response', 'The order-sync review could not be verified. Request a new preview; no sync was submitted.')
      }
      const snapshot = parse(value['snapshot'])
      let preview: OrderSyncPreview
      try { preview = createOrderSyncPreview(snapshot, captured) }
      catch { throw new ReservationClientError('invalid_response', 'The preview source or ledger could not be verified. Request a new preview; no sync was submitted.') }
      if (!equalJson(value['preview'], preview)) throw new ReservationClientError('invalid_response', 'The service preview does not match the captured source and ledger. Request a new preview; no sync was submitted.')
      return { snapshot, preview }
    },
    async execute(command, signal) {
      const captured = { ...command }
      const value = await request(captured, signal)
      if (!object(value) || typeof value['replayed'] !== 'boolean') throw new ReservationClientError('invalid_response', 'The save response could not be verified. Retry the same request to confirm its outcome.')
      const snapshot = parse(value['snapshot'])
      const event = snapshot.events.find(event => event.requestId === captured.requestId.toLowerCase())
      if (event?.kind !== captured.kind || event.sequence !== captured.expectedRevision + 1) {
        throw new ReservationClientError('invalid_response', 'The service did not confirm this request. Retry the same captured request to verify its outcome.')
      }
      if (captured.kind === 'reserve') {
        const hold = snapshot.reservations.find(hold => hold.id === captured.requestId.toLowerCase())
        if (hold?.orderId !== captured.orderId.trim() || hold.lotId !== captured.lotId.trim() || hold.quantity !== captured.quantity || hold.note !== captured.note.trim()) {
          throw new ReservationClientError('invalid_response', 'The service receipt does not match the captured reservation. Your request has been kept for review.')
        }
      }
      if (captured.kind === 'release') {
        const hold = snapshot.reservations.find(hold => hold.id === captured.reservationId.toLowerCase())
        if (hold?.status !== 'released' || hold.releaseReason !== captured.reason.trim() || hold.releasedRevision !== event.sequence) {
          throw new ReservationClientError('invalid_response', 'The service receipt does not confirm this release. Your request has been kept for review.')
        }
      }
      return { snapshot, replayed: value['replayed'] }
    },
    async releaseBatch(batch, signal) {
      let captured: ReservationReleaseBatch
      try { captured = normalizeReservationReleaseBatch(batch) }
      catch { throw new ReservationClientError('invalid_batch', 'Review the selected holds, unique request identifiers, revision, and an 8–240 character reason before submitting the release batch.') }
      const value = await request(captured, signal, '/api/reservations/release-batch')
      if (!object(value) || Object.keys(value).length !== 2 || typeof value['replayed'] !== 'boolean' || !Object.hasOwn(value, 'snapshot')) {
        throw new ReservationClientError('invalid_response', 'The batch response could not be verified. Retry the same captured batch; do not assume any release failed to save.')
      }
      const snapshot = parse(value['snapshot'])
      for (const [index, item] of captured.releases.entries()) {
        const event = snapshot.events.find(event => event.requestId === item.requestId)
        const hold = snapshot.reservations.find(hold => hold.id === item.reservationId)
        if (event?.kind !== 'release' || event.sequence !== captured.expectedRevision + index + 1
          || event.reservationId !== item.reservationId || hold?.status !== 'released'
          || hold.releaseReason !== captured.reason || hold.releasedRevision !== event.sequence || event.orderId !== hold.orderId) {
          throw new ReservationClientError('invalid_response', 'The service did not confirm every captured release. Keep this batch and retry it unchanged to verify the outcome.')
        }
      }
      return { snapshot, replayed: value['replayed'] }
    },
  }
}
