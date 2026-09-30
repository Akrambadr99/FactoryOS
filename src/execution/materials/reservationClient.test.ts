import { describe, expect, it, vi } from 'vitest'
import { seedOrderCollection } from '../order-machine/orderCollection'
import { createReservationClient, ReservationClientError } from './reservationClient'
import { applyReservationCommand, applyReservationReleaseBatch, createReservationState, normalizeReservationReleaseBatch, reservationSnapshot } from './reservations'
import type { ReservationCommand, ReservationReleaseBatch } from './reservations'
import { createOrderSyncPreview } from './orderSyncPreview'

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
const secondHoldId = '00000000-0000-4000-8000-000000000004'
const secondReleaseId = '00000000-0000-4000-8000-000000000005'
const batchHeld = applyReservationCommand(reserved, { ...hold(), requestId: secondHoldId, expectedRevision: 2, lotId: 'MAT-FASTENER' }).state
const batchRequest: ReservationReleaseBatch = { expectedRevision: 3, reason: 'Changed production schedule', releases: [
  { requestId: releaseId, reservationId: holdId }, { requestId: secondReleaseId, reservationId: secondHoldId },
] }
const batchSaved = applyReservationReleaseBatch(batchHeld, batchRequest).state
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

  it('requests a non-mutating preview at the exact endpoint and deep-captures nested source data', async () => {
    let finish!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const collection = structuredClone(seedOrderCollection()), original = structuredClone(collection)
    const controller = new AbortController(), snapshot = reservationSnapshot(synced)
    const pending = createReservationClient(fetcher).previewOrders(collection, controller.signal)
    const first = collection.orders[0]
    if (!first) throw new Error('Missing fixture order.')
    first.aggregate.order.target = 777
    finish(response({ preview: createOrderSyncPreview(snapshot, original), snapshot }))
    await expect(pending).resolves.toEqual({ snapshot, preview: createOrderSyncPreview(snapshot, original) })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4404/api/reservations/order-sync-preview', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-FactoryOS-Client': 'reservations', 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: original }), signal: controller.signal,
    })
    expect(synced.revision).toBe(1); expect(synced.receipts).toHaveLength(1)
  })

  it.each(['count', 'stale-revision', 'missing-change', 'extra-property', 'malformed-snapshot'])('rejects a misleading %s preview response', async issue => {
    const snapshot = reservationSnapshot(createReservationState()), collection = seedOrderCollection()
    const preview = createOrderSyncPreview(snapshot, collection)
    const value = issue === 'count' ? { snapshot, preview: { ...preview, added: 0 } }
      : issue === 'stale-revision' ? { snapshot, preview: { ...preview, revision: 9 } }
        : issue === 'missing-change' ? { snapshot, preview: { ...preview, changes: preview.changes.slice(1) } }
          : issue === 'extra-property' ? { snapshot, preview: { ...preview, approved: true } }
            : { snapshot: { ...snapshot, revision: 1 }, preview }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value))
    await expect(createReservationClient(fetcher).previewOrders(collection)).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects a preview of caller edits made after sending rather than accepting the changed intent', async () => {
    let finish!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const collection = structuredClone(seedOrderCollection()), snapshot = reservationSnapshot(synced)
    const pending = createReservationClient(fetcher).previewOrders(collection)
    const first = collection.orders[0]
    if (!first) throw new Error('Missing fixture order.')
    first.aggregate.order.target = 777
    finish(response({ snapshot, preview: createOrderSyncPreview(snapshot, collection) }))
    await expect(pending).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects malformed source capture and unverified response envelopes without submitting a sync', async () => {
    const cyclic: Record<string, unknown> = {}; cyclic['self'] = cyclic
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ snapshot: reservationSnapshot(synced) }))
    const client = createReservationClient(fetcher)
    await expect(client.previewOrders(cyclic)).rejects.toMatchObject({ code: 'invalid_source' })
    await expect(client.previewOrders(undefined)).rejects.toMatchObject({ code: 'invalid_source' })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(client.previewOrders(seedOrderCollection())).rejects.toMatchObject({ code: 'invalid_response' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('surfaces safe preview errors without automatic retries or commands', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ error: { code: 'invalid_command', message: 'Repair the source collection.' } }, 400))
      .mockRejectedValueOnce(new Error('private raw network detail'))
    const client = createReservationClient(fetcher)
    await expect(client.previewOrders(seedOrderCollection())).rejects.toEqual(new ReservationClientError('invalid_command', 'Repair the source collection.'))
    await expect(client.previewOrders(seedOrderCollection())).rejects.toMatchObject({ code: 'connection' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([url]) => url === 'http://127.0.0.1:4404/api/reservations/order-sync-preview')).toBe(true)
  })

  it.each(['fetch', 'body'])('preserves cancellation during preview %s', async stage => {
    const abort = new DOMException('Preview cancelled', 'AbortError')
    const result = response({ snapshot: reservationSnapshot(synced), preview: createOrderSyncPreview(reservationSnapshot(synced), seedOrderCollection()) })
    const fetcher = vi.fn<typeof fetch>()
    if (stage === 'fetch') fetcher.mockRejectedValue(abort)
    else { vi.spyOn(result, 'text').mockRejectedValue(abort); fetcher.mockResolvedValue(result) }
    await expect(createReservationClient(fetcher).previewOrders(seedOrderCollection())).rejects.toBe(abort)
  })

  it('deep-captures and canonicalizes a whole release batch before an in-flight caller edit', async () => {
    let finish!: (value: Response) => void
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const batch = { ...batchRequest, reason: '  ' + batchRequest.reason + '  ', releases: batchRequest.releases.map(item => ({
      requestId: item.requestId.toUpperCase(), reservationId: item.reservationId.toUpperCase(),
    })) }
    const captured = normalizeReservationReleaseBatch(batch), controller = new AbortController()
    const pending = createReservationClient(fetcher).releaseBatch(batch, controller.signal)
    batch.reason = 'Different reason after submission'
    const first = batch.releases[0]
    if (!first) throw new Error('Missing fixture release.')
    first.reservationId = secondHoldId; first.requestId = syncId
    finish(saved(reservationSnapshot(batchSaved)))
    await expect(pending).resolves.toEqual({ snapshot: reservationSnapshot(batchSaved), replayed: false })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4404/api/reservations/release-batch', {
      method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { 'X-FactoryOS-Client': 'reservations', 'Content-Type': 'application/json' },
      body: JSON.stringify(captured), signal: controller.signal,
    })
  })

  it('keeps an ambiguous batch retry identical and verifies all receipts in a newer current snapshot', async () => {
    const newer = applyReservationCommand(batchSaved, { ...sync, requestId: '00000000-0000-4000-8000-000000000099', expectedRevision: batchSaved.revision }).state
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('private network details')).mockResolvedValueOnce(saved(reservationSnapshot(newer), true))
    const client = createReservationClient(fetcher)
    await expect(client.releaseBatch(batchRequest)).rejects.toMatchObject({ code: 'connection' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await expect(client.releaseBatch(batchRequest)).resolves.toMatchObject({ replayed: true, snapshot: { revision: 6 } })
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body)
  })

  it('rejects a valid partial snapshot instead of treating the first acknowledgement as batch success', async () => {
    const partial = applyReservationCommand(batchHeld, { ...release(), expectedRevision: batchRequest.expectedRevision, reason: batchRequest.reason }).state
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(saved(reservationSnapshot(partial)))
    await expect(createReservationClient(fetcher).releaseBatch(batchRequest)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('verifies the final item reason and ordered revision instead of only checking that every hold is released', async () => {
    const first = applyReservationCommand(batchHeld, { ...release(), expectedRevision: batchRequest.expectedRevision, reason: batchRequest.reason }).state
    const wrongReason = applyReservationCommand(first, { kind: 'release', requestId: secondReleaseId, expectedRevision: 4,
      reservationId: secondHoldId, reason: 'Different second release reason' }).state
    const wrongOrder = applyReservationReleaseBatch(batchHeld, { ...batchRequest, releases: batchRequest.releases.toReversed() }).state
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(saved(reservationSnapshot(wrongReason))).mockResolvedValueOnce(saved(reservationSnapshot(wrongOrder)))
    const client = createReservationClient(fetcher)
    await expect(client.releaseBatch(batchRequest)).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(client.releaseBatch(batchRequest)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('rejects malformed batch input locally without generating requests', async () => {
    const fetcher = vi.fn<typeof fetch>(), client = createReservationClient(fetcher)
    for (const batch of [{ ...batchRequest, releases: [] }, { ...batchRequest, reason: 'short' },
      { ...batchRequest, releases: [...batchRequest.releases, ...batchRequest.releases] }]) {
      await expect(client.releaseBatch(batch)).rejects.toMatchObject({ code: 'invalid_batch' })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([null, {}, { snapshot: reservationSnapshot(batchSaved), replayed: 'yes' },
    { snapshot: reservationSnapshot(batchSaved), replayed: true, partial: true }])('rejects an unverified batch response envelope: %j', async value => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(value))
    await expect(createReservationClient(fetcher).releaseBatch(batchRequest)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('preserves safe partial-receipt errors and never automatically completes or retries a batch', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: 'idempotency_conflict', message: 'Only part of this batch has saved receipts. Refresh and review.' } }, 409))
    await expect(createReservationClient(fetcher).releaseBatch(batchRequest)).rejects.toEqual(new ReservationClientError('idempotency_conflict', 'Only part of this batch has saved receipts. Refresh and review.'))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(['fetch', 'body'])('preserves cancellation during release-batch %s', async stage => {
    const abort = new DOMException('Batch cancelled', 'AbortError'), result = saved(reservationSnapshot(batchSaved))
    const fetcher = vi.fn<typeof fetch>()
    if (stage === 'fetch') fetcher.mockRejectedValue(abort)
    else { vi.spyOn(result, 'text').mockRejectedValue(abort); fetcher.mockResolvedValue(result) }
    await expect(createReservationClient(fetcher).releaseBatch(batchRequest)).rejects.toBe(abort)
  })
})
