import { validateReservationSnapshot, type ReservationCommand, type ReservationSnapshot } from './reservations'

export class ReservationClientError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'ReservationClientError'; this.code = code }
}
export interface ReservationClient {
  read(signal?: AbortSignal): Promise<ReservationSnapshot>
  execute(command: ReservationCommand, signal?: AbortSignal): Promise<{ snapshot: ReservationSnapshot; replayed: boolean }>
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
export function createReservationClient(fetcher: typeof fetch = globalThis.fetch): ReservationClient {
  async function request(command: ReservationCommand | undefined, signal?: AbortSignal): Promise<unknown> {
    let response: Response
    try {
      response = await fetcher('http://127.0.0.1:4404/api/reservations', {
        method: command ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { 'X-FactoryOS-Client': 'reservations', ...(command ? { 'Content-Type': 'application/json' } : {}) },
        ...(command ? { body: JSON.stringify(command) } : {}), ...(signal ? { signal } : {}),
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
  }
}
