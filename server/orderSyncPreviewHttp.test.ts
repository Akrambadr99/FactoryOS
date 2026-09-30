import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createOrder, seedOrderCollection } from '../src/execution/order-machine/orderCollection'
import { createOrderSyncPreview } from '../src/execution/materials/orderSyncPreview'
import { validateReservationSnapshot } from '../src/execution/materials/reservations'
import { startReservationServer, type ReservationServer } from './reservationServer'

const previewPath = '/api/reservations/order-sync-preview'
const services: ReservationServer[] = []
const directories: { directory: string; parent: string }[] = []
async function temporary() {
  const parent = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(parent, 'factoryos-sync-preview-http-'))
  directories.push({ directory, parent })
  return directory
}
async function launch(directory = '', storage: 'sqlite' | 'json' = 'sqlite') {
  const resolved = directory || await temporary()
  const service = await startReservationServer({ directory: resolved, port: 0, storage })
  services.push(service)
  return { service, directory: resolved }
}
afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  for (const { directory, parent } of directories.splice(0)) {
    const resolved = await fs.realpath(directory)
    expect(resolved).toBe(path.resolve(directory))
    expect(path.dirname(resolved)).toBe(parent)
    expect(path.basename(resolved)).toMatch(/^factoryos-sync-preview-http-/)
    await fs.rm(resolved, { recursive: true, force: true })
  }
})

interface HttpResponse { status: number; text: string; headers: Record<string, string | string[] | undefined> }
function call(service: ReservationServer, target = previewPath, options: {
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
    request.setTimeout(5_000, () => { request.destroy(new Error('The order-sync preview HTTP fixture timed out.')) })
    request.on('error', reject)
    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}
const decoded = (response: HttpResponse): unknown => JSON.parse(response.text) as unknown
const post = (service: ReservationServer, command: unknown) => call(service, '/api/reservations', { body: JSON.stringify(command) })
const preview = (service: ReservationServer, collection: unknown) => call(service, previewPath, { body: JSON.stringify({ collection }) })
const sync = (expectedRevision = 0) => ({ kind: 'sync-orders', requestId: randomUUID(), expectedRevision, collection: seedOrderCollection() })
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

describe('read-only order-sync preview HTTP endpoint', () => {
  it('previews an initial import without changing SQLite bytes, state, revision, receipts, or restart state', async () => {
    const { service, directory } = await launch()
    const before = await snapshot(service)
    const disk = await evidence(directory)
    const collection = seedOrderCollection()
    const response = await preview(service, collection)
    expect(response.status).toBe(200)
    expect(decoded(response)).toEqual({ snapshot: before, preview: createOrderSyncPreview(before, collection) })
    expect(decoded(response)).toMatchObject({ preview: { revision: 0, sourceCount: 6, added: 6, updated: 0, removed: 0, unchanged: 0, blocked: 0 } })
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:4304')
    expect(await snapshot(service)).toEqual(before)
    expect(await evidence(directory)).toEqual(disk)
    await service.close()
    const restarted = (await launch(directory)).service
    expect(await snapshot(restarted)).toEqual(before)
    expect(await evidence(directory)).toEqual(disk)
  })

  it('reports additions, updates, removals, and active-hold blockers without applying any change', async () => {
    const { service, directory } = await launch()
    expect((await post(service, sync())).status).toBe(200)
    expect((await post(service, { kind: 'reserve', requestId: randomUUID(), expectedRevision: 1,
      orderId: 'PO-8842', lotId: 'MAT-ALLOY', quantity: 120, note: 'Preserve this active production hold' })).status).toBe(200)
    const source = createOrder(seedOrderCollection(), 'PO-9900', 'assembly', 'LOT-55')
    const collection = { ...source, orders: source.orders.filter(order => order.id !== 'PO-8847').map(order => order.id === 'PO-8842'
      ? { ...order, aggregate: { ...order.aggregate, order: { ...order.aggregate.order, target: 240 } } }
      : order.id === 'PO-8843' ? { ...order, line: 'packaging' } : order) }
    const before = await snapshot(service)
    const disk = await evidence(directory)
    const response = await preview(service, collection)
    expect(response.status).toBe(200)
    expect(decoded(response)).toEqual({ snapshot: before, preview: createOrderSyncPreview(before, collection) })
    expect(decoded(response)).toMatchObject({ preview: { revision: 2, sourceCount: 6, added: 1, updated: 2, removed: 1, unchanged: 3, blocked: 1,
      changes: [{ id: 'PO-8842', kind: 'updated', fields: ['target'], activeHoldIds: [before.reservations[0]?.id] },
        { id: 'PO-8843', kind: 'updated', fields: ['line'], activeHoldIds: [] },
        { id: 'PO-8847', kind: 'removed', activeHoldIds: [] }, { id: 'PO-9900', kind: 'added', activeHoldIds: [] }] } })
    expect(await snapshot(service)).toEqual(before)
    expect(await evidence(directory)).toEqual(disk)
    const confirm = await post(service, { ...sync(2), collection })
    expect(confirm.status).toBe(409)
    expect(decoded(confirm)).toMatchObject({ error: { code: 'order_conflict' } })
    expect(await evidence(directory)).toEqual(disk)
  })

  it('previews harmless metadata changes and repeated identical previews without adding history', async () => {
    const { service, directory } = await launch()
    const source = seedOrderCollection()
    expect((await post(service, sync())).status).toBe(200)
    const collection = { ...source, lotIndexes: source.lotIndexes.map(lot => ({ ...lot, available: false })) }
    const before = await snapshot(service)
    const disk = await evidence(directory)
    const first = await preview(service, collection)
    const second = await preview(service, collection)
    expect(first.status).toBe(200)
    expect(decoded(second)).toEqual(decoded(first))
    expect(decoded(first)).toEqual({ snapshot: before, preview: createOrderSyncPreview(before, collection) })
    expect(decoded(first)).toMatchObject({ preview: { unchanged: 6, added: 0, updated: 0, removed: 0, blocked: 0, changes: [] } })
    expect(await evidence(directory)).toEqual(disk)
  })

  it('does not let an earlier preview bypass revision conflicts after another successful command', async () => {
    const { service, directory } = await launch()
    expect((await post(service, sync())).status).toBe(200)
    const collection = createOrder(seedOrderCollection(), 'PO-9900', 'assembly', 'LOT-55')
    const before = await snapshot(service)
    const proposed = await preview(service, collection)
    expect(proposed.status).toBe(200)
    expect(decoded(proposed)).toEqual({ snapshot: before, preview: createOrderSyncPreview(before, collection) })
    expect((await post(service, sync(1))).status).toBe(200)
    const disk = await evidence(directory)
    const command = { ...sync(1), collection }
    const stale = await post(service, command)
    expect(stale.status).toBe(409)
    expect(decoded(stale)).toMatchObject({ error: { code: 'revision_conflict' } })
    expect(await evidence(directory)).toEqual(disk)
    expect((await snapshot(service)).revision).toBe(2)
    const refreshed = await preview(service, collection)
    expect(refreshed.status).toBe(200)
    expect((await post(service, { ...command, expectedRevision: 2 })).status).toBe(200)
    expect((await snapshot(service)).revision).toBe(3)
  })

  it.each(['nested', 'identity', 'lot-reference', 'produced'])('rejects invalid source collections without changing the database: %s', async issue => {
    const { service, directory } = await launch()
    const source = seedOrderCollection()
    const first = source.orders[0]
    if (!first) throw new Error('Expected a source order fixture.')
    const collection = { ...source, orders: [{ ...first,
      ...(issue === 'lot-reference' ? { lotIndexId: 'missing' } : {}),
      aggregate: issue === 'nested' ? { order: { id: first.id } } : { ...first.aggregate, order: {
        ...first.aggregate.order, ...(issue === 'identity' ? { id: 'PO-0000' } : {}), ...(issue === 'produced' ? { produced: 121 } : {}),
      } },
    }] }
    const disk = await evidence(directory)
    const response = await preview(service, collection)
    expect(response.status).toBe(400)
    expect(decoded(response)).toMatchObject({ error: { code: 'invalid_command' } })
    expect(await evidence(directory)).toEqual(disk)
    expect((await snapshot(service)).revision).toBe(0)
  })

  it.each([null, [], {}, { collection: null }, { collection: seedOrderCollection(), requestId: 'unnecessary' }, seedOrderCollection()])('requires exactly the collection envelope: %j', async envelope => {
    const { service, directory } = await launch()
    const disk = await evidence(directory)
    const response = await call(service, previewPath, { body: JSON.stringify(envelope) })
    expect(response.status).toBe(400)
    expect(decoded(response)).toMatchObject({ error: { code: 'invalid_command' } })
    expect(await evidence(directory)).toEqual(disk)
  })

  it.each([{ Origin: undefined }, { Origin: 'https://untrusted.example' }, { Origin: 'null' },
    { Origin: 'http://127.0.0.1:4300' }, { Host: 'untrusted.example' },
    { 'X-FactoryOS-Client': undefined }, { 'X-FactoryOS-Client': 'wrong-client' }])('preserves request boundaries for %j', async headers => {
    const { service, directory } = await launch()
    const disk = await evidence(directory)
    const response = await call(service, previewPath, { body: JSON.stringify({ collection: seedOrderCollection() }), headers })
    expect(response.status).toBe(403)
    expect(decoded(response)).toMatchObject({ error: { code: 'request_not_allowed' } })
    expect(await evidence(directory)).toEqual(disk)
  })

  it('permits POST preflight only and rejects method, path, and query aliases', async () => {
    const { service, directory } = await launch()
    const disk = await evidence(directory)
    const headers = { Origin: 'http://localhost:4304', 'X-FactoryOS-Client': undefined,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-factoryos-client' }
    const allowed = await call(service, previewPath, { method: 'OPTIONS', headers })
    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-methods']).toBe('POST')
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:4304')
    for (const method of ['GET', 'PUT', 'DELETE']) {
      expect((await call(service, previewPath, { method })).status).toBe(405)
      expect((await call(service, previewPath, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': method } })).status).toBe(403)
    }
    expect((await call(service, previewPath, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Headers': 'content-type' } })).status).toBe(403)
    expect((await call(service, previewPath, { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Headers': 'x-factoryos-client,x-extra' } })).status).toBe(403)
    for (const target of [previewPath + '/', previewPath + '?revision=0', '/api/reservations/order-%73ync-preview', '/api/reservations/../reservations/order-sync-preview']) {
      expect((await call(service, target, { body: JSON.stringify({ collection: seedOrderCollection() }) })).status).toBe(404)
    }
    expect((await call(service, '/api/reservations', { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'GET' } })).headers['access-control-allow-methods']).toBe('GET, POST')
    expect(await evidence(directory)).toEqual(disk)
  })

  it('keeps strict UTF-8, JSON, media, encoding, and both declared and streamed size limits', async () => {
    const { service, directory } = await launch()
    const disk = await evidence(directory)
    for (const body of ['{invalid', Buffer.from([0xff])]) expect((await call(service, previewPath, { body })).status).toBe(400)
    expect((await call(service, previewPath, { body: '{}', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    expect((await call(service, previewPath, { body: '{}', headers: { 'Content-Encoding': 'gzip' } })).status).toBe(415)
    const large = 'a'.repeat(2 * 1024 * 1024 + 1)
    expect((await call(service, previewPath, { body: large })).status).toBe(413)
    expect((await call(service, previewPath, { body: large, chunked: true })).status).toBe(413)
    expect(await evidence(directory)).toEqual(disk)
  })

  it('keeps the explicit JSON compatibility engine read-only during preview too', async () => {
    const { service, directory } = await launch('', 'json')
    expect((await post(service, sync())).status).toBe(200)
    const file = path.join(directory, 'reservations.json')
    const before = await fs.readFile(file)
    const collection = createOrder(seedOrderCollection(), 'PO-9900', 'assembly', 'LOT-55')
    expect((await preview(service, collection)).status).toBe(200)
    expect(await fs.readFile(file)).toEqual(before)
    expect((await snapshot(service)).revision).toBe(1)
    await expect(fs.stat(path.join(directory, 'reservations.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
