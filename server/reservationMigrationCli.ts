import { migrationFailure, migrationUsage, runReservationMigration } from './reservationMigration'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--help') console.log(migrationUsage)
else {
  try {
    const result = await runReservationMigration(args, process.env['FACTORYOS_DATA_DIR'] ?? '.factoryos-data')
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    const failure = migrationFailure(error)
    console.error(`${failure.code}: ${failure.message}`)
    if (failure.code === 'usage') console.error(migrationUsage)
    process.exitCode = failure.exitCode
  }
}
