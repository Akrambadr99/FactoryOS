import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createOrder, seedOrderCollection } from '../src/execution/order-machine/orderCollection'
import { validateReservationSnapshot } from '../src/execution/materials/reservations'
import { startReservationServer, type ReservationServer } from './reservationServer'
import { ReservationStore } from './reservationStore'

const services: ReservationServer[] = []
const legacyStores: ReservationStore[] = []
const directories: { directory: string; parent: string }[] = []

async function temporary() {
  const parent = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(parent, 'factoryos-sqlite-http-'))
  directories.push({ directory, parent })
  return directory
}

afterEach(async () => {
  for (const service of services.splice(0)) await service.close()
  for (const store of legacyStores.splice(0)) await store.close()
  for (const { directory, parent } of directories.splice(0)) {
    const resolved = await fs.realpath(directory)
    expect(resolved).toBe(path.resolve(directory))
    expect(path.dirname(resolved)).toBe(parent)
    expect(path.basename(resolved)).toMatch(/^factoryos-sqlite-http-/)
    await fs.rm(resolved, { recursive: true, force: true })
  }
})

async function launch(directory?: string) {
  const resolved = directory ?? await temporary()
  // Intentionally omit storage: this suite proves the shipped default is SQLite.
  const service = await startReservationServer({ directory: resolved, port: 0 })
  services.push(service)
  return { service, directory: resolved }
}

interface HttpResponse { status: number; text: string; headers: Record<string, string | string[] | undefined> }
function call(service: ReservationServer, target = '/api/reservations', options: {
  method?: string; body?: string | Buffer; headers?: Record<string, string | undefined>; chunked?: boolean
} = {}): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const supplied: Record<string, string | undefined> = {
      Origin: 'http://127.0.0.1:4304', 'X-FactoryOS-Client': 'reservations',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers,
    }
    const headers: Record<string, string | number | undefined> = Object.fromEntries(Object.entries(supplied).filter(([, value]) => value !== undefined))
    if (options.body !== undefined && !options.chunked) headers['Content-Length'] = Buffer.byteLength(options.body)
    const request = httpRequest({ hostname: '127.0.0.1', port: service.port, path: target,
      method: options.method ?? 'GET', headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.on('end', () => { resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers }) })
      response.on('error', reject)
    })
    request.setTimeout(5_000, () => { request.destroy(new Error('The local SQLite HTTP fixture timed out.')) })
    request.on('error', reject)
    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}

function decoded(response: HttpResponse): unknown { return JSON.parse(response.text) as unknown }
const post = (service: ReservationServer, command: unknown) => call(service, '/api/reservations', { method: 'POST', body: JSON.stringify(command) })
const sync = (expectedRevision = 0) => ({ kind: 'sync-orders', requestId: randomUUID(), expectedRevision, collection: seedOrderCollection() })
const reserve = (expectedRevision = 1, orderId = 'PO-8842', quantity = 120) => ({ kind: 'reserve', requestId: randomUUID(),
  expectedRevision, orderId, lotId: 'MAT-ALLOY', quantity, note: 'SQLite production planning hold' })
async function snapshot(service: ReservationServer) {
  const result = await call(service)
  expect(result.status).toBe(200)
  return validateReservationSnapshot(decoded(result))
}

describe('SQLite-default material reservation HTTP service', () => {
  it('creates a real SQLite ledger with explicit demo stock and no JSON ledger', async () => {
    const { service, directory } = await launch()
    const response = await call(service)
    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:4304')
    const state = validateReservationSnapshot(decoded(response))
    expect(state.revision).toBe(0)
    expect(state.orders).toEqual([])
    expect(state.lots.map(lot => lot.demo)).toEqual([true, true, true])
    const database = await fs.readFile(path.join(directory, 'reservations.sqlite'))
    expect(database.subarray(0, 16).toString('ascii')).toBe('SQLite format 3\u0000')
    await expect(fs.stat(path.join(directory, 'reservations.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await post(service, reserve(0))).status).toBe(404)
    expect((await snapshot(service)).revision).toBe(0)
  })

  it('retains reservation and release receipts across restarts without changing the public response contract', async () => {
    const { service, directory } = await launch()
    expect((await post(service, sync())).status).toBe(200)
    const command = reserve()
    const first = await post(service, command)
    expect(first.status).toBe(200)
    expect(decoded(first)).toMatchObject({ replayed: false })
    const saved = await snapshot(service)
    expect(saved.reservations[0]).toMatchObject({ id: command.requestId, quantity: 120, status: 'active' })
    await service.close()
    const restarted = (await launch(directory)).service
    expect(await snapshot(restarted)).toEqual(saved)
    expect(decoded(await post(restarted, command))).toMatchObject({ snapshot: saved, replayed: true })
    const release = { kind: 'release', requestId: randomUUID(), expectedRevision: 2,
      reservationId: command.requestId, reason: 'Production plan changed after restart' }
    expect(decoded(await post(restarted, release))).toMatchObject({ replayed: false })
    const released = await snapshot(restarted)
    expect(released.revision).toBe(3)
    expect(released.reservations[0]).toMatchObject({ status: 'released', releaseReason: release.reason })
    await restarted.close()
    const final = (await launch(directory)).service
    expect(decoded(await post(final, release))).toMatchObject({ snapshot: released, replayed: true })
    expect(await snapshot(final)).toEqual(released)
    await expect(fs.stat(path.join(directory, 'reservations.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('commits one receipt for concurrent identical requests and rejects altered reuse without mutation', async () => {
    const { service } = await launch()
    expect((await post(service, sync())).status).toBe(200)
    const command = reserve()
    const responses = await Promise.all([post(service, command), post(service, command), post(service, command)])
    expect(responses.map(response => response.status)).toEqual([200, 200, 200])
    expect(responses.map(decoded).filter(value => (value as { replayed: boolean }).replayed)).toHaveLength(2)
    const before = await snapshot(service)
    expect(before.revision).toBe(2)
    expect(before.reservations).toHaveLength(1)
    expect(before.events.filter(event => event.requestId === command.requestId)).toHaveLength(1)
    const changed = await post(service, { ...command, note: 'Different request with reused identity' })
    expect(changed.status).toBe(409)
    expect(decoded(changed)).toMatchObject({ error: { code: 'idempotency_conflict' } })
    expect(await snapshot(service)).toEqual(before)
  })

  it('serializes competing revisions and prevents oversubscription after the loser refreshes', async () => {
    const { service } = await launch()
    const collection = createOrder(createOrder(seedOrderCollection(), 'PO-9901', 'assembly', 'LOT-55'), 'PO-9902', 'assembly', 'LOT-55')
    expect((await post(service, { ...sync(), collection })).status).toBe(200)
    expect((await post(service, reserve())).status).toBe(200)
    const commands = [reserve(2, 'PO-9901'), reserve(2, 'PO-9902')]
    const responses = await Promise.all(commands.map(command => post(service, command)))
    expect(responses.map(response => response.status).sort()).toEqual([200, 409])
    const losingIndex = responses.findIndex(response => response.status === 409)
    const loser = commands[losingIndex]
    const conflict = responses[losingIndex]
    if (!loser || !conflict) throw new Error('Expected one competing allocation to lose its revision race.')
    expect(decoded(conflict)).toMatchObject({ error: { code: 'revision_conflict' } })
    const before = await snapshot(service)
    expect(before.revision).toBe(3)
    expect(before.reservations.reduce((units, hold) => units + hold.quantity, 0)).toBe(240)
    const exhausted = await post(service, { ...loser, requestId: randomUUID(), expectedRevision: 3 })
    expect(exhausted.status).toBe(409)
    expect(decoded(exhausted)).toMatchObject({ error: { code: 'insufficient_stock' } })
    expect(await snapshot(service)).toEqual(before)
  })

  it('rejects invalid nested order data without consuming the command identity or changing the ledger', async () => {
    const { service } = await launch()
    const command = sync()
    const collection = { ...command.collection, orders: command.collection.orders.map((order, index) => index ? order : { ...order, lotIndexId: 'MISSING' }) }
    expect((await post(service, { ...command, collection })).status).toBe(400)
    expect((await snapshot(service)).revision).toBe(0)
    expect(decoded(await post(service, command))).toMatchObject({ replayed: false })
    expect((await snapshot(service)).revision).toBe(1)
  })

  it.each([
    { Origin: undefined }, { Origin: 'https://untrusted.example' }, { Origin: 'null' },
    { Origin: 'http://127.0.0.1:4300' }, { Host: 'untrusted.example' },
    { 'X-FactoryOS-Client': undefined }, { 'X-FactoryOS-Client': 'wrong-client' },
  ])('keeps the configured request boundary unchanged for %j', async headers => {
    const { service } = await launch()
    const rejected = await call(service, '/api/reservations', { method: 'POST', body: JSON.stringify(sync()), headers })
    expect(rejected.status).toBe(403)
    expect(decoded(rejected)).toMatchObject({ error: { code: 'request_not_allowed' } })
    expect((await snapshot(service)).revision).toBe(0)
  })

  it('answers only approved preflight, routes and methods without exposing database paths', async () => {
    const { service } = await launch()
    const preflight = await call(service, '/api/reservations', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:4304', 'X-FactoryOS-Client': undefined,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-factoryos-client',
    } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:4304')
    expect((await call(service, '/api/reservations', { method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'x-factoryos-client',
    } })).status).toBe(403)
    for (const target of ['/api/reservations/../reservations', '/api/%72eservations', '/api/reservations?file=../secret', '/reservations.sqlite', '/reservations.json']) {
      expect((await call(service, target)).status).toBe(404)
    }
    expect((await call(service, '/api/reservations', { method: 'DELETE' })).status).toBe(405)
    expect((await snapshot(service)).revision).toBe(0)
  })

  it('rejects malformed, encoded and oversized requests before persisting anything', async () => {
    const { service } = await launch()
    for (const body of ['{invalid', Buffer.from([0xff])]) {
      expect((await call(service, '/api/reservations', { method: 'POST', body })).status).toBe(400)
    }
    expect((await call(service, '/api/reservations', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    expect((await call(service, '/api/reservations', { method: 'POST', body: '{}', headers: { 'Content-Encoding': 'gzip' } })).status).toBe(415)
    const large = 'a'.repeat(2 * 1024 * 1024 + 1)
    expect((await call(service, '/api/reservations', { method: 'POST', body: large })).status).toBe(413)
    expect((await call(service, '/api/reservations', { method: 'POST', body: large, chunked: true })).status).toBe(413)
    expect((await snapshot(service)).revision).toBe(0)
  })

  it('requires explicit migration for a genuine legacy ledger and preserves exact source evidence', async () => {
    const directory = await temporary()
    const legacy = new ReservationStore(directory)
    legacyStores.push(legacy)
    await legacy.open()
    await legacy.execute(sync())
    await legacy.execute(reserve())
    await legacy.close()
    const file = path.join(directory, 'reservations.json')
    const before = await fs.readFile(file)
    const entries = (await fs.readdir(directory)).sort()
    await expect(startReservationServer({ directory, port: 0 })).rejects.toMatchObject({ code: 'migration_required' })
    expect(await fs.readFile(file)).toEqual(before)
    expect((await fs.readdir(directory)).sort()).toEqual(entries)
    await expect(fs.stat(path.join(directory, 'reservations.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(directory, '.reservations.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
