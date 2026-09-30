import type { SnapshotAdapter } from '../../workspace/collectionSnapshot'
import { readOrderCollection } from './orderCollection'
import type { OrderCollection } from './orderCollection'
import { orderCollectionRule } from './collectionValidation'

/** The full payload retains history; only stable domain identities form comparison rows. */
export const collectionSnapshotAdapter: SnapshotAdapter<OrderCollection> = {
  product: 'FactoryOS',
  scope: 'production-orders',
  label: 'Production order collection',
  read: readOrderCollection,
  validate: orderCollectionRule,
  groups: value => [
    { key: 'orders', label: 'Production orders', records: value.orders.map(record => ({
      id: record.id, label: `${record.line} · ${record.lotIndexId} · ${record.archived ? 'Archived' : 'Active'}`, value: record,
    })) },
    { key: 'lotIndexes', label: 'Lot genealogy indexes', records: value.lotIndexes.map(record => ({
      id: record.id, label: record.available ? 'Index available' : 'Index unavailable', value: record,
    })) },
  ],
}
