import type { StoragePort } from './repository'

export interface RecordBinding<C, R> {
  key: string
  read: (storage: StoragePort) => C
  save: (storage: StoragePort, collection: C) => C
  find: (collection: C, id: string) => R | undefined
  value: (record: R) => unknown
  archived: (record: R) => boolean
  replace: (collection: C, id: string, raw: string) => C
}

/** One collection write is the transaction boundary; the legacy key remains a backup. */
export function bindRecord<C, R>(storage: StoragePort, id: string, binding: RecordBinding<C, R>): StoragePort {
  const initial = binding.find(binding.read(storage), id)
  if (!initial) throw new Error('Record ' + id + ' was not found. Return to the workspace and select an existing record.')
  if (binding.archived(initial)) throw new Error('Record ' + id + ' is archived. Its history remains available in the workspace.')
  let expected = JSON.stringify(initial)
  let snapshot = JSON.stringify(binding.value(initial))
  return {
    getItem(key) {
      return key === binding.key ? snapshot : storage.getItem(key)
    },
    setItem(key, raw) {
      if (key !== binding.key) { storage.setItem(key, raw); return }
      const current = binding.read(storage)
      const record = binding.find(current, id)
      if (!record || binding.archived(record) || JSON.stringify(record) !== expected)
        throw new Error('This record changed in another view. Your input is still here. Reload the record before trying again.')
      const next = binding.replace(current, id, raw)
      const updated = binding.find(next, id)
      if (!updated) throw new Error('Record update lost its target.')
      binding.save(storage, next)
      expected = JSON.stringify(updated)
      snapshot = JSON.stringify(binding.value(updated))
    },
  }
}

export function saveCurrentCollection<C>(
  storage: StoragePort, expected: C, next: C,
  read: (storage: StoragePort) => C, save: (storage: StoragePort, value: C) => C,
): C {
  if (JSON.stringify(read(storage)) !== JSON.stringify(expected))
    throw new Error('Workspace changed in another view. Refresh the workspace before trying again.')
  return save(storage, next)
}
