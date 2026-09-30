import type { StorageReader } from '../platform/storage-port'
import type { Rule } from './storageValidation'

export interface SnapshotRecord { id: string; label: string; value: unknown }
export interface SnapshotGroup { key: string; label: string; records: readonly SnapshotRecord[] }
export interface SnapshotAdapter<T> {
  product: string
  scope: string
  label: string
  read: (storage: StorageReader) => T
  validate: Rule<T>
  groups: (value: T) => readonly SnapshotGroup[]
}
export type Difference = 'added' | 'changed' | 'removed' | 'unchanged'
export interface SnapshotRow {
  key: string
  group: string
  id: string
  label: string
  status: Difference
  before: unknown
  after: unknown
}
export interface SnapshotComparison {
  createdAt: string
  payloadChanged: boolean
  currentSignature: string
  counts: Record<Difference, number>
  rows: readonly SnapshotRow[]
}
export const MAX_SNAPSHOT_CHARACTERS = 20000000
function checkSize(raw: string) {
  if (raw.length > MAX_SNAPSHOT_CHARACTERS || new TextEncoder().encode(raw).length > MAX_SNAPSHOT_CHARACTERS) {
    throw new SnapshotError('The snapshot exceeds the supported 20 MB size.')
  }
}
export class SnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'SnapshotError' }
}

/** Stable object-key ordering; array order and every metadata field remain significant. */
export function snapshotSignature(value: unknown, depth = 0): string {
  if (depth > 60) throw new SnapshotError('Snapshot nesting exceeds the supported depth.')
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((item: unknown) => snapshotSignature(item, depth + 1)).join(',') + ']'
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return '{' + Object.keys(record).sort().map(key => JSON.stringify(key) + ':' + snapshotSignature(record[key], depth + 1)).join(',') + '}'
  }
  throw new SnapshotError('Snapshot contains unsupported JSON values.')
}
function validatePayload<T>(value: unknown, adapter: SnapshotAdapter<T>): T {
  snapshotSignature(value)
  try { return adapter.validate(value) }
  catch { throw new SnapshotError('Snapshot records are invalid for this collection. Check the source file; no saved data was changed.') }
}
function currentPayload<T>(adapter: SnapshotAdapter<T>, storage: StorageReader): T {
  const value = adapter.read(storage)
  // Round-trip like persistence, without writing; absent optional fields stay absent.
  const raw = JSON.stringify(value, (_key, entry: unknown) => {
    if (typeof entry === 'number' && !Number.isFinite(entry)) {
      throw new SnapshotError('The current collection contains unsupported numeric values. No snapshot was created.')
    }
    return entry
  })
  checkSize(raw)
  const payload: unknown = JSON.parse(raw)
  return validatePayload(payload, adapter)
}
function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}
export function createCollectionSnapshot<T>(adapter: SnapshotAdapter<T>, storage: StorageReader, createdAt = new Date().toISOString()): string {
  if (!validDate(createdAt)) throw new SnapshotError('The snapshot creation time is invalid.')
  const payload = currentPayload(adapter, storage)
  const raw = JSON.stringify({ format: 'collection-snapshot', version: 1, product: adapter.product, scope: adapter.scope, createdAt, payload })
  checkSize(raw)
  return raw
}
function records<T>(value: T, adapter: SnapshotAdapter<T>) {
  const result = new Map<string, { group: string; record: SnapshotRecord }>()
  const groups = new Set<string>()
  for (const group of adapter.groups(value)) {
    if (!group.key || groups.has(group.key)) throw new SnapshotError('Collection comparison groups must have unique identities.')
    groups.add(group.key)
    for (const record of group.records) {
      const key = JSON.stringify([group.key, record.id])
      if (!record.id || result.has(key)) throw new SnapshotError('Collection comparison records must have unique identities.')
      result.set(key, { group: group.label, record })
    }
  }
  return result
}
export function collectionSignature<T>(adapter: SnapshotAdapter<T>, storage: StorageReader): string {
  return snapshotSignature(currentPayload(adapter, storage))
}
export function compareCollectionSnapshot<T>(raw: string, adapter: SnapshotAdapter<T>, storage: StorageReader): SnapshotComparison {
  if (!raw.trim()) throw new SnapshotError('Choose a snapshot file or paste Snapshot JSON first.')
  checkSize(raw)
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch { throw new SnapshotError('The snapshot is not readable JSON. Your input has been kept for correction.') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SnapshotError('Choose an exported collection snapshot, not a raw recovery copy.')
  const envelope = parsed as Record<string, unknown>
  if (envelope['format'] !== 'collection-snapshot') throw new SnapshotError('Choose an exported collection snapshot, not a raw recovery copy.')
  if (envelope['version'] !== 1) throw new SnapshotError('This snapshot version is not supported. Nothing was imported.')
  if (envelope['product'] !== adapter.product || envelope['scope'] !== adapter.scope) {
    throw new SnapshotError('This snapshot belongs to a different product or collection. Nothing was imported.')
  }
  if (!validDate(envelope['createdAt'])) throw new SnapshotError('The snapshot creation time is invalid.')
  const candidate = validatePayload(envelope['payload'], adapter)
  const current = currentPayload(adapter, storage)
  const before = records(current, adapter)
  const after = records(candidate, adapter)
  const counts: Record<Difference, number> = { added: 0, changed: 0, removed: 0, unchanged: 0 }
  const rows = [...new Set([...before.keys(), ...after.keys()])].sort().map(key => {
    const left = before.get(key), right = after.get(key), item = right ?? left
    if (!item) throw new SnapshotError('A comparison record could not be read.')
    const status: Difference = !left ? 'added' : !right ? 'removed' :
      snapshotSignature(left.record.value) === snapshotSignature(right.record.value) ? 'unchanged' : 'changed'
    counts[status]++
    return { key, group: item.group, id: item.record.id, label: item.record.label, status,
      before: left?.record.value, after: right?.record.value }
  })
  const currentSignature = snapshotSignature(current)
  return { createdAt: envelope['createdAt'], currentSignature,
    payloadChanged: currentSignature !== snapshotSignature(candidate), counts, rows }
}
