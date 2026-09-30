import type { StorageReader } from '../../platform/storage-port'
import { readOrderCollection } from './orderCollection'

export function activeRecordWork(storage: StorageReader) {
  return readOrderCollection(storage).orders.filter(item => !item.archived).map(item => ({ orderId: item.id, line: item.line, aggregate: item.aggregate }))
}
export function selectedRecordWork(storage: StorageReader, id: string) {
  const record = activeRecordWork(storage).find(item => item.orderId === id)
  if (!record) throw new Error('Active record not found.')
  return record
}
