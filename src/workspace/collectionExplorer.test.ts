import { describe, expect, it } from 'vitest'
import { collectionBackPath, DEFAULT_COLLECTION_VIEW, projectCollection, readCollectionView, selectExplorerPage, updateCollectionView, withCollectionView } from './collectionExplorer'
import type { ExplorerPolicy } from './collectionExplorer'

const records = [
  { id: 'B', archived: false, revision: 4, state: 'waiting', title: 'North review' },
  { id: 'A', archived: false, revision: 4, state: 'ready', title: 'South review' },
  { id: 'C', archived: true, revision: 5, state: 'waiting', title: 'North archive' },
]
const policy: ExplorerPolicy<(typeof records)[number]> = {
  searchText: item => item.id + ' ' + item.title, revision: item => item.revision, state: item => item.state,
  states: [{ value: 'waiting', label: 'Waiting' }, { value: 'ready', label: 'Ready' }],
}
describe('collection navigation projection', () => {
  it('combines lifecycle, case-insensitive search, and domain state without mutation', () => {
    const before = JSON.stringify(records)
    expect(projectCollection(records, { ...DEFAULT_COLLECTION_VIEW, query: ' NORTH ', state: 'waiting' }, policy).rows.map(item => item.id)).toEqual(['B'])
    expect(JSON.stringify(records)).toBe(before)
    expect(projectCollection(records, { ...DEFAULT_COLLECTION_VIEW, scope: 'archived', query: 'north' }, policy).rows.map(item => item.id)).toEqual(['C'])
  })
  it('uses identity tie-breakers for equal revisions and sorts before paging', () => {
    expect(projectCollection(records, { ...DEFAULT_COLLECTION_VIEW, sort: 'revision-desc', scope: 'all' }, policy).rows.map(item => item.id)).toEqual(['C', 'A', 'B'])
    expect(projectCollection(records, { ...DEFAULT_COLLECTION_VIEW, sort: 'id-desc' }, policy).rows.map(item => item.id)).toEqual(['B', 'A'])
  })
  it('clamps pages after the result set shrinks and handles an empty view', () => {
    const result = projectCollection(records, { ...DEFAULT_COLLECTION_VIEW, page: 999 }, policy)
    expect(result.page).toBe(1)
    expect(result.matchingCount).toBe(2)
    const empty = projectCollection(records, { ...DEFAULT_COLLECTION_VIEW, page: 999, query: 'missing' }, policy)
    expect(empty).toMatchObject({ rows: [], page: 1, pageCount: 1, matchingCount: 0, totalCount: 3 })
  })
  it.each(['-1', '0', '1.5', 'Infinity', '999999999', 'x'])('falls back safely for invalid page %s', page => {
    expect(readCollectionView(new URLSearchParams({ page }), policy.states).page).toBe(1)
  })
  it('normalizes invalid enums and bounds search text from an external URL', () => {
    const view = readCollectionView(new URLSearchParams({ show: 'deleted', state: 'unknown', sort: 'random', size: '100000', q: 'x'.repeat(500) }), policy.states)
    expect(view).toEqual({ ...DEFAULT_COLLECTION_VIEW, query: 'x'.repeat(200) })
  })
  it('resets page on a changed filter while preserving selected identity and unrelated parameters', () => {
    const source = new URLSearchParams('record=B&tab=evidence&page=9&size=5')
    const next = updateCollectionView(source, { state: 'waiting' }, policy.states)
    expect(next.get('record')).toBe('B')
    expect(next.get('tab')).toBe('evidence')
    expect(next.get('page')).toBeNull()
    expect(next.get('size')).toBe('5')
    expect(source.get('state')).toBeNull()
  })
  it('retains page for an unchanged filter and accepts deliberate page navigation', () => {
    const source = new URLSearchParams('page=3&q=north')
    expect(updateCollectionView(source, { query: 'north' }, policy.states).get('page')).toBe('3')
    expect(updateCollectionView(source, { page: 2 }, policy.states).get('page')).toBe('2')
  })
  it('selects and clears only the visible page without dropping hidden identities', () => {
    expect(selectExplorerPage(['hidden', 'A'], ['A', 'B'], true)).toEqual(['hidden', 'A', 'B'])
    expect(selectExplorerPage(['hidden', 'A', 'B'], ['A', 'B'], false)).toEqual(['hidden'])
    expect(selectExplorerPage(['A', 'A'], [], true)).toEqual(['A'])
  })
  it('round-trips list context while forcing the actual selected entity on return', () => {
    const link = withCollectionView('/detail?record=B', new URLSearchParams('record=A&q=north&sort=id-desc&page=2&tab=work'))
    const detail = new URL(link, 'https://test.invalid')
    expect(collectionBackPath('/workspace', 'record', 'B', detail.searchParams)).toBe('/workspace?record=B&q=north&sort=id-desc&page=2&tab=work')
  })
  it('never accepts a return destination from URL content or nests view tokens', () => {
    const params = new URLSearchParams({ view: 'view=nested&https://evil.invalid/path=attack' })
    const path = collectionBackPath('/workspace', 'record', 'A', params)
    expect(path.startsWith('/workspace?')).toBe(true)
    expect(new URL(path, 'https://test.invalid').origin).toBe('https://test.invalid')
    expect(new URL(path, 'https://test.invalid').searchParams.has('view')).toBe(false)
    expect(withCollectionView('/detail', new URLSearchParams({ view: 'old' }))).toBe('/detail')
  })
  it('drops oversized return context without losing the selected identity', () => {
    expect(collectionBackPath('/workspace', 'record', 'A', new URLSearchParams({ view: 'x'.repeat(4001) }))).toBe('/workspace?record=A')
  })
})
