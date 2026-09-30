import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { createReservationState, reservationSnapshot, validateReservationState } from '../src/execution/materials/reservations'
import type { ReservationState } from '../src/execution/materials/reservations'
import { ReservationDatabase } from './reservationDatabase'
import { ReservationStoreError } from './reservationStore'

const DATABASE = 'reservations.sqlite'
const LEGACY = 'reservations.json'
const MAX_LEGACY_BYTES = 16 * 1024 * 1024
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const unavailable = () => new ReservationStoreError('storage_unavailable', 'The local material database could not be accessed. Existing files were preserved; check the folder permissions and recovery instructions.')
const invalid = () => new ReservationStoreError('ledger_invalid', 'The material ledger could not be verified. Existing files were preserved, not reset; review the local recovery instructions.')
const conflict = () => new ReservationStoreError('migration_conflict', 'The database and retained legacy source do not describe the same migration. Existing files were preserved; review them before retrying.')
const recovery = () => new ReservationStoreError('recovery_required', 'An interrupted material-database operation needs review. Pending files were preserved; follow the local recovery instructions before restarting.')
const hash = (contents: string | Buffer) => createHash('sha256').update(contents).digest('hex')
interface Lease { handle: FileHandle; token: string }
export interface ReservationMigrationPreview {
  sourceChecksum: string
  sourceBytes: number
  revision: number
  orders: number
  activeHolds: number
  reservations: number
  events: number
  receipts: number
}
interface LegacySource { state: ReservationState; summary: ReservationMigrationPreview }

async function info(file: string) {
  try { return await fs.lstat(file) }
  catch (error) { if (isRecord(error) && error['code'] === 'ENOENT') return null; throw error }
}
/** Reject directory links before creating or resolving the requested directory. */
async function directoryPath(requestedDirectory: string, create: boolean): Promise<string> {
  const requested = path.resolve(requestedDirectory)
  const root = path.parse(requested).root
  let current = root
  for (const segment of requested.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    const entry = await info(current)
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw unavailable()
    if (!entry && !create) throw unavailable()
  }
  if (create) await fs.mkdir(requested, { recursive: true, mode: 0o700 })
  const directory = await fs.lstat(requested)
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw unavailable()
  return fs.realpath(requested)
}
async function assertNoArtifacts(directory: string): Promise<void> {
  const names = await fs.readdir(directory)
  if (names.some(name => name.toLowerCase() === '.reservations.lock' && name !== '.reservations.lock')) {
    throw new ReservationStoreError('ledger_locked', 'A noncanonical material-ledger lock needs review. Existing files were preserved; follow the local lock recovery instructions.')
  }
  if (names.some(name => [DATABASE, LEGACY].includes(name.toLowerCase()) && name !== name.toLowerCase())) {
    throw new ReservationStoreError('recovery_required', 'A material-ledger file uses a noncanonical reserved filename. Existing files were preserved; review the filenames before restarting or migrating.')
  }
  if (names.map(name => name.toLowerCase()).some(name => /^reservations\..+\.pending(?:-(?:wal|shm|journal))?$/.test(name)
    || /^reservations\.sqlite-(?:wal|shm|journal)$/.test(name))) throw recovery()
}
async function acquireLock(directory: string): Promise<Lease> {
  let handle: FileHandle
  try { handle = await fs.open(path.join(directory, '.reservations.lock'), 'wx', 0o600) }
  catch (error) {
    if (isRecord(error) && error['code'] === 'EEXIST') throw new ReservationStoreError('ledger_locked',
      'Another process owns this material ledger, or a previous process stopped unexpectedly. Review the local lock recovery instructions.')
    throw unavailable()
  }
  const token = randomUUID()
  try { await handle.writeFile(token, 'utf8'); await handle.sync(); return { handle, token } }
  catch { await handle.close().catch(() => undefined); throw unavailable() }
}
async function releaseLock(directory: string, lease: Lease): Promise<void> {
  try {
    await lease.handle.close()
    const file = path.join(directory, '.reservations.lock')
    const entry = await info(file)
    if (!entry || !entry.isFile() || entry.isSymbolicLink() || await fs.readFile(file, 'utf8') !== lease.token) throw unavailable()
    await fs.unlink(file)
  } catch { throw unavailable() }
}
async function readLegacy(directory: string): Promise<LegacySource> {
  try {
    const file = path.join(directory, LEGACY)
    const entry = await info(file)
    if (!entry || !entry.isFile() || entry.isSymbolicLink() || entry.size === 0 || entry.size > MAX_LEGACY_BYTES) throw invalid()
    const contents = await fs.readFile(file)
    if (contents.byteLength === 0 || contents.byteLength > MAX_LEGACY_BYTES) throw invalid()
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents))
    if (!isRecord(parsed) || parsed['format'] !== 'factoryos-material-ledger' || parsed['version'] !== 1
      || typeof parsed['checksum'] !== 'string' || !Object.hasOwn(parsed, 'state')
      || parsed['checksum'] !== hash(JSON.stringify(parsed['state']))) throw invalid()
    const state = validateReservationState(parsed['state'])
    return { state, summary: { sourceChecksum: hash(contents), sourceBytes: contents.byteLength, revision: state.revision,
      orders: state.orders.length, activeHolds: state.reservations.filter(hold => hold.status === 'active').length,
      reservations: state.reservations.length, events: state.events.length, receipts: state.receipts.length } }
  } catch { throw invalid() }
}
async function assertDatabaseFile(directory: string): Promise<boolean> {
  const entry = await info(path.join(directory, DATABASE))
  if (!entry) return false
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size === 0) throw invalid()
  return true
}
async function verifyMigrationSource(directory: string, database: ReservationDatabase): Promise<void> {
  const receipt = database.migrationReceipt()
  const legacy = await info(path.join(directory, LEGACY))
  if (!receipt) { if (legacy) throw conflict(); return }
  if (!legacy) throw new ReservationStoreError('migration_source_missing',
    'This migrated database requires its retained legacy source for verification. Restore the original source file; no data was reset.')
  const source = await readLegacy(directory)
  if (source.summary.sourceChecksum !== receipt.sourceChecksum || source.summary.sourceBytes !== receipt.sourceBytes) throw conflict()
}
/** Reserve a unique candidate; validate and close it before publishing without overwriting a destination. */
async function publishDatabase(directory: string, state: ReservationState, migration?: { sourceChecksum: string; sourceBytes: number }): Promise<void> {
  const candidate = path.join(directory, `reservations.${randomUUID()}.sqlite.pending`)
  let database: ReservationDatabase | undefined
  try {
    const file = await fs.open(candidate, 'wx', 0o600)
    await file.close()
    database = new ReservationDatabase(candidate, { create: true, initialState: state, ...(migration ? { migration } : {}) })
    if (JSON.stringify(database.readState()) !== JSON.stringify(state)) throw invalid()
    database.close(); database = undefined
    const synced = await fs.open(candidate, 'r+')
    try { await synced.sync() } finally { await synced.close() }
    if (migration) {
      const latest = (await readLegacy(directory)).summary
      if (latest.sourceChecksum !== migration.sourceChecksum || latest.sourceBytes !== migration.sourceBytes) {
        throw new ReservationStoreError('migration_source_changed', 'The legacy source changed during migration. No database was published; review the retained files before retrying.')
      }
    }
    await fs.link(candidate, path.join(directory, DATABASE))
    await fs.unlink(candidate)
  } catch (error) {
    database?.close()
    // Keep the owned pending candidate as recovery evidence. Never remove or replace a destination.
    if (error instanceof ReservationStoreError) throw error
    throw unavailable()
  }
}

/** Inspect the legacy source without creating a directory, lock, database, or any other file. */
export async function previewReservationMigration(requestedDirectory: string): Promise<ReservationMigrationPreview> {
  try {
    const directory = await directoryPath(requestedDirectory, false)
    if (await info(path.join(directory, '.reservations.lock'))) throw new ReservationStoreError('ledger_locked',
      'Stop the material service before previewing its legacy ledger migration.')
    await assertNoArtifacts(directory)
    return (await readLegacy(directory)).summary
  } catch (error) { if (error instanceof ReservationStoreError) throw error; throw unavailable() }
}

/** Explicit, checksum-guarded migration. The retained source is never modified or deleted. */
export async function migrateReservationLedger(requestedDirectory: string, expectedSourceChecksum: string): Promise<ReservationMigrationPreview> {
  let directory = ''
  let lease: Lease | undefined
  let database: ReservationDatabase | undefined
  try {
    if (!/^[0-9a-f]{64}$/.test(expectedSourceChecksum)) throw new ReservationStoreError('migration_checksum_required',
      'Preview the legacy ledger and supply its exact source checksum before applying a migration.')
    directory = await directoryPath(requestedDirectory, false)
    await assertNoArtifacts(directory)
    lease = await acquireLock(directory)
    await assertNoArtifacts(directory)
    const source = await readLegacy(directory)
    if (source.summary.sourceChecksum !== expectedSourceChecksum) throw new ReservationStoreError('migration_source_changed',
      'The legacy source changed after preview. Review a fresh preview before applying; no database was replaced.')
    if (await assertDatabaseFile(directory)) {
      database = new ReservationDatabase(path.join(directory, DATABASE))
      database.readState()
      const receipt = database.migrationReceipt()
      if (receipt?.sourceChecksum !== expectedSourceChecksum || receipt.sourceBytes !== source.summary.sourceBytes) throw conflict()
      await verifyMigrationSource(directory, database)
    } else {
      await publishDatabase(directory, source.state, { sourceChecksum: source.summary.sourceChecksum, sourceBytes: source.summary.sourceBytes })
    }
    return source.summary
  } catch (error) { if (error instanceof ReservationStoreError) throw error; throw unavailable() }
  finally {
    database?.close()
    if (lease) await releaseLock(directory, lease)
  }
}

/** One local owner; commands and their receipts commit together in the SQLite database. */
export class SQLiteReservationStore {
  private readonly requestedDirectory: string
  private directory = ''
  private lease: Lease | undefined
  private database: ReservationDatabase | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false
  constructor(directory: string) { this.requestedDirectory = directory }
  async open(): Promise<void> {
    if (this.database || this.lease || this.closing) throw unavailable()
    try {
      this.directory = await directoryPath(this.requestedDirectory, true)
      await assertNoArtifacts(this.directory)
      this.lease = await acquireLock(this.directory)
      await assertNoArtifacts(this.directory)
      if (!(await assertDatabaseFile(this.directory))) {
        if (await info(path.join(this.directory, LEGACY))) throw new ReservationStoreError('migration_required',
          'A legacy material ledger exists. Stop the service, preview its migration, and explicitly apply the verified source checksum. The source was preserved.')
        await publishDatabase(this.directory, createReservationState())
      }
      this.database = new ReservationDatabase(path.join(this.directory, DATABASE))
      this.database.readState()
      await verifyMigrationSource(this.directory, this.database)
    } catch (error) {
      this.database?.close(); this.database = undefined
      if (this.lease) { const lease = this.lease; this.lease = undefined; await releaseLock(this.directory, lease).catch(() => undefined) }
      if (error instanceof ReservationStoreError) throw error
      throw unavailable()
    }
  }
  private serialized<T>(action: (database: ReservationDatabase) => T): Promise<T> {
    if (this.closing || !this.database) return Promise.reject(unavailable())
    const database = this.database
    const next = this.queue.then(() => action(database))
    this.queue = next.catch(() => undefined)
    return next
  }
  snapshot() { return this.serialized(database => reservationSnapshot(database.readState())) }
  execute(command: unknown) { return this.serialized(database => database.execute(command)) }
  releaseBatch(value: unknown) { return this.serialized(database => database.releaseBatch(value)) }
  async close(): Promise<void> {
    this.closing = true
    await this.queue
    try { this.database?.close(); this.database = undefined }
    finally {
      if (this.lease) { const lease = this.lease; this.lease = undefined; await releaseLock(this.directory, lease) }
    }
  }
}
