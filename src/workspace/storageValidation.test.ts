import { describe, expect, it, vi } from 'vitest'
import { array, booleanValue, finiteNumber, nonEmptyText, nonNegativeInteger, nullable, object, oneOf, optional, readStored, refine, StoredDataError, text, uniqueBy, writeStored } from './storageValidation'

interface Row { id: string; revision: number; enabled: boolean; state: 'open' | 'closed'; note?: string; amount: number | null }
const row = object<Row>({ id: nonEmptyText, revision: nonNegativeInteger, enabled: booleanValue, state: oneOf('open', 'closed'), note: optional(text), amount: nullable(finiteNumber) })
const rule = uniqueBy(array(row), 'id')
const seed = (): Row[] => [{ id: 'A', revision: 0, enabled: true, state: 'open', amount: null }]
function memory(raw: string | null) { return { getItem: vi.fn(() => raw), setItem: vi.fn((_key: string, value: string) => { raw = value }) } }

describe('validated persistence boundary', () => {
  it('rejects oversized legacy text before migration without writing or leaking the entry', () => {
    const migrate = vi.fn(seed)
    const raw = ' '.repeat(20000001)
    const storage = { getItem: (key: string) => key === 'legacy' ? raw : null, setItem: vi.fn() }
    try { readStored(storage, 'collection', rule, migrate, 'legacy'); expect.fail('Expected size rejection') }
    catch (error) {
      expect(error).toBeInstanceOf(StoredDataError)
      expect((error as StoredDataError).key).toBe('legacy')
      expect((error as Error).message).toContain('supported size')
    }
    expect(migrate).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.getItem('legacy')).toBe(raw)
  })
  it('seeds only an absent key without writing', () => {
    const storage = memory(null)
    expect(readStored(storage, 'key', rule, seed)).toEqual(seed())
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it.each(['', '{broken', 'null', '{}', '[null]', '[{"id":"A"}]'])('preserves malformed saved text: %s', raw => {
    const storage = memory(raw)
    expect(() => readStored(storage, 'key', rule, seed)).toThrow(StoredDataError)
    expect(storage.getItem()).toBe(raw)
    expect(storage.setItem).not.toHaveBeenCalled()
  })
  it('reports a safe field path without repeating a private field value', () => {
    const storage = memory(JSON.stringify([{ ...seed()[0], revision: 'PRIVATE-VALUE' }]))
    expect(() => readStored(storage, 'key', rule, seed)).toThrow('$[0].revision')
    expect(() => readStored(storage, 'key', rule, seed)).not.toThrow('PRIVATE-VALUE')
  })
  it('preserves unknown metadata and missing optional fields on valid round trips', () => {
    const value = [{ ...seed()[0], futureMetadata: { source: 'keep' } }]
    const storage = memory(null)
    writeStored(storage, 'key', rule, value as Row[])
    expect(readStored(storage, 'key', rule, seed)).toEqual(value)
  })
  it('rejects duplicate identifiers before replacing a good saved value', () => {
    const raw = JSON.stringify(seed()); const storage = memory(raw)
    expect(() => writeStored(storage, 'key', rule, [...seed(), ...seed()])).toThrow('duplicate identifiers')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.getItem()).toBe(raw)
  })
  it.each([-1, 1.5, Number.POSITIVE_INFINITY, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe revision %s', revision => {
    const storage = memory('original')
    expect(() => writeStored(storage, 'key', rule, [{ ...seed()[0]!, revision }])).toThrow(StoredDataError)
    expect(storage.getItem()).toBe('original')
  })
  it('allows only declared states and real booleans', () => {
    expect(() => row({ ...seed()[0], state: 'future' })).toThrow('unsupported state')
    expect(() => row({ ...seed()[0], enabled: 'false' })).toThrow('true or false')
  })
  it('exposes a retryable storage failure without claiming a successful save', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('private quota detail') } }
    expect(() => writeStored(storage, 'key', rule, seed())).toThrow('The change was not saved')
    expect(() => writeStored(storage, 'key', rule, seed())).not.toThrow('private quota detail')
  })
  it('classifies blocked storage reads without leaking native errors', () => {
    expect(() => readStored({ getItem: () => { throw new Error('private') }, setItem: vi.fn() }, 'key', rule, seed)).toThrow('Browser storage could not be read')
  })
  it('supports domain reference checks without changing accepted values', () => {
    const linked = refine(rule, rows => rows.every(entry => entry.id === 'A'), 'record references are inconsistent')
    expect(linked(seed())).toEqual(seed())
    expect(() => linked([{ ...seed()[0], id: 'B' }])).toThrow('record references are inconsistent')
  })
})
