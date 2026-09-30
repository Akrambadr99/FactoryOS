import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRecoveryBoundary, RouteRecovery, WorkflowRecovery } from './WorkflowRecovery'
import { StoredDataError } from './storageValidation'
import { RecordScope } from './RecordScope'

afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const failure = () => new StoredDataError('product:collection:v1', 'read', 'Invalid saved data at $.records[0].revision.')
function Broken(): never { throw new Error('SECRET raw exception') }
describe('non-destructive workflow recovery', () => {
  it('routes typed selected-record corruption to the recovery screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([{ path: '/', element: <RecordScope id="A" back="/" open={() => { throw failure() }}>Hidden</RecordScope>, errorElement: <RouteRecovery productName="Product" /> }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Saved workspace data needs attention')
    expect(screen.getByRole('button', { name: 'Download recovery copy' })).toBeVisible()
  })
  it('keeps a missing-record error inline instead of implying saved-data corruption', async () => {
    const router = createMemoryRouter([{ path: '/', element: <RecordScope id="missing" back="/" open={() => { throw new Error('Record not found') }}>Hidden</RecordScope>, errorElement: <RouteRecovery productName="Product" /> }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Record not found')
    expect(screen.queryByRole('button', { name: 'Download recovery copy' })).not.toBeInTheDocument()
  })
  it('focuses the recovery title and provides native keyboard actions', () => {
    render(<WorkflowRecovery error={failure()} productName="Product" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Retry this page' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Return to overview' })).toHaveAttribute('href', '/')
    expect(screen.getByText(/not a validated backup/)).toBeVisible()
  })
  it('does not expose raw exceptions or offer an unrelated export for generic render failures', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<AppRecoveryBoundary productName="Product"><Broken /></AppRecoveryBoundary>)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This screen could not be opened')
    expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download recovery copy' })).not.toBeInTheDocument()
  })
  it('handles router render errors without the default developer stack trace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <RouteRecovery productName="Product" /> }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('This screen could not be opened')
  })
  it('exports only the requested raw entry without altering any saved values', async () => {
    const user = userEvent.setup(); const raw = '{damaged-private-text'
    window.localStorage.setItem('product:collection:v1', raw)
    window.localStorage.setItem('unrelated:private', 'keep')
    const create = vi.fn(() => 'blob:recovery')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<WorkflowRecovery error={failure()} productName="Product" />)
    expect(create).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Download recovery copy' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    expect(window.localStorage.getItem('product:collection:v1')).toBe(raw)
    expect(window.localStorage.getItem('unrelated:private')).toBe('keep')
    expect(screen.getByRole('status')).toHaveTextContent('Keep this file private')
  })
  it('announces a missing entry instead of claiming a successful export', async () => {
    render(<WorkflowRecovery error={failure()} productName="Product" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download recovery copy' }))
    expect(screen.getByRole('status')).toHaveTextContent('Nothing was downloaded')
  })
  it('allows retrying a denied download without clearing storage', async () => {
    window.localStorage.setItem('product:collection:v1', 'keep')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('private native failure') })
    render(<WorkflowRecovery error={failure()} productName="Product" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download recovery copy' }))
    expect(screen.getByRole('status')).toHaveTextContent('could not be downloaded')
    expect(screen.getByRole('button', { name: 'Download recovery copy' })).toBeEnabled()
    expect(screen.queryByText(/private native failure/)).not.toBeInTheDocument()
  })
})
