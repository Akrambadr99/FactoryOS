import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ExplorerControls, ExplorerPagination, ExplorerSelection } from './CollectionExplorerControls'
import { useCollectionExplorer } from './useCollectionExplorer'
import type { ExplorerPolicy } from './collectionExplorer'

const records = Array.from({ length: 7 }, (_, index) => ({ id: 'ID-' + String(index + 1), archived: index === 5, revision: index, state: 'ready' }))
const policy: ExplorerPolicy<(typeof records)[number]> = { searchText: item => item.id, revision: item => item.revision, state: item => item.state, states: [{ value: 'ready', label: 'Ready' }] }
function Harness() {
  const explorer = useCollectionExplorer(records, policy), location = useLocation()
  const [selected, setSelected] = useState(['ID-7'])
  return <>
    <ExplorerControls noun="records" view={explorer.view} states={policy.states} onChange={explorer.setView} onReset={explorer.reset} />
    <ul aria-label="Visible records">{explorer.rows.map(item => <li key={item.id}>{item.id}</li>)}</ul>
    <ExplorerPagination page={explorer.page} pageCount={explorer.pageCount} matchingCount={explorer.matchingCount} onPageChange={page => { explorer.setView({ page }) }} />
    <ExplorerSelection selected={selected} visible={explorer.rows.map(item => item.id)} onChange={setSelected} />
    <p data-testid="location">{location.search}</p>
  </>
}
function renderView(path: string) { return render(<MemoryRouter initialEntries={[path]}><Harness /></MemoryRouter>) }
describe('collection exploration controls', () => {
  it('restores a direct URL and updates query without losing entity context', async () => {
    const user = userEvent.setup()
    renderView('/?record=ID-7&show=all&sort=id-desc&size=5&page=2')
    expect(screen.getByLabelText('Show')).toHaveValue('all')
    expect(screen.getByLabelText('Sort records')).toHaveValue('id-desc')
    expect(screen.getByText('7 matching records · Page 2 of 2')).toBeVisible()
    await user.type(screen.getByLabelText('Search records'), 'ID-2')
    expect(screen.getByLabelText('Visible records')).toHaveTextContent('ID-2')
    expect(screen.getByTestId('location')).toHaveTextContent('record=ID-7')
    expect(screen.getByTestId('location')).not.toHaveTextContent('page=2')
  })
  it('exposes hidden selection and resets an empty view without clearing selected IDs', async () => {
    const user = userEvent.setup()
    renderView('/?record=ID-7&size=5')
    await user.click(screen.getByRole('button', { name: 'Select this page' }))
    expect(screen.getByText('6 records selected · 1 outside this page.')).toBeVisible()
    await user.type(screen.getByLabelText('Search records'), 'missing')
    expect(screen.getByText('6 records selected · 6 outside this page.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Select this page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(screen.getByText('6 records selected · 0 outside this page.')).toBeVisible()
    expect(screen.getByTestId('location')).toHaveTextContent('?record=ID-7')
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.getByText('0 records selected · 0 outside this page.')).toBeVisible()
  })
  it('navigates page boundaries with native keyboard-operable buttons', async () => {
    const user = userEvent.setup()
    renderView('/?size=5')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    screen.getByRole('button', { name: 'Next page' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('6 matching records · Page 2 of 2')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clear this page' }))
    expect(screen.getByText('0 records selected · 0 outside this page.')).toBeVisible()
  })
})
