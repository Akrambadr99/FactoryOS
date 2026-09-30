import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { createOrder, seedOrderCollection } from '../src/execution/order-machine/orderCollection'
import { applyReservationCommand, createReservationState, validateReservationState, type ReservationState } from '../src/execution/materials/reservations'
import { ReservationDatabase } from './reservationDatabase'

const temporary: { directory: string; parent: string }[] = []
const connections: { close(): void }[] = []
afterEach(async () => {
  for (const connection of connections.splice(0).reverse()) connection.close()
  for (const { directory, parent } of temporary.splice(0)) {
    const resolved = await fs.realpath(directory)
    expect(resolved).toBe(path.resolve(directory)); expect(path.dirname(resolved)).toBe(parent)
    expect(path.basename(resolved)).toMatch(/^factoryos-sqlite-/)
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
async function file() {
  const parent = await fs.realpath(os.tmpdir()), directory = await fs.mkdtemp(path.join(parent, 'factoryos-sqlite-'))
  temporary.push({ parent, directory })
  const target = path.join(directory, 'reservations.sqlite')
  const reserved = await fs.open(target, 'wx', 0o600); await reserved.close()
  return target
}
function open(target: string, options: ConstructorParameters<typeof ReservationDatabase>[1] = {}) {
  const database = new ReservationDatabase(target, options); connections.push(database); return database
}
function raw(target: string) { const database = new Database(target); connections.push(database); return database }
const sync = (expectedRevision = 0) => ({ kind: 'sync-orders', requestId: randomUUID(), expectedRevision, collection: seedOrderCollection() })
const reserve = (expectedRevision = 1, quantity = 120, orderId = 'PO-8842') => ({ kind: 'reserve', requestId: randomUUID(), expectedRevision,
  orderId, lotId: 'MAT-ALLOY', quantity, note: 'Production planning hold' })

describe('relational reservation persistence', () => {
  it('creates only an explicitly reserved empty file and defaults to opening existing verified data', async () => {
    const target = await file()
    expect(() => open(target)).toThrow('could not be verified')
    expect(() => open(path.join(path.dirname(target), 'missing.sqlite'), { create: true })).toThrow('could not be verified')
    const database = open(target, { create: true })
    expect(database.readState()).toEqual(createReservationState())
    expect(database.migrationReceipt()).toBeNull()
    expect(() => open(target, { create: true })).toThrow('could not be verified')
    expect((await fs.readFile(target)).subarray(0, 16).toString()).toBe('SQLite format 3\0')
    const inspect = raw(target)
    expect(inspect.pragma('user_version', { simple: true })).toBe(1)
    expect(inspect.pragma('application_id', { simple: true })).toBe(0x464f5352)
    expect(inspect.pragma('journal_mode', { simple: true })).toBe('delete')
  })

  it('atomically persists normalized rows and replays the original request after restart', async () => {
    const target = await file(), database = open(target, { create: true })
    database.execute(sync())
    const command = reserve(), saved = database.execute(command)
    expect(saved.replayed).toBe(false)
    const state = database.readState(); database.close()
    const reopened = open(target)
    expect(reopened.readState()).toEqual(state)
    expect(reopened.execute(command)).toEqual({ snapshot: saved.snapshot, replayed: true })
    const inspect = raw(target)
    expect(inspect.prepare('SELECT count(*) AS count FROM reservations').get()).toEqual({ count: 1 })
    expect(inspect.prepare('SELECT count(*) AS count FROM receipts').get()).toEqual({ count: 2 })
    expect(inspect.prepare('SELECT status, quantity FROM reservations').get()).toEqual({ status: 'active', quantity: 120 })
  })

  it('keeps competing connections from stale writes and does not duplicate or oversubscribe holds', async () => {
    const target = await file(), first = open(target, { create: true }), second = open(target)
    const collection = createOrder(seedOrderCollection(), 'PO-9901', 'assembly', 'LOT-55')
    first.execute({ ...sync(), collection })
    const command = reserve(1, 200)
    first.execute(command)
    expect(second.execute(command).replayed).toBe(true)
    expect(() => second.execute(reserve(1, 60, 'PO-9901'))).toThrow('workspace changed')
    expect(() => second.execute(reserve(2, 60, 'PO-9901'))).toThrow('not enough')
    expect(() => second.execute({ ...command, quantity: 10 })).toThrow('different change')
    expect(first.readState().revision).toBe(2)
    expect(second.readState().reservations).toHaveLength(1)
  })

  it('retains historical removed-order references and original UTF-16 payloads', async () => {
    const target = await file(), database = open(target, { create: true })
    const source = seedOrderCollection(), orderId = 'Historical-\ud800-order'
    const collection = { ...source, orders: source.orders.map(order => order.id === 'PO-8842'
      ? { ...order, id: orderId, aggregate: { ...order.aggregate, order: { ...order.aggregate.order, id: orderId } } } : order) }
    database.execute({ ...sync(), collection })
    const command = { ...reserve(1, 20, orderId), note: 'Lone surrogate \ud800 stays intact' }
    database.execute(command)
    database.execute({ kind: 'release', requestId: randomUUID(), expectedRevision: 2, reservationId: command.requestId, reason: 'Released \ud800 safely' })
    database.execute({ ...sync(3), collection: { ...collection, orders: collection.orders.filter(order => order.id !== orderId) } })
    const state = database.readState(); database.close()
    expect(open(target).readState()).toEqual(state)
    expect(state.orders.some(order => order.id === orderId)).toBe(false)
    expect(state.reservations[0]).toMatchObject({ orderId, note: command.note, status: 'released', releaseReason: 'Released \ud800 safely' })
  })

  it('imports a fully verified legacy state and its source receipt in one transaction', async () => {
    const state = applyReservationCommand(createReservationState(), sync()).state
    const initial = applyReservationCommand(state, reserve()).state
    const target = await file(), receipt = { sourceChecksum: 'a'.repeat(64), sourceBytes: 4200 }
    const database = open(target, { create: true, initialState: initial, migration: receipt })
    expect(database.readState()).toEqual(initial); expect(database.migrationReceipt()).toEqual(receipt)
    database.close(); expect(open(target).migrationReceipt()).toEqual(receipt)
  })

  it('rejects malformed import state or migration metadata before initializing the reserved file', async () => {
    const target = await file()
    expect(() => open(target, { create: true, initialState: { ...createReservationState(), revision: 4 } })).toThrow('could not be verified')
    expect(() => open(target, { create: true, migration: { sourceChecksum: 'wrong', sourceBytes: 1 } })).toThrow('could not be verified')
    expect((await fs.stat(target)).size).toBe(0)
  })

  it.each(['future-version', 'foreign-application', 'unknown-schema', 'corrupt-file'] as const)('fails closed for %s without replacing data', async condition => {
    const target = await file(), database = open(target, { create: true }); database.close()
    if (condition === 'corrupt-file') await fs.writeFile(target, 'not a database; preserve this evidence')
    else {
      const writer = raw(target)
      if (condition === 'future-version') writer.pragma('user_version = 2')
      if (condition === 'foreign-application') writer.pragma('application_id = 123')
      if (condition === 'unknown-schema') writer.exec('CREATE TABLE unrelated (id INTEGER)')
      writer.close()
    }
    const bytes = await fs.readFile(target)
    expect(() => open(target)).toThrow('could not be verified')
    expect(await fs.readFile(target)).toEqual(bytes)
  })

  it('rejects an existing WAL-format database without changing its header or creating sidecars', async () => {
    const target = await file(), database = open(target, { create: true }); database.close()
    const writer = raw(target)
    expect(writer.pragma('journal_mode = WAL', { simple: true })).toBe('wal')
    writer.close()
    const before = await fs.readFile(target), directory = path.dirname(target)
    const listing = (await fs.readdir(directory)).sort()
    expect([...before.subarray(18, 20)]).toEqual([2, 2])
    expect(listing).toEqual(['reservations.sqlite'])
    expect(() => open(target)).toThrow('could not be verified')
    expect(await fs.readFile(target)).toEqual(before)
    expect((await fs.readdir(directory)).sort()).toEqual(listing)
  })

  it('rejects inconsistent source payloads and receipts instead of reconstructing over corrupt stored rows', async () => {
    const target = await file(), database = open(target, { create: true })
    database.execute(sync()); database.execute(reserve())
    const writer = raw(target)
    writer.prepare("UPDATE reservations SET payload = json_set(payload, '$.note', 'unexpected mutation')").run()
    expect(() => database.readState()).toThrow('could not be verified')
    expect(() => database.execute(sync(2))).toThrow('could not be verified')
    database.close(); expect(() => open(target)).toThrow('could not be verified')
  })

  it('rolls back a real SQLite failure after hold and event writes and permits a safe retry', async () => {
    const target = await file(), database = open(target, { create: true })
    database.execute(sync())
    const before = database.readState(), writer = raw(target), command = reserve()
    // Installed only after startup's exact schema audit, through an independent
    // connection; SQLite itself aborts late in the write transaction.
    writer.exec("CREATE TRIGGER injected_disk_fault BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'private-path-do-not-expose'); END")
    expect(() => database.execute(command)).toThrow('could not complete')
    expect(() => database.execute(command)).not.toThrow('private-path-do-not-expose')
    expect(database.readState()).toEqual(before)
    expect(writer.prepare('SELECT count(*) AS count FROM reservations').get()).toEqual({ count: 0 })
    expect(writer.prepare('SELECT count(*) AS count FROM events').get()).toEqual({ count: 1 })
    writer.exec('DROP TRIGGER injected_disk_fault')
    expect(database.execute(command).replayed).toBe(false)
    expect(database.execute(command).replayed).toBe(true)
  })

  it('enforces the unique active order/lot SQL constraint independently of domain validation', async () => {
    const target = await file(), database = open(target, { create: true })
    database.execute(sync()); database.execute(reserve())
    const writer = raw(target), source = database.readState().reservations[0]
    if (!source) throw new Error('Missing fixture hold.')
    const duplicate = { ...source, id: randomUUID(), createdRevision: 3 }
    expect(() => writer.prepare('INSERT INTO reservations (id_key, order_key, lot_key, position, payload) VALUES (?, ?, ?, ?, ?)')
      .run(JSON.stringify(duplicate.id), JSON.stringify(duplicate.orderId), JSON.stringify(duplicate.lotId), 1, JSON.stringify(duplicate))).toThrow('UNIQUE')
    expect(database.readState().reservations).toHaveLength(1)
  })

  it('rejects imports over the existing logical payload bound without writing the empty candidate', async () => {
    const source = applyReservationCommand(createReservationState(), sync()).state
    const first = source.orders[0]
    if (!first) throw new Error('Missing fixture order.')
    const orders = Array.from({ length: 1000 }, (_, index) => ({ ...first, id: 'PO-' + String(index).padStart(117, '0') }))
    const receipts = Array.from({ length: 90 }, (_, index) => {
      const requestId = randomUUID()
      return { requestId, revision: index + 1, fingerprint: JSON.stringify({ kind: 'sync-orders', requestId, expectedRevision: index, orders }) }
    })
    const initial: ReservationState = { ...createReservationState(), revision: receipts.length, orders, receipts,
      events: receipts.map(receipt => ({ sequence: receipt.revision, requestId: receipt.requestId, kind: 'sync-orders', orderId: null,
        reservationId: null, summary: 'Production-order references imported.' })) }
    expect(() => validateReservationState(initial)).not.toThrow()
    const target = await file()
    expect(() => open(target, { create: true, initialState: initial })).toThrow('supported size')
    expect((await fs.stat(target)).size).toBe(0)
  })

  it('rejects a full-history sync but preserves enough logical space to release an existing hold', async () => {
    const source = seedOrderCollection(), first = source.orders[0]
    if (!first) throw new Error('Missing fixture order.')
    const collection = { ...source, orders: Array.from({ length: 1000 }, (_, index) => {
      const id = 'PO-' + String(index).padStart(117, '0')
      return { ...first, id, aggregate: { ...first.aggregate, order: { ...first.aggregate.order, id } } }
    }) }
    const synced = applyReservationCommand(createReservationState(), { ...sync(), collection }).state
    const selected = collection.orders[0]
    if (!selected) throw new Error('Missing expanded fixture order.')
    const command = reserve(1, 1, selected.id)
    let initial = applyReservationCommand(synced, command).state
    const logicalBytes = (state: ReservationState) => Buffer.byteLength(JSON.stringify({
      format: 'factoryos-material-ledger', version: 1, checksum: '0'.repeat(64), state,
    }))
    for (let attempt = 0; attempt < 100; attempt++) {
      const requestId = randomUUID(), revision = initial.revision + 1
      const next: ReservationState = { ...initial, revision,
        events: [...initial.events, { sequence: revision, requestId, kind: 'sync-orders', orderId: null,
          reservationId: null, summary: 'Production-order references imported.' }],
        receipts: [...initial.receipts, { requestId, revision, fingerprint: JSON.stringify({ kind: 'sync-orders', requestId,
          expectedRevision: initial.revision, orders: initial.orders }) }] }
      if (logicalBytes(next) + 8 * 1024 > 16 * 1024 * 1024) break
      initial = next
    }
    const target = await file(), database = open(target, { create: true, initialState: initial })
    expect(() => database.execute({ ...sync(initial.revision), collection })).toThrow('supported size')
    expect(database.readState()).toEqual(initial)
    const result = database.execute({ kind: 'release', requestId: randomUUID(), expectedRevision: initial.revision,
      reservationId: command.requestId, reason: '\ud800'.repeat(240) })
    expect(result.snapshot.reservations[0]?.status).toBe('released')
    const persisted = database.readState()
    expect(logicalBytes(persisted) - logicalBytes(initial)).toBeLessThan(8 * 1024)
    expect(logicalBytes(persisted)).toBeLessThanOrEqual(16 * 1024 * 1024)
    database.close(); expect(open(target).readState()).toEqual(persisted)
  }, 30000)
})
