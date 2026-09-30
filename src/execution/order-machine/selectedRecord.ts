import type { StoragePort } from '../../platform/storage-port'
import { bindRecord } from '../../workspace/recordStorage'
import { readOrderCollection, saveOrderCollection } from './orderCollection'
import { readOrderAggregate } from './orderLedger'

export function openSelectedRecord(storage: StoragePort, id = 'PO-8842') {
  return bindRecord(storage, id, {
    key: 'factoryos:order:PO-8842:v1',
    collectionKey: 'factoryos:production-orders:v1',
    read: readOrderCollection, save: saveOrderCollection,
    find: (collection, target) => collection.orders.find(item => item.id === target),
    value: record => record.aggregate, archived: record => record.archived,
    replace: (collection, target, raw) => {
      const value = readOrderAggregate({ getItem: () => raw })
      return { ...collection, orders: collection.orders.map(item => item.id === target ? { ...item, aggregate: value } : item),
        events: [...collection.events, { sequence: collection.events.length + 1, action: 'detail-updated', targetId: target, relatedIds: [], actor: 'detail workflow', sourceRevision: value.order.revision }] }
    },
  })
}
