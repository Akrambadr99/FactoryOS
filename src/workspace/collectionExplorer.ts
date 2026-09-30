export interface ExplorerRecord { id: string; archived: boolean }
export interface ExplorerState { value: string; label: string }
export interface ExplorerPolicy<T extends ExplorerRecord> {
  searchText: (record: T) => string
  revision: (record: T) => number
  state: (record: T) => string
  states: readonly ExplorerState[]
}
export interface CollectionView {
  query: string
  scope: 'active' | 'archived' | 'all'
  state: string
  sort: 'id-asc' | 'id-desc' | 'revision-desc'
  page: number
  pageSize: 5 | 10 | 25
}
export const DEFAULT_COLLECTION_VIEW: CollectionView = {
  query: '', scope: 'active', state: 'all', sort: 'id-asc', page: 1, pageSize: 10,
}
const keys = { query: 'q', scope: 'show', state: 'state', sort: 'sort', page: 'page', pageSize: 'size' } as const
export function readCollectionView(params: URLSearchParams, states: readonly ExplorerState[]): CollectionView {
  const scope = params.get('show'), sort = params.get('sort'), page = params.get('page') ?? ''
  const size = params.get('size'), state = params.get('state') ?? 'all'
  return {
    query: (params.get('q') ?? '').slice(0, 200),
    scope: scope === 'all' || scope === 'archived' ? scope : 'active',
    state: states.some(option => option.value === state) ? state : 'all',
    sort: sort === 'id-desc' || sort === 'revision-desc' ? sort : 'id-asc',
    page: /^[1-9]\d{0,5}$/.test(page) ? Number(page) : 1,
    pageSize: size === '5' ? 5 : size === '25' ? 25 : 10,
  }
}
export function updateCollectionView(params: URLSearchParams, patch: Partial<CollectionView>, states: readonly ExplorerState[]): URLSearchParams {
  const current = readCollectionView(params, states)
  const next = { ...current, ...patch }
  if ((Object.keys(patch) as (keyof CollectionView)[]).some(key => key !== 'page' && next[key] !== current[key])) next.page = 1
  const result = new URLSearchParams(params)
  for (const key of Object.keys(keys) as (keyof CollectionView)[]) {
    if (next[key] === DEFAULT_COLLECTION_VIEW[key]) result.delete(keys[key])
    else result.set(keys[key], String(next[key]))
  }
  return result
}
export function projectCollection<T extends ExplorerRecord>(records: readonly T[], view: CollectionView, policy: ExplorerPolicy<T>) {
  const needle = view.query.trim().toLowerCase()
  const matches = records.filter(record => (view.scope === 'all' || record.archived === (view.scope === 'archived')) &&
    (view.state === 'all' || policy.state(record) === view.state) && policy.searchText(record).toLowerCase().includes(needle))
  const identity = (a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  matches.sort((a, b) => {
    if (view.sort === 'id-desc') return -identity(a, b)
    if (view.sort === 'revision-desc') {
      const ar = policy.revision(a), br = policy.revision(b)
      return (Number.isFinite(br) ? br : 0) - (Number.isFinite(ar) ? ar : 0) || identity(a, b)
    }
    return identity(a, b)
  })
  const pageCount = Math.max(1, Math.ceil(matches.length / view.pageSize))
  const page = Math.min(Math.max(1, view.page), pageCount)
  return { rows: matches.slice((page - 1) * view.pageSize, page * view.pageSize),
    matchingCount: matches.length, totalCount: records.length, page, pageCount }
}
export function selectExplorerPage(selected: readonly string[], visible: readonly string[], select: boolean): string[] {
  const page = new Set(visible)
  return [...new Set(select ? [...selected, ...visible] : selected.filter(id => !page.has(id)))]
}
export function withCollectionView(path: string, params: URLSearchParams): string {
  const context = new URLSearchParams(params)
  context.delete('view')
  const raw = context.toString()
  return raw && raw.length <= 4000 ? path + (path.includes('?') ? '&' : '?') + 'view=' + encodeURIComponent(raw) : path
}
export function collectionBackPath(workspace: string, recordParam: string, id: string, params: URLSearchParams): string {
  const raw = params.get('view') ?? ''
  const restored = new URLSearchParams(raw.length <= 4000 ? raw : '')
  restored.delete('view')
  restored.set(recordParam, id)
  return workspace + '?' + restored.toString()
}
