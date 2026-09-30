import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ReservationStore, ReservationStoreError } from './reservationStore'
import { SQLiteReservationStore } from './sqliteReservationStore'
import { ReservationError } from '../src/execution/materials/reservations'

export interface ReservationServerOptions { directory: string; port?: number; frontendPort?: number; storage?: 'sqlite' | 'json' }
export interface ReservationServer { origin: string; port: number; close: () => Promise<void> }
const MAX_BODY_BYTES = 2 * 1024 * 1024
class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code }
}
function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send material commands as application/json.')
  }
  if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') {
    throw new HttpError(415, 'unsupported_encoding', 'Compressed material commands are not supported.')
  }
  const declared = request.headers['content-length']
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new HttpError(413, 'request_too_large', 'This material command exceeds the 2 MiB request limit.')
  return new Promise<unknown>((resolve, reject) => {
    let chunks: Buffer[] = [], size = 0, finished = false
    request.on('data', (part: Buffer | string) => {
      if (finished) return
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part)
      size += chunk.length
      if (size > MAX_BODY_BYTES) { finished = true; chunks = []; reject(new HttpError(413, 'request_too_large', 'This material command exceeds the 2 MiB request limit.')); return }
      chunks.push(chunk)
    })
    request.once('end', () => {
      if (finished) return
      finished = true
      try { resolve(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown) }
      catch { reject(new HttpError(400, 'invalid_json', 'This material command is not readable JSON. Your browser input was not changed.')) }
    })
    const interrupted = () => {
      if (!finished) { finished = true; chunks = []; reject(new HttpError(400, 'request_interrupted', 'The request was interrupted. Retry the same submitted command.')) }
    }
    request.once('aborted', interrupted); request.once('error', interrupted)
  })
}

/** Explicit local single-user service; browser-origin checks are not authentication. */
export async function startReservationServer(options: ReservationServerOptions): Promise<ReservationServer> {
  const port = options.port ?? 4404, frontendPort = options.frontendPort ?? 4304
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) {
    throw new Error('Invalid local service port.')
  }
  const origins = new Set([`http://127.0.0.1:${String(frontendPort)}`, `http://localhost:${String(frontendPort)}`])
  if (options.storage !== undefined && !['sqlite', 'json'].includes(options.storage)) throw new Error('Invalid reservation storage engine.')
  const store = options.storage === 'json' ? new ReservationStore(options.directory) : new SQLiteReservationStore(options.directory)
  await store.open()
  let boundPort = 0
  async function handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const origin = request.headers.origin
      if (!origin || !origins.has(origin) || ![`127.0.0.1:${String(boundPort)}`, `localhost:${String(boundPort)}`].includes(request.headers.host ?? '')) {
        throw new HttpError(403, 'request_not_allowed', 'This service accepts requests only from its configured local FactoryOS application.')
      }
      response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin')
      if (request.url !== '/api/reservations') throw new HttpError(404, 'not_found', 'This material-service route was not found.')
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method']
        const headers = (request.headers['access-control-request-headers'] ?? '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
        if (!['GET', 'POST'].includes(method ?? '') || !headers.includes('x-factoryos-client') || headers.some(value => !['x-factoryos-client', 'content-type'].includes(value))) {
          throw new HttpError(403, 'request_not_allowed', 'This browser operation is not permitted by the local material service.')
        }
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'X-FactoryOS-Client, Content-Type', 'Access-Control-Max-Age': '300' })
        response.end(); return
      }
      if (request.headers['x-factoryos-client'] !== 'reservations') throw new HttpError(403, 'request_not_allowed', 'The FactoryOS material-service header is missing or invalid.')
      if (request.method === 'GET') { send(response, 200, await store.snapshot()); return }
      if (request.method === 'POST') { send(response, 200, await store.execute(await body(request))); return }
      throw new HttpError(405, 'method_not_allowed', 'The material service supports reading and submitting commands only.')
    } catch (error) {
      request.resume()
      if (error instanceof HttpError) { send(response, error.status, { error: { code: error.code, message: error.message } }); return }
      if (error instanceof ReservationStoreError) { send(response, 503, { error: { code: error.code, message: error.message } }); return }
      if (error instanceof ReservationError) {
        const status = error.code === 'not_found' ? 404 : ['invalid_command', 'invalid_state'].includes(error.code) ? 400 : 409
        send(response, status, { error: { code: error.code, message: error.message } }); return
      }
      send(response, 503, { error: { code: 'service_unavailable', message: 'The local material service could not complete the request. Browser records were not changed; retry when it is available.' } })
    }
  }
  const server = createServer((request, response) => { void handle(request, response) })
  server.headersTimeout = 10_000; server.requestTimeout = 15_000; server.keepAliveTimeout = 1_000
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local server did not expose a TCP address.')
    boundPort = address.port
  } catch (error) { await store.close(); throw error }
  let closing: Promise<void> | undefined
  return { origin: `http://127.0.0.1:${String(boundPort)}`, port: boundPort, close: () => {
    closing ??= (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close(error => { if (error) reject(error); else resolve() })
          server.closeAllConnections()
        })
      } finally { await store.close() }
    })()
    return closing
  } }
}
