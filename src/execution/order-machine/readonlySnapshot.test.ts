import { describe, expect, it } from 'vitest'
import type { StorageReader } from '../../platform/storage-port'
import { collectionSignature, compareCollectionSnapshot, createCollectionSnapshot } from '../../workspace/collectionSnapshot'
import { StoredDataError } from '../../workspace/storageValidation'
import { collectionSnapshotAdapter as adapter } from './collectionSnapshot'
import { seedOrderCollection } from './orderCollection'
import { initialOrderAggregate } from './orderLedger'

const key = 'factoryos:production-orders:v1'
const legacyKey = 'factoryos:order:PO-8842:v1'
const createdAt = '2026-09-30T12:00:00.000Z'
const scenarios: { label: string; entries: [string, string][] }[] = [
  { label: 'saved collection', entries: [[key, JSON.stringify({ ...seedOrderCollection(), reviewMetadata: { source: 'retained' } })]] },
  { label: 'legacy collection', entries: [[legacyKey, JSON.stringify(initialOrderAggregate)]] },
  { label: 'absent collection', entries: [] },
]

describe('FactoryOS read-only storage boundary', () => {
  it.each(scenarios)('exports and compares a $label through a getItem-only port', ({ entries }) => {
    const values = new Map([...entries, ['unrelated', 'keep']]), before = new Map(values)
    const reader: StorageReader = { getItem: name => values.get(name) ?? null }
    const raw = createCollectionSnapshot(adapter, reader, createdAt)
    const comparison = compareCollectionSnapshot(raw, adapter, reader)
    expect(JSON.parse(raw)).toMatchObject({ payload: adapter.read(reader) })
    expect(comparison.payloadChanged).toBe(false)
    expect(comparison.rows.length).toBeGreaterThan(0)
    expect(comparison.rows.every(row => row.status === 'unchanged')).toBe(true)
    expect(comparison.currentSignature).toBe(collectionSignature(adapter, reader))
    expect(values).toEqual(before)
    expect(reader).not.toHaveProperty('setItem')
  })

  it('propagates current read failures safely from every snapshot operation', () => {
    const raw = createCollectionSnapshot(adapter, { getItem: () => null }, createdAt)
    const reader: StorageReader = { getItem: () => { throw new Error('PRIVATE storage detail') } }
    const operations = [
      () => createCollectionSnapshot(adapter, reader, createdAt),
      () => compareCollectionSnapshot(raw, adapter, reader),
      () => collectionSignature(adapter, reader),
    ]
    for (const operation of operations) {
      expect(operation).toThrow(StoredDataError)
      expect(operation).toThrow('Browser storage could not be read')
      expect(operation).not.toThrow('PRIVATE storage detail')
    }
  })

  it('does not silently seed after a legacy read failure', () => {
    const values = new Map([[legacyKey, JSON.stringify(initialOrderAggregate)]])
    const before = new Map(values)
    const reader: StorageReader = { getItem: name => {
      if (name === legacyKey) throw new Error('PRIVATE legacy detail')
      return values.get(name) ?? null
    } }
    expect(() => createCollectionSnapshot(adapter, reader, createdAt)).toThrow(StoredDataError)
    expect(() => createCollectionSnapshot(adapter, reader, createdAt)).not.toThrow('PRIVATE legacy detail')
    expect(values).toEqual(before)
    expect(values.has(key)).toBe(false)
  })

  it('retains malformed current text instead of replacing it with a legacy fallback', () => {
    const values = new Map([[key, '{PRIVATE malformed'], [legacyKey, JSON.stringify(initialOrderAggregate)]])
    const before = new Map(values)
    const reader: StorageReader = { getItem: name => values.get(name) ?? null }
    expect(() => createCollectionSnapshot(adapter, reader, createdAt)).toThrow(StoredDataError)
    expect(() => createCollectionSnapshot(adapter, reader, createdAt)).not.toThrow('PRIVATE malformed')
    expect(values).toEqual(before)
  })
})
