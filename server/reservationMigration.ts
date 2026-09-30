import { ReservationStoreError } from './reservationStore'
import { migrateReservationLedger, previewReservationMigration } from './sqliteReservationStore'

export const migrationUsage = 'Usage: npm run reservations:migrate -- preview|apply [--directory DIR] [--checksum SHA256]\nPreview never writes. Apply requires the checksum from preview and retains the original JSON ledger. Stop the service before either command.'
export class MigrationUsageError extends Error {
  constructor(message: string) { super(message); this.name = 'MigrationUsageError' }
}
export interface MigrationArguments { mode: 'preview' | 'apply'; directory: string; checksum?: string }

export function parseMigrationArguments(args: readonly string[], defaultDirectory = '.factoryos-data'): MigrationArguments {
  const mode = args[0]
  if (mode !== 'preview' && mode !== 'apply') throw new MigrationUsageError('Choose preview or apply explicitly.')
  let directory = defaultDirectory, checksum: string | undefined
  const seen = new Set<string>()
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1]
    if ((flag !== '--directory' && flag !== '--checksum') || seen.has(flag)) throw new MigrationUsageError('Unknown or repeated migration option.')
    if (!value?.trim() || value.startsWith('--') || value.includes('\0')) throw new MigrationUsageError('Each migration option requires a nonempty value.')
    seen.add(flag)
    if (flag === '--directory') directory = value
    else checksum = value.toLowerCase()
  }
  if (!directory.trim() || directory.includes('\0')) throw new MigrationUsageError('A local data directory is required.')
  if (mode === 'preview' && checksum !== undefined) throw new MigrationUsageError('Preview does not accept a checksum; it calculates one without writing.')
  if (mode === 'apply' && (checksum === undefined || !/^[0-9a-f]{64}$/.test(checksum))) throw new MigrationUsageError('Apply requires the complete SHA-256 checksum from a reviewed preview.')
  return { mode, directory, ...(checksum === undefined ? {} : { checksum }) }
}

export async function runReservationMigration(args: readonly string[], defaultDirectory = '.factoryos-data') {
  const parsed = parseMigrationArguments(args, defaultDirectory)
  const summary = parsed.mode === 'preview' ? await previewReservationMigration(parsed.directory)
    : await migrateReservationLedger(parsed.directory, parsed.checksum ?? '')
  return { mode: parsed.mode, targetStorage: 'sqlite', legacySourceRetained: true, ...summary }
}

export function migrationFailure(error: unknown): { code: string; message: string; exitCode: number } {
  if (error instanceof MigrationUsageError) return { code: 'usage', message: error.message, exitCode: 2 }
  if (error instanceof ReservationStoreError) return { code: error.code, message: error.message, exitCode: 1 }
  return { code: 'migration_unavailable', message: 'Migration could not complete. Preserve the data directory and consult the local recovery instructions.', exitCode: 1 }
}
