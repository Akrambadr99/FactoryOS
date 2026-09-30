import type { StoragePort } from './repository'

/** Runtime rules return the original value; validation never strips saved metadata. */
export type Rule<T> = (value: unknown, path?: string) => T
class ValidationIssue extends Error {}
function invalid(path: string, expected: string): never {
  throw new ValidationIssue(`Invalid saved data at ${path}: ${expected}.`)
}
export const text: Rule<string> = (value, path = '$') => {
  if (typeof value !== 'string') invalid(path, 'expected text')
  return value
}
export const nonEmptyText: Rule<string> = (value, path = '$') => {
  const result = text(value, path)
  if (!result.trim()) invalid(path, 'expected non-empty text')
  return result
}
export const booleanValue: Rule<boolean> = (value, path = '$') => {
  if (typeof value !== 'boolean') invalid(path, 'expected true or false')
  return value
}
export const finiteNumber: Rule<number> = (value, path = '$') => {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'expected a finite number')
  return value
}
export const nonNegativeInteger: Rule<number> = (value, path = '$') => {
  const result = finiteNumber(value, path)
  if (!Number.isSafeInteger(result) || result < 0) invalid(path, 'expected a non-negative safe integer')
  return result
}
export function optional<T>(rule: Rule<T>): Rule<T | undefined> {
  return (value, path) => value === undefined ? undefined : rule(value, path)
}
export function nullable<T>(rule: Rule<T>): Rule<T | null> {
  return (value, path) => value === null ? null : rule(value, path)
}
export function oneOf<T extends string>(...values: T[]): Rule<T> {
  return (value, path = '$') => {
    if (typeof value !== 'string' || !values.includes(value as T)) invalid(path, 'unsupported state')
    return value as T
  }
}
export function array<T>(rule: Rule<T>): Rule<T[]> {
  return (value, path = '$') => {
    if (!Array.isArray(value) || value.length > 100000) invalid(path, 'expected an array of at most 100000 entries')
    for (let index = 0; index < value.length; index++) rule(value[index], `${path}[${String(index)}]`)
    return value as T[]
  }
}
export function object<T extends object>(fields: { [K in keyof T]-?: Rule<T[K]> }): Rule<T> {
  return (value, path = '$') => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected an object')
    const record = value as Record<string, unknown>
    for (const key of Object.keys(fields) as (keyof T & string)[]) fields[key](record[key], `${path}.${key}`)
    return value as T
  }
}
export function uniqueBy<T>(rule: Rule<T[]>, key: keyof T): Rule<T[]> {
  return (value, path = '$') => {
    const entries = rule(value, path)
    if (new Set(entries.map(entry => entry[key])).size !== entries.length) invalid(path, 'duplicate identifiers')
    return entries
  }
}
export function dictionary<T>(rule: Rule<T>): Rule<Record<string, T>> {
  return (value, path = '$') => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected a dictionary')
    // Dictionary keys may contain private identifiers; report only a numeric entry index.
    Object.values(value).forEach((entry: unknown, index) => { rule(entry, `${path}[entry ${String(index)}]`) })
    return value as Record<string, T>
  }
}
export function refine<T>(rule: Rule<T>, check: (value: T) => boolean, reason: string): Rule<T> {
  return (value, path = '$') => {
    const result = rule(value, path)
    if (!check(result)) invalid(path, reason)
    return result
  }
}

/** Carries a storage key, never the raw payload or an exception containing user data. */
export class StoredDataError extends Error {
  readonly key: string
  readonly operation: 'read' | 'write'
  constructor(key: string, operation: 'read' | 'write', problem: string) {
    super(`${problem} Saved data has not been reset. ${operation === 'write' ? 'The change was not saved.' : 'Download a recovery copy before making repairs.'}`)
    this.name = 'StoredDataError'
    this.key = key
    this.operation = operation
  }
}
const MAX_STORED_CHARACTERS = 20000000
export function readStored<T>(storage: StoragePort, key: string, rule: Rule<T>, seed: () => T, legacyKey?: string): T {
  let raw: string | null
  try { raw = storage.getItem(key) }
  catch { throw new StoredDataError(key, 'read', 'Browser storage could not be read. Check storage permissions and retry.') }
  // Only a missing key is a new workspace. An empty string is damaged saved data.
  if (raw === null) {
    const sourceKey = legacyKey ?? key
    try {
      const legacyRaw = legacyKey ? storage.getItem(legacyKey) : null
      if (legacyRaw === '') invalid('$', 'legacy saved text is empty')
      if (legacyRaw !== null && legacyRaw.length > MAX_STORED_CHARACTERS) invalid('$', 'legacy saved data exceeds the supported size')
      return rule(seed())
    } catch (error) {
      if (error instanceof StoredDataError) throw error
      throw new StoredDataError(sourceKey, 'read', error instanceof ValidationIssue ? error.message : 'Legacy saved data could not be migrated safely.')
    }
  }
  try {
    if (raw.length > MAX_STORED_CHARACTERS) invalid('$', 'saved data exceeds the supported size')
    const value: unknown = JSON.parse(raw)
    return rule(value)
  } catch (error) {
    throw new StoredDataError(key, 'read', error instanceof ValidationIssue ? error.message : 'Saved data is not readable JSON.')
  }
}
export function writeStored<T>(storage: StoragePort, key: string, rule: Rule<T>, value: T): T {
  let raw: string
  try {
    rule(value)
    raw = JSON.stringify(value)
    if (raw.length > MAX_STORED_CHARACTERS) invalid('$', 'saved data exceeds the supported size')
    // Also validate the persisted representation (for example, a non-finite optional value).
    const encoded: unknown = JSON.parse(raw)
    rule(encoded)
  } catch (error) {
    throw new StoredDataError(key, 'write', error instanceof ValidationIssue ? error.message : 'This change could not be encoded safely.')
  }
  try { storage.setItem(key, raw) }
  catch { throw new StoredDataError(key, 'write', 'Browser storage rejected the save. Check available space and permissions, then retry.') }
  return value
}
