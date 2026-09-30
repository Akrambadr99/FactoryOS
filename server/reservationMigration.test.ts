import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { seedOrderCollection } from '../src/execution/order-machine/orderCollection'
import { MigrationUsageError, migrationFailure, parseMigrationArguments, runReservationMigration } from './reservationMigration'
import { ReservationStore, ReservationStoreError } from './reservationStore'
import { SQLiteReservationStore } from './sqliteReservationStore'

const directories: { directory: string; parent: string }[] = []
const exec = promisify(execFile)
const cli = path.resolve('dist-server/reservationMigrationCli.js')
afterEach(async () => {
  for (const { directory, parent } of directories.splice(0)) {
    const resolved = await fs.realpath(directory)
    expect(resolved).toBe(directory); expect(path.dirname(resolved)).toBe(parent)
    expect(path.basename(resolved)).toMatch(/^factoryos-migration-cli-/)
    await fs.rm(resolved, { recursive: true, force: true })
  }
})
async function temporary() {
  const parent = await fs.realpath(os.tmpdir())
  const directory = await fs.realpath(await fs.mkdtemp(path.join(parent, 'factoryos-migration-cli-')))
  directories.push({ directory, parent }); return directory
}

describe('explicit reservation migration command', () => {
  it('uses the configured directory for preview and preserves an explicit path containing spaces', () => {
    expect(parseMigrationArguments(['preview'], 'configured-data')).toEqual({ mode: 'preview', directory: 'configured-data' })
    expect(parseMigrationArguments(['apply', '--directory', 'a folder/data', '--checksum', 'A'.repeat(64)]))
      .toEqual({ mode: 'apply', directory: 'a folder/data', checksum: 'a'.repeat(64) })
  })
  it.each([
    [], ['apply'], ['--force'], ['preview', '--force'], ['preview', '--directory'],
    ['preview', '--directory', ''], ['preview', '--checksum', 'a'.repeat(64)],
    ['apply', '--checksum', 'a'.repeat(63)], ['apply', '--checksum', 'z'.repeat(64)],
    ['apply', '--checksum', 'a'.repeat(64), '--checksum', 'b'.repeat(64)],
    ['preview', '--directory', 'one', '--directory', 'two'], ['preview', '--directory', 'unsafe\0path'],
  ].map(args => ({ args })))('rejects incomplete, ambiguous or destructive-looking arguments $args', ({ args }) => {
    expect(() => parseMigrationArguments(args)).toThrow(MigrationUsageError)
  })
  it('does not leak filesystem details or unknown exception text in CLI failures', () => {
    expect(migrationFailure(new Error('private-path credentials query-text'))).toEqual({
      code: 'migration_unavailable', message: 'Migration could not complete. Preserve the data directory and consult the local recovery instructions.', exitCode: 1,
    })
    expect(migrationFailure(new MigrationUsageError('Choose preview.'))).toMatchObject({ code: 'usage', exitCode: 2 })
    expect(migrationFailure(new ReservationStoreError('ledger_locked', 'Stop the service first.'))).toEqual({ code: 'ledger_locked', message: 'Stop the service first.', exitCode: 1 })
  })
  it('previews without writes, requires the reviewed digest, and preserves committed retry identity during apply', async () => {
    const directory = await temporary(), legacy = new ReservationStore(directory)
    const command = { kind: 'sync-orders', expectedRevision: 0, requestId: randomUUID(), collection: seedOrderCollection() }
    await legacy.open()
    try { await legacy.execute(command) } finally { await legacy.close() }
    const source = await fs.readFile(path.join(directory, 'reservations.json'))
    const files = await fs.readdir(directory)
    const preview = await runReservationMigration(['preview', '--directory', directory])
    expect(preview).toMatchObject({ mode: 'preview', revision: 1, receipts: 1, legacySourceRetained: true })
    expect(await fs.readdir(directory)).toEqual(files)
    await expect(runReservationMigration(['apply', '--directory', directory, '--checksum', '0'.repeat(64)])).rejects.toBeInstanceOf(ReservationStoreError)
    expect(await fs.readdir(directory)).toEqual(files)
    const applied = await runReservationMigration(['apply', '--directory', directory, '--checksum', preview.sourceChecksum])
    expect(applied).toMatchObject({ mode: 'apply', targetStorage: 'sqlite', sourceChecksum: preview.sourceChecksum, revision: 1 })
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(source)
    const database = new SQLiteReservationStore(directory)
    await database.open()
    try { expect(await database.execute(command)).toMatchObject({ replayed: true, snapshot: { revision: 1 } }) }
    finally { await database.close() }
    // The current compatibility writer must never silently fork a migrated ledger.
    await expect(new ReservationStore(directory).open()).rejects.toMatchObject({ code: 'migration_conflict' })
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(source)
  })

  it('does not enable legacy writes when a migrated database uses a differently cased filename', async () => {
    const directory = await temporary(), legacy = new ReservationStore(directory)
    await legacy.open(); await legacy.close()
    const source = await fs.readFile(path.join(directory, 'reservations.json'))
    const preview = await runReservationMigration(['preview', '--directory', directory])
    await runReservationMigration(['apply', '--directory', directory, '--checksum', preview.sourceChecksum])
    await fs.rename(path.join(directory, 'reservations.sqlite'), path.join(directory, 'RESERVATIONS.SQLITE'))
    await expect(new ReservationStore(directory).open()).rejects.toMatchObject({ code: 'migration_conflict' })
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(source)
    expect((await fs.readdir(directory)).sort()).toEqual(['RESERVATIONS.SQLITE', 'reservations.json'].sort())
  })

  it('runs the built CLI for preview and explicit apply while the built service rejects unmigrated data safely', async () => {
    const directory = await temporary(), legacy = new ReservationStore(directory)
    const command = { kind: 'sync-orders', expectedRevision: 0, requestId: randomUUID(), collection: seedOrderCollection() }
    await legacy.open()
    try { await legacy.execute(command) } finally { await legacy.close() }
    const env = { ...process.env, FACTORYOS_DATA_DIR: directory, FACTORYOS_PORT: '0' }
    const source = await fs.readFile(path.join(directory, 'reservations.json'))
    await expect(exec(process.execPath, [path.resolve('dist-server/index.js')], { env })).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('migration_required') as unknown,
    })
    const result = await exec(process.execPath, [cli, 'preview'], { env })
    expect(result.stderr).toBe(''); expect(result.stdout).not.toContain('PO-8842'); expect(result.stdout).not.toContain(directory)
    const preview = JSON.parse(result.stdout) as { sourceChecksum: string; revision: number }
    expect(preview.revision).toBe(1)
    expect(await fs.readdir(directory)).toEqual(['reservations.json'])
    const applied = await exec(process.execPath, [cli, 'apply', '--checksum', preview.sourceChecksum], { env })
    expect(JSON.parse(applied.stdout)).toMatchObject({ mode: 'apply', revision: 1, sourceChecksum: preview.sourceChecksum })
    expect(await fs.readFile(path.join(directory, 'reservations.json'))).toEqual(source)
    const database = new SQLiteReservationStore(directory)
    await database.open()
    try { expect(await database.execute(command)).toMatchObject({ replayed: true }) }
    finally { await database.close() }
  })

  it('prints safe usage for the built CLI without initializing its configured data directory', async () => {
    const directory = await temporary(), missing = path.join(directory, 'not-created')
    const env = { ...process.env, FACTORYOS_DATA_DIR: missing }
    expect((await exec(process.execPath, [cli, '--help'], { env })).stdout).toContain('Preview never writes.')
    await expect(exec(process.execPath, [cli, 'apply'], { env })).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('usage:') as unknown })
    expect(await fs.readdir(directory)).toEqual([])
  })
})
