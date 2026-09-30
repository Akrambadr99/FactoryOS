import { describe, expect, it, vi } from 'vitest'
import { compareCollectionSnapshot, createCollectionSnapshot, MAX_SNAPSHOT_CHARACTERS, snapshotSignature, type SnapshotAdapter } from './collectionSnapshot'
import { array, nonEmptyText, nonNegativeInteger, object, text, uniqueBy } from './storageValidation'
import type { StoragePort } from './repository'

interface Item { id: string; value: number }
interface Collection { items: Item[]; history: string[] }
const rule = object<Collection>({ items: uniqueBy(array(object<Item>({ id: nonEmptyText, value: nonNegativeInteger })), 'id'), history: array(text) })
const original: Collection = { items: [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }], history: [] }
function fixture(value = original) {
  const getItem = vi.fn(() => JSON.stringify(value)), setItem = vi.fn()
  const storage: StoragePort = { getItem, setItem }
  const adapter: SnapshotAdapter<Collection> = {
    product: 'Example', scope: 'items', label: 'Item collection',
    read: port => { const parsed: unknown = JSON.parse(port.getItem('items') ?? '{}'); return rule(parsed) },
    validate: rule, groups: data => [{ key: 'items', label: 'Items', records: data.items.map(item => ({ id: item.id, label: item.id, value: item })) }],
  }
  return { adapter, storage, getItem, setItem }
}
function envelope(payload: unknown = original, fields: Record<string, unknown> = {}) {
  return JSON.stringify({ format: 'collection-snapshot', version: 1, product: 'Example', scope: 'items', createdAt: '2026-09-30T12:00:00.000Z', payload, ...fields })
}
describe('read-only collection snapshots', () => {
  it('exports a versioned envelope with only the requested collection and performs no writes', () => {
    const { adapter, storage, setItem, getItem } = fixture()
    const raw = createCollectionSnapshot(adapter, storage, '2026-09-30T12:00:00.000Z')
    expect(JSON.parse(raw)).toEqual(JSON.parse(envelope()))
    expect(getItem).toHaveBeenCalledWith('items')
    expect(setItem).not.toHaveBeenCalled()
  })
  it('distinguishes added changed removed and unchanged records with complete before/after detail', () => {
    const { adapter, storage, setItem } = fixture()
    const candidate = { ...original, items: [{ id: 'a', value: 9 }, { id: 'c', value: 3 }, { id: 'd', value: 4 }] }
    const comparison = compareCollectionSnapshot(envelope(candidate), adapter, storage)
    expect(comparison.counts).toEqual({ added: 1, changed: 1, removed: 1, unchanged: 1 })
    expect(comparison.rows.find(row => row.id === 'a')).toMatchObject({ before: { id: 'a', value: 1 }, after: { id: 'a', value: 9 } })
    expect(comparison.payloadChanged).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
  })
  it('ignores object-key order but retains array order and collection metadata changes', () => {
    const { adapter, storage } = fixture()
    expect(compareCollectionSnapshot(envelope({ history: [], items: original.items.map(item => ({ value: item.value, id: item.id })) }), adapter, storage).payloadChanged).toBe(false)
    const history = compareCollectionSnapshot(envelope({ ...original, history: ['decision recorded'] }), adapter, storage)
    expect(history.payloadChanged).toBe(true)
    expect(history.counts.unchanged).toBe(3)
    expect(compareCollectionSnapshot(envelope({ ...original, items: [...original.items].reverse() }), adapter, storage).payloadChanged).toBe(true)
  })
  it.each([
    [{ version: 2 }, 'version'],
    [{ product: 'Other' }, 'different product'],
    [{ scope: 'other' }, 'different product'],
    [{ format: 'raw' }, 'raw recovery'],
    [{ createdAt: '2026-02-30T12:00:00.000Z' }, 'creation time'],
    [{ createdAt: null }, 'creation time'],
  ])('rejects incompatible envelope %j before reading current data', (fields, expected) => {
    const { adapter, storage, getItem, setItem } = fixture()
    expect(() => compareCollectionSnapshot(envelope(original, fields), adapter, storage)).toThrow(expected)
    expect(getItem).not.toHaveBeenCalled(); expect(setItem).not.toHaveBeenCalled()
  })
  it.each(['', '{bad', 'null', '[]', '{}'])('rejects unusable input %j with zero writes', raw => {
    const { adapter, storage, setItem } = fixture()
    expect(() => compareCollectionSnapshot(raw, adapter, storage)).toThrow()
    expect(setItem).not.toHaveBeenCalled()
  })
  it('rejects invalid nested records and duplicate IDs without silently repairing them', () => {
    const { adapter, storage, setItem } = fixture()
    for (const items of [[null], [{ id: 'a', value: -1 }], [original.items[0], original.items[0]]]) {
      expect(() => compareCollectionSnapshot(envelope({ ...original, items }), adapter, storage)).toThrow('records are invalid')
    }
    expect(setItem).not.toHaveBeenCalled()
  })
  it('preserves extra JSON metadata and includes it in comparison', () => {
    const withMetadata = { ...original, annotations: { source: 'manual', order: [1, 2] } }
    const { adapter, storage } = fixture(withMetadata)
    expect(JSON.parse(createCollectionSnapshot(adapter, storage))).toMatchObject({ payload: withMetadata })
    expect(compareCollectionSnapshot(envelope({ ...withMetadata, annotations: { source: 'manual', order: [2, 1] } }), adapter, storage).payloadChanged).toBe(true)
  })
  it('rejects oversized input and deep metadata before any persistence', () => {
    const { adapter, storage, setItem } = fixture()
    expect(() => compareCollectionSnapshot(' '.repeat(MAX_SNAPSHOT_CHARACTERS + 1), adapter, storage)).toThrow()
    let nested: unknown = null
    for (let depth = 0; depth < 65; depth++) nested = { nested }
    expect(() => compareCollectionSnapshot(envelope({ ...original, nested }), adapter, storage)).toThrow('nesting')
    expect(setItem).not.toHaveBeenCalled()
  })
  it('uses the same UTF-8 byte budget for exports and pasted input', () => {
    const large = { ...original, note: '漢'.repeat(7000000) }
    const { adapter, storage, setItem } = fixture(large)
    expect(() => createCollectionSnapshot(adapter, storage)).toThrow('20 MB')
    expect(() => compareCollectionSnapshot(envelope(large), adapter, storage)).toThrow('20 MB')
    expect(setItem).not.toHaveBeenCalled()
  })
  it('rejects nonfinite JSON numbers rather than normalizing them to null', () => {
    const { adapter, storage } = fixture()
    expect(() => compareCollectionSnapshot(envelope().replace('"value":1', '"value":1e999'), adapter, storage)).toThrow('unsupported JSON')
    expect(() => snapshotSignature({ value: undefined })).toThrow('unsupported JSON')
  })
  it('refuses to normalize overflowing saved metadata into null on export', () => {
    const { adapter, storage, getItem, setItem } = fixture()
    getItem.mockReturnValue(JSON.stringify(original).replace('"history":[]', '"history":[],"extra":1e999'))
    expect(() => createCollectionSnapshot(adapter, storage)).toThrow('unsupported numeric')
    expect(() => compareCollectionSnapshot(envelope(), adapter, storage)).toThrow('unsupported numeric')
    expect(setItem).not.toHaveBeenCalled()
  })
  it('does not conceal blocked current storage or write during failure', () => {
    const { adapter, storage, getItem, setItem } = fixture()
    getItem.mockImplementation(() => { throw new Error('Storage blocked') })
    expect(() => createCollectionSnapshot(adapter, storage)).toThrow('Storage blocked')
    expect(() => compareCollectionSnapshot(envelope(), adapter, storage)).toThrow('Storage blocked')
    expect(setItem).not.toHaveBeenCalled()
  })
  it('separates same IDs in different groups and rejects ambiguous adapter identities', () => {
    const { adapter, storage } = fixture()
    const groups = adapter.groups
    adapter.groups = value => [...groups(value), { key: 'related', label: 'Related', records: [{ id: 'a', label: 'Other a', value: {} }] }]
    expect(compareCollectionSnapshot(envelope(), adapter, storage).rows).toHaveLength(4)
    adapter.groups = value => [...groups(value), ...groups(value)]
    expect(() => compareCollectionSnapshot(envelope(), adapter, storage)).toThrow('unique identities')
  })
})
