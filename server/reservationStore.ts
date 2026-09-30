import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { applyReservationCommand, createReservationState, reservationSnapshot, validateReservationState } from '../src/execution/materials/reservations'

export class ReservationStoreError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.name = 'ReservationStoreError'; this.code = code }
}
const storeUnavailable = () => new ReservationStoreError('storage_unavailable',
  'The local material ledger could not be accessed. Check its folder permissions and retry. Browser records were not changed.')
const MAX_LEDGER_BYTES = 16 * 1024 * 1024
// A release adds a 240-code-unit reason to both the hold and its nested JSON
// receipt (at most 6 + 7 UTF-8 bytes per code unit), one <=120-code-unit order
// identifier to the event, and bounded UUID/revision/field text: under 8 KiB.
// Keep that space for every active hold, even when sync receipts fill the file.
const RELEASE_HEADROOM_BYTES = 8 * 1024
const fingerprint = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
type State = ReturnType<typeof createReservationState>
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** One local process owns the ledger; state and idempotency receipts commit in a single replacement. */
export class ReservationStore {
  private readonly requestedDirectory: string
  private directory = ''
  private lock: FileHandle | undefined
  private readonly token = randomUUID()
  private queue: Promise<unknown> = Promise.resolve()
  private closing = false
  private readonly maxLedgerBytes: number
  constructor(directory: string, options: { maxLedgerBytes?: number } = {}) {
    this.requestedDirectory = directory
    this.maxLedgerBytes = options.maxLedgerBytes ?? MAX_LEDGER_BYTES
    if (!Number.isSafeInteger(this.maxLedgerBytes) || this.maxLedgerBytes < RELEASE_HEADROOM_BYTES || this.maxLedgerBytes > MAX_LEDGER_BYTES) {
      throw new Error('Invalid local material-ledger size limit.')
    }
  }

  async open(): Promise<void> {
    try {
      const requested = path.resolve(this.requestedDirectory)
      await fs.mkdir(requested, { recursive: true, mode: 0o700 })
      if ((await fs.lstat(requested)).isSymbolicLink()) throw storeUnavailable()
      this.directory = await fs.realpath(requested)
      this.lock = await fs.open(path.join(this.directory, '.reservations.lock'), 'wx', 0o600)
      await this.lock.writeFile(this.token, 'utf8'); await this.lock.sync()
      if ((await fs.readdir(this.directory)).some(name => /^reservations\.[0-9a-f-]+\.pending$/.test(name))) {
        throw new ReservationStoreError('recovery_required', 'An interrupted material-ledger write needs review. Existing files were kept; follow the local recovery instructions before restarting.')
      }
      try { await fs.lstat(this.stateFile()) }
      catch (error) {
        if (!record(error) || error['code'] !== 'ENOENT') throw error
        await this.publish(createReservationState())
      }
      await this.read()
    } catch (error) {
      await this.releaseLock().catch(() => undefined)
      if (error instanceof ReservationStoreError) throw error
      if (record(error) && error['code'] === 'EEXIST') throw new ReservationStoreError('ledger_locked',
        'Another process owns this material ledger, or a previous process stopped unexpectedly. Review the local lock recovery instructions.')
      throw storeUnavailable()
    }
  }
  private stateFile(): string { return path.join(this.directory, 'reservations.json') }
  private async read(): Promise<State> {
    try {
      const file = this.stateFile(), info = await fs.lstat(file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > this.maxLedgerBytes) throw storeUnavailable()
      const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      if (!record(parsed) || parsed['format'] !== 'factoryos-material-ledger' || parsed['version'] !== 1 ||
        typeof parsed['checksum'] !== 'string' || !Object.hasOwn(parsed, 'state') ||
        parsed['checksum'] !== fingerprint(JSON.stringify(parsed['state']))) throw storeUnavailable()
      return validateReservationState(parsed['state'])
    } catch {
      throw new ReservationStoreError('ledger_invalid',
        'The saved material ledger could not be verified. It was preserved, not reset. Stop the service and review the local recovery instructions.')
    }
  }
  private async publish(state: State): Promise<void> {
    validateReservationState(state)
    const stateText = JSON.stringify(state)
    const contents = JSON.stringify({ format: 'factoryos-material-ledger', version: 1, checksum: fingerprint(stateText), state })
    const releaseHeadroom = state.reservations.filter(hold => hold.status === 'active').length * RELEASE_HEADROOM_BYTES
    if (Buffer.byteLength(contents) + releaseHeadroom > this.maxLedgerBytes) throw new ReservationStoreError('ledger_full',
      'The local material ledger reached its supported size. Space is reserved for releasing existing holds; other changes were not saved.')
    const temporary = path.join(this.directory, 'reservations.' + randomUUID() + '.pending')
    let handle: FileHandle | undefined
    try {
      handle = await fs.open(temporary, 'wx', 0o600)
      await handle.writeFile(contents, 'utf8'); await handle.sync(); await handle.close(); handle = undefined
      await fs.rename(temporary, this.stateFile())
    } catch {
      if (handle) await handle.close().catch(() => undefined)
      await fs.unlink(temporary).catch(() => undefined)
      throw storeUnavailable()
    }
  }
  private serialized<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(storeUnavailable())
    const next = this.queue.then(action, action)
    this.queue = next.catch(() => undefined)
    return next
  }
  snapshot() { return this.serialized(async () => reservationSnapshot(await this.read())) }
  execute(command: unknown) {
    return this.serialized(async () => {
      const result = applyReservationCommand(await this.read(), command)
      if (!result.replayed) await this.publish(result.state)
      return { snapshot: result.snapshot, replayed: result.replayed }
    })
  }
  private async releaseLock(): Promise<void> {
    if (!this.lock) return
    await this.lock.close(); this.lock = undefined
    const file = path.join(this.directory, '.reservations.lock')
    if (await fs.readFile(file, 'utf8') === this.token) await fs.unlink(file)
  }
  async close(): Promise<void> {
    this.closing = true
    await this.queue
    await this.releaseLock()
  }
}
