import path from 'node:path'
import { startReservationServer } from './reservationServer'
import { ReservationStoreError } from './reservationStore'

const port = process.env['FACTORYOS_PORT'] === undefined ? 4404 : Number(process.env['FACTORYOS_PORT'])
try {
  const service = await startReservationServer({ port, frontendPort: 4304,
    directory: process.env['FACTORYOS_DATA_DIR'] ?? path.resolve('.factoryos-data') })
  console.log(`FactoryOS local material reservations: ${service.origin}. SQLite storage; demo inventory; no authentication or cloud deployment.`)
  const stop = () => { void service.close().then(() => { process.exitCode = 0 }, () => { process.exitCode = 1 }) }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
} catch (error) {
  console.error(error instanceof ReservationStoreError ? `${error.code}: ${error.message}` : 'The local reservation service could not start. Check the configured port and local recovery instructions.')
  process.exitCode = 1
}
