import { describe, expect, it, vi } from 'vitest'
import { seedOrderCollection } from '../order-machine/orderCollection'
import { createReservationClient, ReservationClientError } from './reservationClient'
import { applyReservationCommand, createReservationState, reservationSnapshot } from './reservations'
import type { ReservationCommand } from './reservations'

const syncId = '00000000-0000-4000-8000-000000000001'
const holdId = '00000000-0000-4000-8000-000000000002'
const releaseId = '00000000-0000-4000-8000-000000000003'
const sync = { kind: 'sync-orders' as const, requestId: syncId, expectedRevision: 0, collection: seedOrderCollection() }
const synced = applyReservationCommand(createReservationState(), sync).state
const hold = (): Extract<ReservationCommand, { kind: 'reserve' }> => ({
  kind: 'reserve', requestId: holdId, expectedRevision: 1, orderId: 'PO-8842', lotId: 'MAT-ALLOY',
  quantity: 120, note: 'Reserve for scheduled production',
})
const release = (): Extract<ReservationCommand, { kind: 'release' }> => ({
  kind: 'release', requestId: releaseId, expectedRevision: 2, reservationId: holdId,
  reason: 'Production schedule was cancelled',
})
const reserved = applyReservationCommand(synced, hold()).state
const released = applyReservationCommand(reserved, release()).state
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const saved = (snapshot = reservationSnapshot(reserved), replayed = false) => response({ snapshot, replayed })

describe('local reservation client protocol', () => {
  it('reads only the fixed loopback endpoint with explicit privacy and client headers', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(reservationSnapshot(synced)))
    const controller = new AbortController()
    const result = await createReservationClient(fetcher).read(controller.signal)
    expect(result).toEqual(reservationSnapshot(synced))
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4404/api/reservations', {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-FactoryOS-Client': 'reservations' }, signal: controller.signal,
    })
  })

  it('captures the exact POST body and acknowledgement identity before an in-flight caller edit', async () => {
    let finish!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const command = hold()
    const originalBody = JSON.stringify(command)
    const controller = new AbortController()
    const pending = createReservationClient(fetcher).execute(command, controller.signal)
    command.requestId = releaseId
    command.quantity = 1
    command.note = 'Changed after sending'
    finish(saved())
    await expect(pending).resolves.toMatchObject({ snapshot: { revision: 2 }, replayed: false })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4404/api/reservations', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-FactoryOS-Client': 'reservations', 'Content-Type': 'application/json' },
      body: originalBody, signal: controller.signal,
    })
  })

  it('does not retry or generate a request ID and permits an explicit identical retry after ambiguous failure', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('Secret path C:/private/token.txt'))
      .mockResolvedValueOnce(saved(reservationSnapshot(released), true))
    const client = createReservationClient(fetcher)
    const command = hold()
    await expect(client.execute(command)).rejects.toMatchObject({ code: 'connection' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(command).toEqual(hold())
    const result = await client.execute(command)
    expect(result.replayed).toBe(true)
    expect(result.snapshot.revision).toBe(3)
    expect(result.snapshot.reservations[0]?.status).toBe('released')
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body)
  })

  it('validates sync and release acknowledgements against real ledger events', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(saved(reservationSnapshot(synced)))
      .mockResolvedValueOnce(saved(reservationSnapshot(released)))
    const client = createReservationClient(fetcher)
    await expect(client.execute(sync)).resolves.toMatchObject({ snapshot: { revision: 1 } })
    await expect(client.execute(release())).resolves.toMatchObject({ snapshot: { revision: 3 } })
  })

  it('verifies multiline textarea intent without flattening its internal formatting', async () => {
    const command = { ...hold(), note: '  Assembly planning\n\tSecond shift reviewed\r\nReserve full batch  ' }
    const next = applyReservationCommand(synced, command).snapshot
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(saved(next))
    const result = await createReservationClient(fetcher).execute(command)
    expect(result.snapshot.reservations[0]?.note).toBe(command.note.trim())
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(command))
  })

  it.each([null, {}, { ...reservationSnapshot(synced), revision: 99 }, { ...reservationSnapshot(reserved), orders: [] }])('fails closed for malformed or inconsistent snapshots', async value => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value))
    await expect(createReservationClient(fetcher).read()).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects malformed JSON and malformed mutation envelopes without returning replacement state', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('private raw service diagnostic'))
      .mockResolvedValueOnce(response({ snapshot: reservationSnapshot(reserved), replayed: 'yes' }))
    const client = createReservationClient(fetcher)
    await expect(client.read()).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(client.execute(hold())).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects a valid snapshot which contains no acknowledgement of the submitted request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(saved(reservationSnapshot(synced)))
    await expect(createReservationClient(fetcher).execute(hold())).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects acknowledgement events with the wrong command kind or revision', async () => {
    const wrongKind = applyReservationCommand(createReservationState(), { ...sync, requestId: holdId }).snapshot
    const later = applyReservationCommand(synced, { ...sync, requestId: releaseId, expectedRevision: 1 }).state
    const wrongRevision = applyReservationCommand(later, { ...hold(), expectedRevision: 2 }).snapshot
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(saved(wrongKind)).mockResolvedValueOnce(saved(wrongRevision))
    const client = createReservationClient(fetcher)
    await expect(client.execute(hold())).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(client.execute(hold())).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects a valid ledger when its acknowledged hold or release intent differs from the captured command', async () => {
    const wrongQuantity = applyReservationCommand(synced, { ...hold(), quantity: 1 }).snapshot
    const wrongReason = applyReservationCommand(reserved, { ...release(), reason: 'Different release intent' }).snapshot
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(saved(wrongQuantity)).mockResolvedValueOnce(saved(wrongReason))
    const client = createReservationClient(fetcher)
    await expect(client.execute(hold())).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(client.execute(release())).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('preserves bounded structured service errors but does not expose raw unknown failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ error: { code: 'revision_conflict', message: 'Refresh the reservation workspace.' } }, 409))
      .mockResolvedValueOnce(response({ stack: 'private token raw stack' }, 500))
      .mockRejectedValueOnce(new Error('private token network stack'))
    const client = createReservationClient(fetcher)
    await expect(client.execute(hold())).rejects.toEqual(new ReservationClientError('revision_conflict', 'Refresh the reservation workspace.'))
    await expect(client.read()).rejects.toMatchObject({ code: 'service_error', message: 'The service could not complete this request. Your input is preserved. Refresh and review before retrying.' })
    await expect(client.read()).rejects.toMatchObject({ code: 'connection', message: 'The local reservation service could not be reached. Start it, then retry. Your draft and captured request have been kept.' })
  })

  it('preserves an aborted fetch as cancellation instead of a connection error', async () => {
    const abort = new DOMException('The request was cancelled', 'AbortError')
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(abort)
    await expect(createReservationClient(fetcher).read()).rejects.toBe(abort)
  })

  it('preserves cancellation while reading a response body', async () => {
    const abort = new DOMException('The body read was cancelled', 'AbortError')
    const body = response(reservationSnapshot(synced))
    vi.spyOn(body, 'text').mockRejectedValue(abort)
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(body)
    await expect(createReservationClient(fetcher).read()).rejects.toBe(abort)
  })
})
