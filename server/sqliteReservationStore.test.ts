import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedOrderCollection } from '../src/execution/order-machine/orderCollection'
import { applyReservationCommand, createReservationState, reservationSnapshot } from '../src/execution/materials/reservations'
import type { ReservationState } from '../src/execution/materials/reservations'
import { ReservationStore } from './reservationStore'
import { ReservationDatabase } from './reservationDatabase'
import { migrateReservationLedger, previewReservationMigration, SQLiteReservationStore } from './sqliteReservationStore'

const directories: string[] = []
const stores: (SQLiteReservationStore | ReservationStore)[] = []
const checksum = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const sync = { kind: 'sync-orders', requestId: '00000000-0000-4000-8000-000000000001', expectedRevision: 0, collection: seedOrderCollection() }
const hold = { kind: 'reserve', requestId: '00000000-0000-4000-8000-000000000002', expectedRevision: 1,
  orderId: 'PO-8842', lotId: 'MAT-ALLOY', quantity: 120, note: 'Reserve for scheduled production' }
const release = { kind: 'release', requestId: '00000000-0000-4000-8000-000000000003', expectedRevision: 2,
  reservationId: hold.requestId, reason: 'Production schedule was cancelled' }
async function temporary() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'factoryos-sqlite-store-'))
  directories.push(directory)
  return directory
}
async function legacy(directory: string) {
  const store = new ReservationStore(directory)
  stores.push(store)
  await store.open()
  await store.execute(sync)
  await store.execute(hold)
  await store.close()
  return fs.readFile(path.join(directory, 'reservations.json'))
}
function sqlite(directory: string) {
  const store = new SQLiteReservationStore(directory)
  stores.push(store)
  return store
}
function envelope(state: ReservationState) {
  return JSON.stringify({ format: 'factoryos-material-ledger', version: 1, checksum: checksum(JSON.stringify(state)), state })
}
afterEach(async () => {
  vi.restoreAllMocks()
  for (const store of stores.splice(0).reverse()) await store.close().catch(() => undefined)
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

describe('SQLite directory lifecycle', () => {
  it('initializes an empty directory, persists commands, and replays after restart', async () => {
    const directory = await temporary()
    const first = sqlite(directory)
    await first.open()
    expect(await first.snapshot()).toEqual(reservationSnapshot(createReservationState()))
    await first.execute(sync)
    await first.execute(hold)
    await first.close()
    expect((await fs.readdir(directory)).sort()).toEqual(['reservations.sqlite'])
    const second = sqlite(directory)
    await second.open()
    const replay = await second.execute(hold)
    expect(replay.replayed).toBe(true)
    expect(replay.snapshot).toMatchObject({ revision: 2 })
    await second.execute(release)
    await second.close()
    const third = sqlite(directory)
    await third.open()
    expect((await third.snapshot()).reservations[0]).toMatchObject({ status: 'released', releaseReason: release.reason })
  })

  it('rejects legacy startup before creating any SQLite file and preserves exact source bytes', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'migration_required' })
    expect(await fs.readdir(directory)).toEqual(['reservations.json'])
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(before)
  })

  it('shares the exclusive legacy lock and never removes another owner token', async () => {
    const directory = await temporary()
    const old = new ReservationStore(directory)
    stores.push(old)
    await old.open()
    const token = await fs.readFile(path.join(directory, '.reservations.lock'))
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'ledger_locked' })
    await expect(previewReservationMigration(directory)).rejects.toMatchObject({ code: 'ledger_locked' })
    await expect(migrateReservationLedger(directory, 'a'.repeat(64))).rejects.toMatchObject({ code: 'ledger_locked' })
    expect(await fs.readFile(path.join(directory, '.reservations.lock'))).toEqual(token)
  })

  it.each(['', 'not a SQLite database'])('does not reseed an existing damaged database', async contents => {
    const directory = await temporary()
    const file = path.join(directory, 'reservations.sqlite')
    await fs.writeFile(file, contents)
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'ledger_invalid' })
    expect(await fs.readFile(file, 'utf8')).toBe(contents)
    expect(await fs.readdir(directory)).toEqual(['reservations.sqlite'])
  })

  it.each(['reservations.00000000-0000-4000-8000-000000000001.pending',
    'reservations.00000000-0000-4000-8000-000000000001.sqlite.pending',
    'reservations.00000000-0000-4000-8000-000000000001.sqlite.pending-journal',
    'reservations.sqlite-wal', 'reservations.sqlite-shm', 'reservations.sqlite-journal',
    'RESERVATIONS.00000000-0000-4000-8000-000000000001.SQLITE.PENDING',
    'RESERVATIONS.00000000-0000-4000-8000-000000000001.PENDING',
    'RESERVATIONS.SQLITE-WAL', 'RESERVATIONS.SQLITE-SHM', 'RESERVATIONS.SQLITE-JOURNAL'])('preserves interrupted-operation evidence: %s', async artifact => {
    const directory = await temporary()
    await fs.writeFile(path.join(directory, artifact), 'recovery evidence')
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'recovery_required' })
    await expect(previewReservationMigration(directory)).rejects.toMatchObject({ code: 'recovery_required' })
    await expect(migrateReservationLedger(directory, 'a'.repeat(64))).rejects.toMatchObject({ code: 'recovery_required' })
    expect(await fs.readdir(directory)).toEqual([artifact])
    expect(await fs.readFile(path.join(directory, artifact), 'utf8')).toBe('recovery evidence')
  })

  it.each(['RESERVATIONS.SQLITE', 'Reservations.sqlite', 'RESERVATIONS.JSON', 'Reservations.Json'])('never initializes beside a noncanonical reserved file: %s', async filename => {
    const directory = await temporary()
    await fs.writeFile(path.join(directory, filename), 'retained prior file evidence')
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'recovery_required' })
    await expect(previewReservationMigration(directory)).rejects.toMatchObject({ code: 'recovery_required' })
    await expect(migrateReservationLedger(directory, 'a'.repeat(64))).rejects.toMatchObject({ code: 'recovery_required' })
    expect(await fs.readdir(directory)).toEqual([filename])
    expect(await fs.readFile(path.join(directory, filename), 'utf8')).toBe('retained prior file evidence')
  })

  it('does not bypass or mutate an uppercase lock during preview, apply, or startup', async () => {
    const directory = await temporary()
    const filename = '.RESERVATIONS.LOCK'
    await fs.writeFile(path.join(directory, filename), 'another owner')
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'ledger_locked' })
    await expect(previewReservationMigration(directory)).rejects.toMatchObject({ code: 'ledger_locked' })
    await expect(migrateReservationLedger(directory, 'a'.repeat(64))).rejects.toMatchObject({ code: 'ledger_locked' })
    expect(await fs.readdir(directory)).toEqual([filename])
    expect(await fs.readFile(path.join(directory, filename), 'utf8')).toBe('another owner')
  })

  it('rejects a directory junction and a non-file database without resetting them', async () => {
    const directory = await temporary()
    const real = path.join(directory, 'real')
    const link = path.join(directory, 'linked')
    await fs.mkdir(real)
    await fs.symlink(real, link, 'junction')
    await expect(sqlite(link).open()).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(await fs.readdir(real)).toEqual([])
    await fs.mkdir(path.join(real, 'reservations.sqlite'))
    await expect(sqlite(real).open()).rejects.toMatchObject({ code: 'ledger_invalid' })
    expect((await fs.lstat(path.join(real, 'reservations.sqlite'))).isDirectory()).toBe(true)
  })
})

describe('explicit legacy migration', () => {
  it('previews exact source bytes and counts without creating or changing any file', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    const file = path.join(directory, 'reservations.json')
    const stat = await fs.stat(file)
    const preview = await previewReservationMigration(directory)
    expect(preview).toEqual({ sourceChecksum: checksum(before), sourceBytes: before.byteLength, revision: 2,
      orders: 6, activeHolds: 1, reservations: 1, events: 2, receipts: 2 })
    expect(await fs.readdir(directory)).toEqual(['reservations.json'])
    expect(await fs.readFile(file)).toEqual(before)
    expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs)
    const missing = path.join(directory, 'not-created')
    await expect(previewReservationMigration(missing)).rejects.toMatchObject({ code: 'storage_unavailable' })
    await expect(fs.lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('requires the exact preview hash before creating a database', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    await expect(migrateReservationLedger(directory, 'not-a-checksum')).rejects.toMatchObject({ code: 'migration_checksum_required' })
    await expect(migrateReservationLedger(directory, 'a'.repeat(64))).rejects.toMatchObject({ code: 'migration_source_changed' })
    expect(await fs.readdir(directory)).toEqual(['reservations.json'])
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(before)
  })

  it('migrates and verifies state while retaining the source byte-for-byte', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    const stat = await fs.stat(path.join(directory, 'reservations.json'))
    const preview = await previewReservationMigration(directory)
    expect(await migrateReservationLedger(directory, preview.sourceChecksum)).toEqual(preview)
    expect((await fs.readdir(directory)).sort()).toEqual(['reservations.json', 'reservations.sqlite'])
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(before)
    expect((await fs.stat(path.join(directory, 'reservations.json'))).mtimeMs).toBe(stat.mtimeMs)
    const store = sqlite(directory)
    await store.open()
    const expected = applyReservationCommand(applyReservationCommand(createReservationState(), sync).state, hold).snapshot
    expect(await store.snapshot()).toEqual(expected)
    expect((await store.execute(hold)).replayed).toBe(true)
  })

  it('verifies an idempotent apply after later database commands without rolling back or rewriting', async () => {
    const directory = await temporary()
    await legacy(directory)
    const preview = await previewReservationMigration(directory)
    await migrateReservationLedger(directory, preview.sourceChecksum)
    const first = sqlite(directory)
    await first.open()
    await first.execute(release)
    await first.close()
    const before = await fs.readFile(path.join(directory, 'reservations.sqlite'))
    expect(await migrateReservationLedger(directory, preview.sourceChecksum)).toEqual(preview)
    expect(await fs.readFile(path.join(directory, 'reservations.sqlite'))).toEqual(before)
    const next = sqlite(directory)
    await next.open()
    expect((await next.execute(hold)).snapshot).toMatchObject({ revision: 3 })
    expect((await next.snapshot()).reservations[0]?.status).toBe('released')
  })

  it.each(['json', 'checksum', 'history', 'missing-receipt'])('rejects damaged legacy data and preserves it: %s', async damage => {
    const directory = await temporary()
    await legacy(directory)
    const state = applyReservationCommand(applyReservationCommand(createReservationState(), sync).state, hold).state
    const contents = damage === 'json' ? '{ unreadable private data'
      : damage === 'checksum' ? JSON.stringify({ format: 'factoryos-material-ledger', version: 1, checksum: 'a'.repeat(64), state })
      : damage === 'history' ? envelope({ ...state, events: [] }) : envelope({ ...state, receipts: [] })
    await fs.writeFile(path.join(directory, 'reservations.json'), contents)
    await expect(previewReservationMigration(directory)).rejects.toMatchObject({ code: 'ledger_invalid' })
    await expect(migrateReservationLedger(directory, checksum(contents))).rejects.toMatchObject({ code: 'ledger_invalid' })
    expect(await fs.readFile(path.join(directory, 'reservations.json'), 'utf8')).toBe(contents)
    expect(await fs.readdir(directory)).toEqual(['reservations.json'])
  })

  it('requires the exact retained source on restart and rejects a changed migration checksum', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    const preview = await previewReservationMigration(directory)
    await migrateReservationLedger(directory, preview.sourceChecksum)
    await fs.appendFile(path.join(directory, 'reservations.json'), '\n')
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'migration_conflict' })
    await expect(migrateReservationLedger(directory, preview.sourceChecksum)).rejects.toMatchObject({ code: 'migration_source_changed' })
    const changed = await previewReservationMigration(directory)
    await expect(migrateReservationLedger(directory, changed.sourceChecksum)).rejects.toMatchObject({ code: 'migration_conflict' })
    await fs.writeFile(path.join(directory, 'reservations.json'), before)
    await fs.rename(path.join(directory, 'reservations.json'), path.join(directory, 'retained-copy.json'))
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'migration_source_missing' })
    expect(await fs.readFile(path.join(directory, 'retained-copy.json'))).toEqual(before)
  })

  it('refuses to claim an existing non-migrated database or overwrite its state', async () => {
    const directory = await temporary()
    const first = sqlite(directory)
    await first.open()
    await first.execute(sync)
    await first.close()
    const before = await fs.readFile(path.join(directory, 'reservations.sqlite'))
    const contents = envelope(createReservationState())
    await fs.writeFile(path.join(directory, 'reservations.json'), contents)
    await expect(migrateReservationLedger(directory, checksum(contents))).rejects.toMatchObject({ code: 'migration_conflict' })
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'migration_conflict' })
    expect(await fs.readFile(path.join(directory, 'reservations.sqlite'))).toEqual(before)
  })

  it('preserves a candidate and legacy source when publication fails', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    vi.spyOn(fs, 'link').mockRejectedValueOnce(new Error('private path publication failure'))
    await expect(migrateReservationLedger(directory, checksum(before))).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(before)
    await expect(fs.lstat(path.join(directory, 'reservations.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.readdir(directory)).some(name => /^reservations\..+\.sqlite\.pending$/.test(name))).toBe(true)
    await expect(sqlite(directory).open()).rejects.toMatchObject({ code: 'recovery_required' })
    await expect(previewReservationMigration(directory)).rejects.toMatchObject({ code: 'recovery_required' })
  })

  it('rechecks the source after building the candidate and refuses a change during migration', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    const readState = vi.spyOn(ReservationDatabase.prototype, 'readState')
    readState.mockImplementationOnce(function (this: ReservationDatabase) {
      appendFileSync(path.join(directory, 'reservations.json'), '\n')
      readState.mockRestore()
      return this.readState()
    })
    await expect(migrateReservationLedger(directory, checksum(before))).rejects.toMatchObject({ code: 'migration_source_changed' })
    expect(await fs.readFile(path.join(directory, 'reservations.json'), 'utf8')).toBe(before.toString('utf8') + '\n')
    await expect(fs.lstat(path.join(directory, 'reservations.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.readdir(directory)).some(name => name.endsWith('.sqlite.pending'))).toBe(true)
  })

  it('uses no-overwrite publication even if a destination appears after the initial check', async () => {
    const directory = await temporary()
    const before = await legacy(directory)
    const link = fs.link.bind(fs)
    vi.spyOn(fs, 'link').mockImplementationOnce(async (candidate, destination) => {
      await fs.writeFile(destination, 'separately created database evidence', { flag: 'wx' })
      return link(candidate, destination)
    })
    await expect(migrateReservationLedger(directory, checksum(before))).rejects.toMatchObject({ code: 'storage_unavailable' })
    expect(await fs.readFile(path.join(directory, 'reservations.sqlite'), 'utf8')).toBe('separately created database evidence')
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(before)
    expect((await fs.readdir(directory)).some(name => name.endsWith('.sqlite.pending'))).toBe(true)
  })
})
