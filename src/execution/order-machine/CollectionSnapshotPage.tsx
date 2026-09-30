import { SnapshotReviewPage } from '../../workspace/SnapshotReviewPage'
import { collectionSnapshotAdapter } from './collectionSnapshot'

export function CollectionSnapshotPage() {
  return <SnapshotReviewPage adapter={collectionSnapshotAdapter} />
}
