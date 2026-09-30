import type { StoragePort } from '../../workspace/repository'
import { readOrderCollection } from './orderCollection'

export function activeRecordWork(storage: StoragePort) {
  return readOrderCollection(storage).orders.filter(item => !item.archived).map(item => ({ orderId: item.id, line: item.line, aggregate: item.aggregate }))
}
export function selectedRecordWork(storage: StoragePort, id: string) {
  const record = activeRecordWork(storage).find(item => item.orderId === id)
  if (!record) throw new Error('Active record not found.')
  return record
}
