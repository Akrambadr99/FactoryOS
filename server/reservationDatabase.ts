import { closeSync, lstatSync, openSync, readSync } from 'node:fs'
import Database from 'better-sqlite3'
import { applyReservationCommand, createReservationState, ReservationError, validateReservationState,
  type ReservationState } from '../src/execution/materials/reservations'
import { ReservationStoreError } from './reservationStore'

export interface MigrationReceipt { sourceChecksum: string; sourceBytes: number }
interface Options { create?: boolean; initialState?: ReservationState; migration?: MigrationReceipt }
const APPLICATION_ID = 0x464f5352
const MAX_LOGICAL_BYTES = 16 * 1024 * 1024
const RELEASE_HEADROOM = 8 * 1024
const invalid = () => new ReservationStoreError('ledger_invalid', 'The material database could not be verified. It was preserved, not reset. Stop the service and follow the local recovery instructions.')
const unavailable = () => new ReservationStoreError('storage_unavailable', 'The local material database could not complete this operation. Existing data was kept; check the service and retry the same request.')
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const key = (value: string) => JSON.stringify(value)
const sqlText = (value: string) => value.trim().replace(/\s+/g, ' ')
function verifyExistingHeader(file: string): void {
  // SQLite can create WAL/SHM files as soon as it opens a WAL database. Inspect
  // the format bytes without opening a database connection so rejected sources
  // are not changed or given new sidecars during validation or migration review.
  const descriptor = openSync(file, 'r')
  try {
    const header = Buffer.alloc(100)
    if (readSync(descriptor, header, 0, header.length, 0) !== header.length
      || header.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0'
      || header[18] !== 1 || header[19] !== 1) throw invalid()
  } finally { closeSync(descriptor) }
}
const schema = [
  `CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), version INTEGER NOT NULL CHECK(version = 1),
    revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 5000), source_checksum TEXT, source_bytes INTEGER,
    CHECK((source_checksum IS NULL AND source_bytes IS NULL) OR
      (source_checksum IS NOT NULL AND source_bytes IS NOT NULL AND length(source_checksum) = 64
      AND source_checksum NOT GLOB '*[^0-9a-f]*' AND source_bytes BETWEEN 1 AND 16777216))) STRICT`,
  `CREATE TABLE orders (id_key TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE CHECK(position >= 0),
    payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload) = 'object'),
    line TEXT GENERATED ALWAYS AS (json_extract(payload, '$.line')) STORED NOT NULL CHECK(line IN ('assembly', 'packaging')),
    phase TEXT GENERATED ALWAYS AS (json_extract(payload, '$.phase')) STORED NOT NULL CHECK(phase IN ('material-hold', 'ready', 'running', 'quality-hold', 'complete')),
    source_revision INTEGER GENERATED ALWAYS AS (json_extract(payload, '$.sourceRevision')) STORED NOT NULL CHECK(source_revision >= 0)) STRICT`,
  `CREATE TABLE lots (id_key TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE CHECK(position >= 0),
    payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload) = 'object'),
    on_hand INTEGER GENERATED ALWAYS AS (json_extract(payload, '$.onHand')) STORED NOT NULL CHECK(on_hand >= 0),
    line TEXT GENERATED ALWAYS AS (json_extract(payload, '$.line')) STORED NOT NULL CHECK(line IN ('assembly', 'packaging'))) STRICT`,
  `CREATE TABLE reservations (id_key TEXT PRIMARY KEY, order_key TEXT NOT NULL, lot_key TEXT NOT NULL REFERENCES lots(id_key),
    position INTEGER NOT NULL UNIQUE CHECK(position >= 0), payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload) = 'object'),
    status TEXT GENERATED ALWAYS AS (json_extract(payload, '$.status')) STORED NOT NULL CHECK(status IN ('active', 'released')),
    quantity INTEGER GENERATED ALWAYS AS (json_extract(payload, '$.quantity')) STORED NOT NULL CHECK(quantity > 0),
    created_revision INTEGER GENERATED ALWAYS AS (json_extract(payload, '$.createdRevision')) STORED NOT NULL UNIQUE CHECK(created_revision > 0)) STRICT`,
  `CREATE UNIQUE INDEX active_order_lot ON reservations(order_key, lot_key) WHERE status = 'active'`,
  `CREATE TABLE events (sequence INTEGER PRIMARY KEY CHECK(sequence BETWEEN 1 AND 5000), request_key TEXT NOT NULL UNIQUE,
    reservation_key TEXT REFERENCES reservations(id_key), payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload) = 'object'),
    kind TEXT GENERATED ALWAYS AS (json_extract(payload, '$.kind')) STORED NOT NULL CHECK(kind IN ('sync-orders', 'reserve', 'release'))) STRICT`,
  `CREATE TABLE receipts (request_key TEXT PRIMARY KEY, revision INTEGER NOT NULL UNIQUE REFERENCES events(sequence),
    payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload) = 'object')) STRICT`,
] as const
type EntityTable = 'orders' | 'lots' | 'reservations'
interface PayloadRow { payload: string; [column: string]: unknown }
interface Metadata { version: number; revision: number; source_checksum: string | null; source_bytes: number | null }

function migration(value: unknown): MigrationReceipt | null {
  if (value === undefined || value === null) return null
  if (!object(value) || Object.keys(value).length !== 2 || typeof value['sourceChecksum'] !== 'string'
    || !/^[a-f0-9]{64}$/.test(value['sourceChecksum']) || typeof value['sourceBytes'] !== 'number'
    || !Number.isSafeInteger(value['sourceBytes']) || value['sourceBytes'] < 1 || value['sourceBytes'] > MAX_LOGICAL_BYTES) throw invalid()
  return { sourceChecksum: value['sourceChecksum'], sourceBytes: value['sourceBytes'] }
}
function capacity(state: ReservationState): void {
  // Count the same logical envelope as the legacy store, not SQLite page usage.
  // Eight KiB per hold covers its maximum escaped release reason, event and receipt.
  const bytes = Buffer.byteLength(JSON.stringify({ format: 'factoryos-material-ledger', version: 1, checksum: '0'.repeat(64), state }))
  if (bytes + state.reservations.filter(hold => hold.status === 'active').length * RELEASE_HEADROOM > MAX_LOGICAL_BYTES) {
    throw new ReservationStoreError('ledger_full', 'The material ledger reached its supported size. Space is reserved for releasing existing holds; other changes were not saved.')
  }
}

/** Synchronous transactions run under the caller's exclusive directory ownership. */
export class ReservationDatabase {
  private readonly db: Database.Database
  constructor(file: string, options: Options = {}) {
    let connection: Database.Database | undefined
    try {
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || (options.create ? stat.size !== 0 : stat.size === 0)) throw invalid()
      if (!options.create && (options.initialState !== undefined || options.migration !== undefined)) throw invalid()
      if (!options.create) verifyExistingHeader(file)
      const receipt = migration(options.migration)
      const initial = options.create ? validateReservationState(options.initialState ?? createReservationState()) : undefined
      if (initial) capacity(initial)
      connection = new Database(file, { fileMustExist: true, timeout: 1000 })
      this.db = connection
      this.db.pragma('foreign_keys = ON')
      if (options.create && initial) {
        this.db.pragma('journal_mode = DELETE'); this.db.pragma('synchronous = FULL')
        this.db.transaction(() => {
          if (this.db.prepare('SELECT name FROM sqlite_schema').all().length) throw invalid()
          for (const statement of schema) this.db.exec(statement)
          this.db.pragma(`application_id = ${String(APPLICATION_ID)}`); this.db.pragma('user_version = 1')
          this.db.prepare('INSERT INTO metadata VALUES (1, 1, ?, ?, ?)').run(initial.revision, receipt?.sourceChecksum ?? null, receipt?.sourceBytes ?? null)
          this.writeState(initial)
        }).immediate()
      }
      this.verifySchema()
      if (this.db.pragma('journal_mode', { simple: true }) !== 'delete') throw invalid()
      this.db.pragma('synchronous = FULL')
      this.readState()
    } catch (error) {
      connection?.close()
      if (error instanceof ReservationStoreError) throw error
      throw invalid()
    }
  }
  private verifyHeader(): void {
    if (this.db.pragma('application_id', { simple: true }) !== APPLICATION_ID || this.db.pragma('user_version', { simple: true }) !== 1) throw invalid()
  }
  private verifySchema(): void {
    this.verifyHeader()
    const actual = this.db.prepare<[], { sql: string }>('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL').all().map(row => sqlText(row.sql)).sort()
    if (JSON.stringify(actual) !== JSON.stringify(schema.map(sqlText).sort())) throw invalid()
  }
  private metadata(): Metadata {
    const rows = this.db.prepare<[], Metadata>('SELECT version, revision, source_checksum, source_bytes FROM metadata').all()
    if (rows.length !== 1 || !rows[0]) throw invalid()
    const row = rows[0]
    migration(row.source_checksum === null && row.source_bytes === null ? null : { sourceChecksum: row.source_checksum, sourceBytes: row.source_bytes })
    return row
  }
  private entities(table: EntityTable): unknown[] {
    const rows = this.db.prepare<[], PayloadRow>(`SELECT * FROM ${table} ORDER BY position`).all()
    return rows.map((row, index) => {
      const parsed: unknown = JSON.parse(row.payload)
      if (!object(parsed) || row['position'] !== index || row['id_key'] !== JSON.stringify(parsed['id'])) throw invalid()
      if (table === 'reservations' && (row['order_key'] !== JSON.stringify(parsed['orderId']) || row['lot_key'] !== JSON.stringify(parsed['lotId']))) throw invalid()
      return parsed
    })
  }
  private readUnchecked(): ReservationState {
    this.verifyHeader()
    if (this.db.pragma('integrity_check', { simple: true }) !== 'ok' || this.db.prepare('PRAGMA foreign_key_check').all().length) throw invalid()
    const meta = this.metadata()
    const events = this.db.prepare<[], PayloadRow>('SELECT * FROM events ORDER BY sequence').all().map(row => {
      const parsed: unknown = JSON.parse(row.payload)
      if (!object(parsed) || row['sequence'] !== parsed['sequence'] || row['request_key'] !== JSON.stringify(parsed['requestId'])
        || row['reservation_key'] !== (parsed['reservationId'] === null ? null : JSON.stringify(parsed['reservationId']))) throw invalid()
      return parsed
    })
    const receipts = this.db.prepare<[], PayloadRow>('SELECT * FROM receipts ORDER BY revision').all().map(row => {
      const parsed: unknown = JSON.parse(row.payload)
      if (!object(parsed) || row['revision'] !== parsed['revision'] || row['request_key'] !== JSON.stringify(parsed['requestId'])) throw invalid()
      return parsed
    })
    const state = validateReservationState({ version: meta.version, revision: meta.revision, orders: this.entities('orders'),
      lots: this.entities('lots'), reservations: this.entities('reservations'), events, receipts })
    capacity(state)
    return state
  }
  private read(): ReservationState {
    try { return this.readUnchecked() }
    catch (error) { if (error instanceof ReservationStoreError) throw error; throw invalid() }
  }
  readState(): ReservationState {
    try { return this.db.transaction(() => this.read()).deferred() }
    catch (error) { if (error instanceof ReservationStoreError) throw error; throw invalid() }
  }
  private writeState(next: ReservationState, previous?: ReservationState): void {
    if (!previous) {
      const insert = this.db.prepare('INSERT INTO lots (id_key, position, payload) VALUES (?, ?, ?)')
      next.lots.forEach((lot, index) => insert.run(key(lot.id), index, JSON.stringify(lot)))
    }
    if (!previous || JSON.stringify(previous.orders) !== JSON.stringify(next.orders)) {
      // The synchronized catalog is a replaceable ordered projection. Released
      // holds intentionally retain historical order IDs absent from that catalog.
      this.db.exec('DELETE FROM orders')
      const insert = this.db.prepare('INSERT INTO orders (id_key, position, payload) VALUES (?, ?, ?)')
      next.orders.forEach((order, index) => insert.run(key(order.id), index, JSON.stringify(order)))
    }
    const hold = this.db.prepare(`INSERT INTO reservations (id_key, order_key, lot_key, position, payload) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id_key) DO UPDATE SET payload = excluded.payload`)
    next.reservations.forEach((item, index) => {
      if (JSON.stringify(item) !== JSON.stringify(previous?.reservations[index])) hold.run(key(item.id), key(item.orderId), key(item.lotId), index, JSON.stringify(item))
    })
    const event = this.db.prepare('INSERT INTO events (sequence, request_key, reservation_key, payload) VALUES (?, ?, ?, ?)')
    for (const item of next.events.slice(previous?.events.length ?? 0)) event.run(item.sequence, key(item.requestId), item.reservationId === null ? null : key(item.reservationId), JSON.stringify(item))
    const receipt = this.db.prepare('INSERT INTO receipts (request_key, revision, payload) VALUES (?, ?, ?)')
    for (const item of next.receipts.slice(previous?.receipts.length ?? 0)) receipt.run(key(item.requestId), item.revision, JSON.stringify(item))
    this.db.prepare('UPDATE metadata SET revision = ? WHERE singleton = 1').run(next.revision)
  }
  execute(command: unknown) {
    try {
      return this.db.transaction(() => {
        const previous = this.read(), result = applyReservationCommand(previous, command)
        if (!result.replayed) { capacity(result.state); this.writeState(result.state, previous) }
        return { snapshot: result.snapshot, replayed: result.replayed }
      }).immediate()
    } catch (error) {
      if (error instanceof ReservationStoreError || error instanceof ReservationError) throw error
      throw unavailable()
    }
  }
  migrationReceipt(): MigrationReceipt | null {
    try {
      this.verifyHeader()
      const meta = this.metadata()
      return meta.source_checksum === null ? null : migration({ sourceChecksum: meta.source_checksum, sourceBytes: meta.source_bytes })
    } catch (error) { if (error instanceof ReservationStoreError) throw error; throw invalid() }
  }
  close(): void { if (this.db.open) this.db.close() }
}
