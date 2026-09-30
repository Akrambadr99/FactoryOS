import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrder, seedOrderCollection } from '../src/execution/order-machine/orderCollection'
import { validateReservationSnapshot } from '../src/execution/materials/reservations'
import { startReservationServer, type ReservationServer } from './reservationServer'

const route = '/api/reservations/release-batch'
const services: ReservationServer[] = []
const databases: Database.Database[] = []
const directories: { directory: string; parent: string }[] = []
async function temporary() {
  const parent = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(parent, 'factoryos-release-batch-http-'))
  directories.push({ directory, parent })
  return directory
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const database of databases.splice(0)) if (database.open) database.close()
  for (const service of services.splice(0)) await service.close()
  for (const { directory, parent } of directories.splice(0)) {
    const resolved = await fs.realpath(directory)
    expect(resolved).toBe(path.resolve(directory))
    expect(path.dirname(resolved)).toBe(parent)
    expect(path.basename(resolved)).toMatch(/^factoryos-release-batch-http-/)
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
async function launch(directory: string, storage: 'sqlite' | 'json' = 'sqlite') {
  const service = await startReservationServer({ directory, port: 0, storage })
  services.push(service)
  return service
}
interface HttpResponse { status: number; text: string; headers: Record<string, string | string[] | undefined> }
function call(service: ReservationServer, target = route, options: {
  method?: string; body?: string | Buffer; headers?: Record<string, string | undefined>; chunked?: boolean
} = {}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const supplied: Record<string, string | undefined> = { Origin: 'http://127.0.0.1:4304', 'X-FactoryOS-Client': 'reservations',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers }
    const headers: Record<string, string | number | undefined> = Object.fromEntries(Object.entries(supplied).filter(([, value]) => value !== undefined))
    if (options.body !== undefined && !options.chunked) headers['Content-Length'] = Buffer.byteLength(options.body)
    const request = httpRequest({ hostname: '127.0.0.1', port: service.port, path: target, method: options.method ?? 'POST', headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.on('end', () => { resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers }) })
      response.on('error', reject)
    })
    request.setTimeout(5_000, () => { request.destroy(new Error('The release-batch HTTP fixture timed out.')) })
    request.on('error', reject)
    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}
const decoded = (response: HttpResponse): unknown => JSON.parse(response.text) as unknown
const command = (service: ReservationServer, value: unknown) => call(service, '/api/reservations', { body: JSON.stringify(value) })
const batch = (service: ReservationServer, value: unknown) => call(service, route, { body: JSON.stringify(value) })
async function snapshot(service: ReservationServer) {
  const response = await call(service, '/api/reservations', { method: 'GET' })
  expect(response.status).toBe(200)
  return validateReservationSnapshot(decoded(response))
}
async function evidence(directory: string) {
  const file = path.join(directory, 'reservations.sqlite')
  const bytes = await fs.readFile(file)
  const database = new Database(file, { readonly: true, fileMustExist: true })
  try {
    return { bytes, metadata: database.prepare('SELECT * FROM metadata').all(),
      receipts: database.prepare('SELECT * FROM receipts ORDER BY revision').all(),
      events: database.prepare('SELECT * FROM events ORDER BY sequence').all(),
      files: (await fs.readdir(directory)).sort() }
  } finally { database.close() }
}
function releasePayload(reservationIds: readonly string[], expectedRevision = 3) {
  return { expectedRevision, reason: '  Production plan withdrawn\nRelease all selected holds  ',
    releases: reservationIds.map(reservationId => ({ requestId: randomUUID(), reservationId })) }
}
async function setup(storage: 'sqlite' | 'json' = 'sqlite', count = 2) {
  const directory = await temporary(), service = await launch(directory, storage)
  const collection = createOrder(seedOrderCollection(), 'PO-9900', 'assembly', 'LOT-55')
  expect((await command(service, { kind: 'sync-orders', requestId: randomUUID(), expectedRevision: 0, collection })).status).toBe(200)
  const holds: string[] = []
  for (let index = 0; index < count; index++) {
    const requestId = randomUUID()
    expect((await command(service, { kind: 'reserve', requestId, expectedRevision: index + 1,
      orderId: index < 2 ? 'PO-8842' : 'PO-9900', lotId: index % 2 ? 'MAT-FASTENER' : 'MAT-ALLOY',
      quantity: 100, note: 'Production material hold for batch release' })).status).toBe(200)
    holds.push(requestId)
  }
  return { directory, service, holds, payload: releasePayload(holds, count + 1) }
}

describe('atomic material release batch HTTP', () => {
  it('commits all releases with existing per-release receipts and replays after restart without another write', async () => {
    const { directory, service, payload } = await setup()
    const result = await batch(service, payload)
    expect(result.status).toBe(200)
    expect(decoded(result)).toMatchObject({ replayed: false, snapshot: { revision: 5 } })
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.headers['x-content-type-options']).toBe('nosniff')
    const released = await snapshot(service)
    expect(released.reservations.map(hold => [hold.status, hold.releasedRevision, hold.releaseReason])).toEqual([
      ['released', 4, payload.reason.trim()], ['released', 5, payload.reason.trim()],
    ])
    expect(released.events.slice(-2).map(event => [event.kind, event.requestId])).toEqual(payload.releases.map(item => ['release', item.requestId]))
    const reader = new Database(path.join(directory, 'reservations.sqlite'), { readonly: true, fileMustExist: true })
    try {
      const receipts = reader.prepare<[], { payload: string }>('SELECT payload FROM receipts WHERE revision > 3 ORDER BY revision').all()
      expect(receipts.map(row => {
        const parsed: unknown = JSON.parse(row.payload)
        return parsed
      })).toEqual(payload.releases.map((item, index) => ({ requestId: item.requestId, revision: 4 + index,
        fingerprint: JSON.stringify({ kind: 'release', requestId: item.requestId, expectedRevision: 3 + index,
          reservationId: item.reservationId, reason: payload.reason.trim() }) })))
      expect(reader.pragma('user_version', { simple: true })).toBe(1)
    } finally { reader.close() }
    await service.close()
    const restarted = await launch(directory)
    expect(await snapshot(restarted)).toEqual(released)
    const disk = await evidence(directory)
    expect(decoded(await batch(restarted, payload))).toEqual({ snapshot: released, replayed: true })
    expect(await evidence(directory)).toEqual(disk)
  })

  it('returns the current snapshot when a matching batch is replayed after newer history', async () => {
    const { directory, service, payload } = await setup()
    expect((await batch(service, payload)).status).toBe(200)
    expect((await command(service, { kind: 'sync-orders', requestId: randomUUID(), expectedRevision: 5, collection: seedOrderCollection() })).status).toBe(200)
    const current = await snapshot(service), disk = await evidence(directory)
    expect(decoded(await batch(service, payload))).toEqual({ snapshot: current, replayed: true })
    expect(current.revision).toBe(6)
    expect(await evidence(directory)).toEqual(disk)
  })

  it.each(['stale', 'missing-last', 'released-last'])('rejects %s atomically without modifying the first hold or any database byte', async failure => {
    const { directory, service, payload, holds } = await setup()
    if (failure === 'released-last') {
      expect((await command(service, { kind: 'release', requestId: randomUUID(), expectedRevision: 3,
        reservationId: holds[1], reason: 'Earlier deliberate release of one hold' })).status).toBe(200)
    }
    const before = await snapshot(service), disk = await evidence(directory)
    const attempted = failure === 'stale' ? { ...payload, expectedRevision: 2 }
      : failure === 'missing-last' ? { ...payload, releases: payload.releases.map((item, index) => index ? { ...item, reservationId: randomUUID() } : item) }
      : { ...payload, expectedRevision: 4 }
    const response = await batch(service, attempted)
    expect(response.status).toBe(failure === 'missing-last' ? 404 : 409)
    expect(decoded(response)).toMatchObject({ error: { code: failure === 'stale' ? 'revision_conflict' : failure === 'missing-last' ? 'not_found' : 'reservation_conflict' } })
    expect(await snapshot(service)).toEqual(before)
    expect(await evidence(directory)).toEqual(disk)
  })

  it('rejects partial legacy receipt presence without completing the unsaved release', async () => {
    const { directory, service, payload } = await setup()
    const first = payload.releases[0]
    if (!first) throw new Error('Expected a captured release.')
    expect((await command(service, { kind: 'release', ...first, expectedRevision: 3, reason: payload.reason })).status).toBe(200)
    const before = await snapshot(service), disk = await evidence(directory)
    const response = await batch(service, payload)
    expect(response.status).toBe(409)
    expect(decoded(response)).toMatchObject({ error: { code: 'idempotency_conflict' } })
    expect(before.reservations.map(hold => hold.status)).toEqual(['released', 'active'])
    expect(await snapshot(service)).toEqual(before)
    expect(await evidence(directory)).toEqual(disk)
  })

  it('rejects changed common reason or release order on reused receipts without rewriting them', async () => {
    const { directory, service, payload } = await setup()
    expect((await batch(service, payload)).status).toBe(200)
    const disk = await evidence(directory)
    for (const changed of [{ ...payload, reason: 'Different release instruction' }, { ...payload, releases: [...payload.releases].reverse() }]) {
      const response = await batch(service, changed)
      expect(response.status).toBe(409)
      expect(decoded(response)).toMatchObject({ error: { code: 'idempotency_conflict' } })
    }
    expect(await evidence(directory)).toEqual(disk)
  })

  it('allows only one competing base revision and never partially releases the losing batch', async () => {
    const { service, holds } = await setup('sqlite', 4)
    const batches = [releasePayload(holds.slice(0, 2), 5), releasePayload(holds.slice(2), 5)]
    const responses = await Promise.all(batches.map(payload => batch(service, payload)))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const losing = responses.findIndex(response => response.status === 409)
    const failed = responses[losing], lostBatch = batches[losing]
    if (!failed || !lostBatch) throw new Error('Expected one competing batch to lose.')
    expect(decoded(failed)).toMatchObject({ error: { code: 'revision_conflict' } })
    const current = await snapshot(service)
    expect(current.revision).toBe(7)
    expect(current.reservations.filter(hold => hold.status === 'released')).toHaveLength(2)
    for (const item of lostBatch.releases) expect(current.reservations.find(hold => hold.id === item.reservationId)?.status).toBe('active')
  })

  it('rolls back hold, event, and first-receipt writes when SQLite rejects the final receipt', async () => {
    const { directory, service, payload } = await setup()
    const writer = new Database(path.join(directory, 'reservations.sqlite'), { fileMustExist: true })
    databases.push(writer)
    // A separate test connection adds this after startup's schema audit. SQLite
    // aborts only on the final receipt, after both holds/events and one receipt.
    writer.exec("CREATE TRIGGER batch_receipt_fault BEFORE INSERT ON receipts WHEN NEW.revision = 5 BEGIN SELECT RAISE(ABORT, 'private-storage-details'); END")
    const before = await snapshot(service), disk = await evidence(directory)
    const response = await batch(service, payload)
    expect(response.status).toBe(503)
    expect(decoded(response)).toMatchObject({ error: { code: 'storage_unavailable' } })
    expect(response.text).not.toContain('private-storage-details')
    expect(await snapshot(service)).toEqual(before)
    expect(await evidence(directory)).toEqual(disk)
    writer.exec('DROP TRIGGER batch_receipt_fault')
    expect(decoded(await batch(service, payload))).toMatchObject({ replayed: false, snapshot: { revision: 5 } })
    expect(decoded(await batch(service, payload))).toMatchObject({ replayed: true })
  })

  it('retains one-publish atomicity and restart receipts in the explicit JSON compatibility adapter', async () => {
    const { directory, service, payload } = await setup('json')
    const file = path.join(directory, 'reservations.json'), before = await fs.readFile(file)
    const invalid = { ...payload, releases: payload.releases.map((item, index) => index ? { ...item, reservationId: randomUUID() } : item) }
    expect((await batch(service, invalid)).status).toBe(404)
    expect(await fs.readFile(file)).toEqual(before)
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('private failed publication'))
    expect((await batch(service, payload)).status).toBe(503)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(file)).toEqual(before)
    rename.mockRestore()
    const publish = vi.spyOn(fs, 'rename')
    expect((await batch(service, payload)).status).toBe(200)
    expect(publish).toHaveBeenCalledTimes(1)
    publish.mockRestore()
    await service.close()
    const restarted = await launch(directory, 'json'), saved = await fs.readFile(file)
    expect(decoded(await batch(restarted, payload))).toMatchObject({ replayed: true, snapshot: { revision: 5 } })
    expect(await fs.readFile(file)).toEqual(saved)
  })

  it.each(['empty', 'over-limit', 'duplicate-hold', 'duplicate-request', 'extra-root', 'extra-item', 'reason', 'revision'])('rejects malformed batch %s before changing persistence', async issue => {
    const { directory, service, payload } = await setup()
    const first = payload.releases[0]
    if (!first) throw new Error('Expected a captured release.')
    const malformed = issue === 'empty' ? { ...payload, releases: [] }
      : issue === 'over-limit' ? { ...payload, releases: Array.from({ length: 26 }, () => ({ requestId: randomUUID(), reservationId: randomUUID() })) }
      : issue === 'duplicate-hold' ? { ...payload, releases: [{ ...first }, { requestId: randomUUID(), reservationId: first.reservationId }] }
      : issue === 'duplicate-request' ? { ...payload, releases: payload.releases.map(item => ({ ...item, requestId: first.requestId })) }
      : issue === 'extra-root' ? { ...payload, batchId: randomUUID() }
      : issue === 'extra-item' ? { ...payload, releases: payload.releases.map(item => ({ ...item, quantity: 1 })) }
      : issue === 'reason' ? { ...payload, reason: 'short' } : { ...payload, expectedRevision: -1 }
    const disk = await evidence(directory)
    const response = await batch(service, malformed)
    expect(response.status).toBe(400)
    expect(decoded(response)).toMatchObject({ error: { code: 'invalid_command' } })
    expect(await evidence(directory)).toEqual(disk)
  })

  it.each([{ Origin: undefined }, { Origin: 'https://untrusted.example' }, { Origin: 'null' },
    { Origin: 'http://127.0.0.1:4300' }, { Host: 'untrusted.example' },
    { 'X-FactoryOS-Client': undefined }, { 'X-FactoryOS-Client': 'wrong-client' }])('preserves HTTP request boundaries for %j', async headers => {
    const { directory, service, payload } = await setup()
    const disk = await evidence(directory)
    expect((await call(service, route, { body: JSON.stringify(payload), headers })).status).toBe(403)
    expect(await evidence(directory)).toEqual(disk)
  })

  it('supports only the exact POST route and POST preflight, preserving existing route methods', async () => {
    const { directory, service, payload } = await setup()
    const disk = await evidence(directory)
    const headers = { Origin: 'http://localhost:4304', 'X-FactoryOS-Client': undefined,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-factoryos-client' }
    const allowed = await call(service, route, { method: 'OPTIONS', headers })
    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-methods']).toBe('POST')
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await call(service, route, { method })).status).toBe(405)
      expect((await call(service, route, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': method } })).status).toBe(403)
    }
    expect((await call(service, route, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Headers': 'content-type' } })).status).toBe(403)
    expect((await call(service, route, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Headers': 'x-factoryos-client,x-extra' } })).status).toBe(403)
    for (const target of [route + '/', route + '?revision=3', '/api/reservations/release-%62atch', '/api/reservations/../reservations/release-batch']) {
      expect((await call(service, target, { body: JSON.stringify(payload) })).status).toBe(404)
    }
    expect((await call(service, '/api/reservations', { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'GET' } })).headers['access-control-allow-methods']).toBe('GET, POST')
    expect(await evidence(directory)).toEqual(disk)
  })

  it('rejects malformed UTF-8, JSON, media, encoding, and declared or streamed oversized bodies', async () => {
    const { directory, service } = await setup()
    const disk = await evidence(directory)
    for (const body of ['{invalid', Buffer.from([0xff])]) expect((await call(service, route, { body })).status).toBe(400)
    expect((await call(service, route, { body: '{}', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    expect((await call(service, route, { body: '{}', headers: { 'Content-Encoding': 'gzip' } })).status).toBe(415)
    const large = 'a'.repeat(2 * 1024 * 1024 + 1)
    expect((await call(service, route, { body: large })).status).toBe(413)
    expect((await call(service, route, { body: large, chunked: true })).status).toBe(413)
    expect(await evidence(directory)).toEqual(disk)
  })
})
