import { useSearchParams } from 'react-router-dom'
import { DEFAULT_COLLECTION_VIEW, projectCollection, readCollectionView, updateCollectionView } from './collectionExplorer'
import type { CollectionView, ExplorerPolicy, ExplorerRecord } from './collectionExplorer'

export function useCollectionExplorer<T extends ExplorerRecord>(records: readonly T[], policy: ExplorerPolicy<T>) {
  const [params, setParams] = useSearchParams()
  const view = readCollectionView(params, policy.states)
  function setView(patch: Partial<CollectionView>, replace = false) {
    setParams(current => updateCollectionView(current, patch, policy.states), { replace })
  }
  return { view, ...projectCollection(records, view, policy), setView,
    reset: () => { setView(DEFAULT_COLLECTION_VIEW) } }
}
