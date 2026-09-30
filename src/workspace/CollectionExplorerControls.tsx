import { selectExplorerPage } from './collectionExplorer'
import type { CollectionView, ExplorerState } from './collectionExplorer'
import './collectionExplorer.css'

export function ExplorerControls({ noun, view, onChange, states, onReset }: {
  noun: string; view: CollectionView; onChange: (patch: Partial<CollectionView>, replace?: boolean) => void
  states: readonly ExplorerState[]; onReset: () => void
}) {
  return <div className="collection-explorer" role="group" aria-label="Collection view">
    <label>Search {noun}<input value={view.query} maxLength={200} onChange={event => { onChange({ query: event.target.value }, true) }} /></label>
    <label>Show<select aria-label="Show" value={view.scope} onChange={event => { onChange({ scope: event.target.value as CollectionView['scope'] }) }}>
      <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
    </select></label>
    <label>Work state<select aria-label="Work state" value={view.state} onChange={event => { onChange({ state: event.target.value }) }}>
      <option value="all">All work states</option>{states.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <label>Sort {noun}<select aria-label={'Sort ' + noun} value={view.sort} onChange={event => { onChange({ sort: event.target.value as CollectionView['sort'] }) }}>
      <option value="id-asc">ID ascending</option><option value="id-desc">ID descending</option><option value="revision-desc">Latest revision first</option>
    </select></label>
    <details><summary>View options</summary><label>Rows per page<select aria-label="Rows per page" value={view.pageSize}
      onChange={event => { onChange({ pageSize: Number(event.target.value) as CollectionView['pageSize'] }) }}>
      <option value={5}>5</option><option value={10}>10</option><option value={25}>25</option>
    </select></label></details>
    <button onClick={onReset}>Reset view</button>
  </div>
}
export function ExplorerPagination({ page, pageCount, matchingCount, onPageChange }: {
  page: number; pageCount: number; matchingCount: number; onPageChange: (page: number) => void
}) {
  return <nav className="collection-pagination" aria-label="Collection pages">
    <p aria-live="polite">{matchingCount} matching records · Page {page} of {pageCount}</p>
    <button disabled={page <= 1} onClick={() => { onPageChange(page - 1) }}>Previous page</button>
    <button disabled={page >= pageCount} onClick={() => { onPageChange(page + 1) }}>Next page</button>
  </nav>
}
export function ExplorerSelection({ selected, visible, onChange, noun = 'records' }: {
  selected: readonly string[]; visible: readonly string[]; onChange: (ids: string[]) => void; noun?: string
}) {
  const ids = [...new Set(selected)], page = new Set(visible)
  const hidden = ids.filter(id => !page.has(id)).length
  return <div className="collection-selection" role="group" aria-label="Bulk selection">
    <p aria-live="polite">{ids.length} {noun} selected · {hidden} outside this page.</p>
    {hidden > 0 && <p>Bulk actions include selected {noun} outside this page. Clear selection to limit their scope.</p>}
    <button disabled={!visible.length || visible.every(id => ids.includes(id))} onClick={() => { onChange(selectExplorerPage(ids, visible, true)) }}>Select this page</button>
    <button disabled={!visible.some(id => ids.includes(id))} onClick={() => { onChange(selectExplorerPage(ids, visible, false)) }}>Clear this page</button>
    <button disabled={!ids.length} onClick={() => { onChange([]) }}>Clear selection</button>
  </div>
}
