import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrder, seedOrderCollection } from '../src/execution/order-machine/orderCollection'
import { validateReservationSnapshot } from '../src/execution/materials/reservations'
import { startReservationServer, type ReservationServer } from './reservationServer'
import { ReservationStore } from './reservationStore'

const services: ReservationServer[] = [], directories: { directory: string; parent: string }[] = []
const stores: ReservationStore[] = []
async function temporary() {
  const parent = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(path.join(parent, 'factoryos-reservations-'))
  directories.push({ directory, parent }); return directory
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const service of services.splice(0)) await service.close()
  for (const store of stores.splice(0)) await store.close()
  for (const { directory, parent } of directories.splice(0)) {
    const resolved = await fs.realpath(directory)
    expect(resolved).toBe(path.resolve(directory)); expect(path.dirname(resolved)).toBe(parent)
    expect(path.basename(resolved)).toMatch(/^factoryos-reservations-/)
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
async function launch(directory?: string) {
  const resolved = directory ?? await temporary()
  const service = await startReservationServer({ directory: resolved, port: 0 })
  services.push(service); return { service, directory: resolved }
}
interface Response { status: number; text: string; headers: Record<string, string | string[] | undefined> }
function call(service: ReservationServer, target = '/api/reservations', options: {
  method?: string; body?: string | Buffer; headers?: Record<string, string | undefined>; chunked?: boolean
} = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const suppliedHeaders: Record<string, string | undefined> = {
      Origin: 'http://127.0.0.1:4304', 'X-FactoryOS-Client': 'reservations',
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers,
    }
    const headers: Record<string, string | number | undefined> = Object.fromEntries(Object.entries(suppliedHeaders).filter(([, value]) => value !== undefined))
    if (options.body !== undefined && !options.chunked) headers['Content-Length'] = Buffer.byteLength(options.body)
    const request = httpRequest({ hostname: '127.0.0.1', port: service.port, path: target,
      method: options.method ?? 'GET', headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      response.on('end', () => { resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: response.headers }) })
    })
    request.on('error', reject)
    if (options.body !== undefined) request.write(options.body)
    request.end()
  })
}
function decoded(response: Response): unknown { return JSON.parse(response.text) as unknown }
const post = (service: ReservationServer, command: unknown) => call(service, '/api/reservations', { method: 'POST', body: JSON.stringify(command) })
const sync = (expectedRevision = 0) => ({ kind: 'sync-orders', requestId: randomUUID(), expectedRevision, collection: seedOrderCollection() })
const reserve = (expectedRevision = 1, orderId = 'PO-8842', quantity = 120) => ({ kind: 'reserve', requestId: randomUUID(),
  expectedRevision, orderId, lotId: 'MAT-ALLOY', quantity, note: 'Production planning hold' })

describe('durable local material reservations', () => {
  it('starts with explicit demo stock, no orders, and does not accept a reservation before synchronization', async () => {
    const { service, directory } = await launch()
    const result = await call(service)
    expect(result.status).toBe(200)
    const state = validateReservationSnapshot(decoded(result))
    expect(state.orders).toEqual([]); expect(state.revision).toBe(0)
    expect(result.headers['cache-control']).toBe('no-store')
    expect((await post(service, reserve(0))).status).not.toBe(200)
    expect((await fs.readdir(directory)).sort()).toEqual(['.reservations.lock', 'reservations.json'])
  })

  it('persists synchronized orders and reservations across a server restart', async () => {
    const { service, directory } = await launch()
    expect((await post(service, sync())).status).toBe(200)
    const command = reserve()
    const first = await post(service, command)
    expect(first.status).toBe(200); expect(decoded(first)).toMatchObject({ replayed: false })
    const before = await call(service)
    await service.close()
    const restarted = await launch(directory)
    expect((await call(restarted.service)).text).toBe(before.text)
    expect(decoded(await post(restarted.service, command))).toMatchObject({ replayed: true })
    expect((await call(restarted.service)).text).toBe(before.text)
  })

  it('deduplicates concurrent retries into one persisted reservation and rejects changed reuse', async () => {
    const { service } = await launch()
    await post(service, sync())
    const command = reserve()
    const replies = await Promise.all([post(service, command), post(service, command), post(service, command)])
    expect(replies.every(result => result.status === 200)).toBe(true)
    expect(replies.map(decoded).filter(value => (value as { replayed: boolean }).replayed)).toHaveLength(2)
    const state = validateReservationSnapshot(decoded(await call(service)))
    expect(state.revision).toBe(2); expect(state.reservations).toHaveLength(1)
    const conflict = await post(service, { ...command, quantity: 119 })
    expect(conflict.status).toBe(409)
    expect(decoded(conflict)).toMatchObject({ error: { code: 'idempotency_conflict' } })
  })

  it('serializes competing allocations and refuses oversubscription after refresh', async () => {
    const { service } = await launch()
    let collection = createOrder(seedOrderCollection(), 'PO-9901', 'assembly', 'LOT-55')
    collection = createOrder(collection, 'PO-9902', 'assembly', 'LOT-55')
    expect((await post(service, { ...sync(), collection })).status).toBe(200)
    expect((await post(service, reserve(1))).status).toBe(200)
    const outcomes = await Promise.all([post(service, reserve(2, 'PO-9901')), post(service, reserve(2, 'PO-9902'))])
    expect(outcomes.map(result => result.status).sort()).toEqual([200, 409])
    const losingIndex = outcomes.findIndex(result => result.status === 409)
    const loser = losingIndex === 0 ? 'PO-9901' : 'PO-9902'
    const exhausted = await post(service, reserve(3, loser))
    expect(exhausted.status).toBe(409)
    expect(decoded(exhausted)).toMatchObject({ error: { code: 'insufficient_stock' } })
    const state = validateReservationSnapshot(decoded(await call(service)))
    expect(state.revision).toBe(3); expect(state.reservations).toHaveLength(2)
  })

  it('validates nested order/lot relationships before persisting catalog changes', async () => {
    const { service } = await launch()
    const collection = seedOrderCollection()
    const invalid = { ...collection, orders: collection.orders.map((order, index) => index ? order : { ...order, lotIndexId: 'MISSING' }) }
    const response = await post(service, { ...sync(), collection: invalid })
    expect(response.status).toBe(400)
    expect(validateReservationSnapshot(decoded(await call(service))).revision).toBe(0)
  })

  it('releases allocated stock once and retains the release receipt for safe retries', async () => {
    const { service } = await launch()
    await post(service, sync()); await post(service, reserve())
    const before = validateReservationSnapshot(decoded(await call(service)))
    const reservationId = before.reservations[0]?.id
    if (!reservationId) throw new Error('The fixture reservation was not created.')
    const command = { kind: 'release', requestId: randomUUID(), expectedRevision: 2,
      reservationId, reason: 'Production planning hold cancelled' }
    expect(decoded(await post(service, command))).toMatchObject({ replayed: false })
    expect(decoded(await post(service, command))).toMatchObject({ replayed: true })
    const after = validateReservationSnapshot(decoded(await call(service)))
    expect(after.revision).toBe(3)
    expect(after.reservations[0]?.status).toBe('released')
    expect((await post(service, reserve(3))).status).toBe(200)
  })

  it('waits for an in-flight durable write before shutdown releases the process lock', async () => {
    const { service, directory } = await launch()
    await post(service, sync())
    const rename = fs.rename
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const fault = vi.spyOn(fs, 'rename').mockImplementationOnce(async (source, destination) => { await gate; await rename(source, destination) })
    const command = reserve(), pending = post(service, command).catch(() => null)
    await vi.waitFor(() => { expect(fault).toHaveBeenCalledOnce() })
    const shutdown = service.close()
    let closed = false
    void shutdown.then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    if (!release) throw new Error('The fixture write gate was not created.')
    release(); await shutdown; await pending; fault.mockRestore()
    const restarted = await launch(directory)
    expect(decoded(await post(restarted.service, command))).toMatchObject({ replayed: true })
  })

  it('holds an exclusive process lock and releases it on orderly shutdown', async () => {
    const { service, directory } = await launch()
    await expect(startReservationServer({ directory, port: 0 })).rejects.toThrow('Another process owns')
    await service.close()
    await expect(fs.stat(path.join(directory, '.reservations.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await call((await launch(directory)).service)).status).toBe(200)
  })

  it('keeps the prior ledger and receipt set intact when atomic publication fails', async () => {
    const { service, directory } = await launch()
    await post(service, sync())
    const ledger = path.join(directory, 'reservations.json'), before = await fs.readFile(ledger, 'utf8')
    const command = reserve()
    const fault = vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('private-filesystem-path'), { code: 'EACCES' }))
    const failed = await post(service, command)
    expect(failed.status).toBe(503); expect(failed.text).not.toContain('private-filesystem-path')
    expect(await fs.readFile(ledger, 'utf8')).toBe(before)
    expect((await fs.readdir(directory)).some(name => name.endsWith('.pending'))).toBe(false)
    fault.mockRestore()
    expect(decoded(await post(service, command))).toMatchObject({ replayed: false })
    expect(decoded(await post(service, command))).toMatchObject({ replayed: true })
  })

  it('reserves durable byte headroom so full sync history cannot trap an active hold', async () => {
    const directory = await temporary(), maximum = 20 * 1024
    const store = new ReservationStore(directory, { maxLedgerBytes: maximum }); stores.push(store)
    await store.open()
    // Lone surrogate code units exercise JSON's six-byte escaping and the
    // additional escaping inside the private receipt fingerprint string.
    const orderId = '\ud800'.repeat(120), reason = '\ud800'.repeat(240)
    const source = seedOrderCollection()
    const collection = { ...source, orders: source.orders.map(order => order.id === 'PO-8842'
      ? { ...order, id: orderId, aggregate: { ...order.aggregate, order: { ...order.aggregate.order, id: orderId } } } : order) }
    await store.execute({ ...sync(), collection })
    const command = { ...reserve(1, orderId), note: reason }
    await store.execute(command)
    const file = path.join(directory, 'reservations.json')
    const beforeSecondHold = await fs.readFile(file, 'utf8')
    await expect(store.execute({ ...reserve(2, orderId), lotId: 'MAT-FASTENER' })).rejects.toMatchObject({ code: 'ledger_full' })
    expect(await fs.readFile(file, 'utf8')).toBe(beforeSecondHold)
    let reachedLimit = false
    for (let attempt = 0; attempt < 50; attempt++) {
      const snapshot = await store.snapshot()
      try { await store.execute({ ...sync(snapshot.revision), collection }) }
      catch (error) { expect(error).toMatchObject({ code: 'ledger_full' }); reachedLimit = true; break }
    }
    expect(reachedLimit).toBe(true)
    const beforeRelease = await fs.stat(file), snapshot = await store.snapshot()
    expect(beforeRelease.size + 8 * 1024).toBeLessThanOrEqual(maximum)
    const released = await store.execute({ kind: 'release', requestId: randomUUID(), expectedRevision: snapshot.revision,
      reservationId: command.requestId, reason })
    expect(released.snapshot.reservations[0]?.status).toBe('released')
    const afterRelease = await fs.stat(file)
    expect(afterRelease.size - beforeRelease.size).toBeGreaterThan(0)
    expect(afterRelease.size - beforeRelease.size).toBeLessThan(8 * 1024)
    expect(afterRelease.size).toBeLessThanOrEqual(maximum)
  })

  it('fails closed for corruption both while running and on restart without resetting data', async () => {
    const { service, directory } = await launch(), file = path.join(directory, 'reservations.json')
    await fs.writeFile(file, '{corrupt', 'utf8')
    expect((await call(service)).status).toBe(503)
    expect((await post(service, sync())).status).toBe(503)
    await service.close()
    await expect(startReservationServer({ directory, port: 0 })).rejects.toThrow('could not be verified')
    expect(await fs.readFile(file, 'utf8')).toBe('{corrupt')
    await expect(fs.stat(path.join(directory, '.reservations.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('detects altered integrity metadata and retains interrupted write evidence', async () => {
    const { service, directory } = await launch(), file = path.join(directory, 'reservations.json')
    const contents: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    const altered = { ...(contents as Record<string, unknown>), checksum: createHash('sha256').update('changed').digest('hex') }
    await fs.writeFile(file, JSON.stringify(altered), 'utf8')
    expect((await call(service)).status).toBe(503)
    await service.close()
    const pending = path.join(directory, 'reservations.' + randomUUID() + '.pending')
    await fs.writeFile(pending, 'interrupted candidate', 'utf8')
    await expect(startReservationServer({ directory, port: 0 })).rejects.toThrow('interrupted')
    expect(await fs.readFile(pending, 'utf8')).toBe('interrupted candidate')
  })

  it.each([
    { Origin: undefined }, { Origin: 'https://untrusted.example' }, { Origin: 'null' },
    { Origin: 'http://127.0.0.1:4300' }, { Host: 'untrusted.example' },
    { 'X-FactoryOS-Client': undefined }, { 'X-FactoryOS-Client': 'wrong-client' },
  ])('rejects an invalid browser request boundary %j', async headers => {
    const { service } = await launch()
    expect((await call(service, '/api/reservations', { headers })).status).toBe(403)
  })

  it('answers only the configured browser preflight', async () => {
    const { service } = await launch()
    const accepted = await call(service, '/api/reservations', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:4304', 'X-FactoryOS-Client': undefined,
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-factoryos-client',
    } })
    expect(accepted.status).toBe(204)
    expect(accepted.headers['access-control-allow-origin']).toBe('http://localhost:4304')
    expect((await call(service, '/api/reservations', { method: 'OPTIONS', headers: {
      'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'x-factoryos-client',
    } })).status).toBe(403)
  })

  it('rejects malformed JSON, invalid UTF-8, wrong media types and oversized streaming bodies', async () => {
    const { service } = await launch()
    for (const invalid of ['{invalid', Buffer.from([0xff])]) {
      expect((await call(service, '/api/reservations', { method: 'POST', body: invalid })).status).toBe(400)
    }
    expect((await call(service, '/api/reservations', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status).toBe(415)
    const large = 'a'.repeat(2 * 1024 * 1024 + 1)
    expect((await call(service, '/api/reservations', { method: 'POST', body: large })).status).toBe(413)
    expect((await call(service, '/api/reservations', { method: 'POST', body: large, chunked: true })).status).toBe(413)
    expect((await call(service)).status).toBe(200)
  })

  it('never normalizes traversal into an allowed route or offers filesystem endpoints', async () => {
    const { service } = await launch()
    for (const target of ['/api/reservations/../reservations', '/api/%72eservations', '/api/reservations?file=../secret', '/reservations.json']) {
      expect((await call(service, target)).status).toBe(404)
    }
    expect((await call(service, '/api/reservations', { method: 'DELETE' })).status).toBe(405)
  })
})
