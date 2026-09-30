import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrder, seedOrderCollection } from '../order-machine/orderCollection'
import { ReservationsPage } from './ReservationsPage'
import { ReservationClientError, type ReservationClient } from './reservationClient'
import { createOrderSyncPreview } from './orderSyncPreview'
import { applyReservationCommand, createReservationState, reservationSnapshot, type ReservationState } from './reservations'

const collectionKey = 'factoryos:production-orders:v1'
const source = createOrder(seedOrderCollection(), 'PO-9901', 'assembly', 'LOT-55')
const syncId = '00000000-0000-4000-8000-000000000001'
const reserveId = '00000000-0000-4000-8000-000000000002'
const synced = applyReservationCommand(createReservationState(), {
  kind: 'sync-orders', requestId: syncId, expectedRevision: 0, collection: source,
}).state
type Result = Awaited<ReturnType<ReservationClient['execute']>>
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function LocationProbe() {
  const location = useLocation(), navigate = useNavigate()
  return <><output aria-label="Current address">{location.search}</output>
    <button onClick={() => { void navigate(-1) }}>Back in test history</button>
    <button onClick={() => { void navigate(1) }}>Forward in test history</button></>
}
function setup(initial: ReservationState = synced, url = '/execution/reservations?order=PO-8842&source=unit-proof') {
  localStorage.clear()
  localStorage.setItem(collectionKey, JSON.stringify(source))
  localStorage.setItem('reservation:unrelated', 'retained unrelated bytes')
  let state = initial
  const read = vi.fn<ReservationClient['read']>().mockImplementation(() => Promise.resolve(reservationSnapshot(state)))
  const previewOrders = vi.fn<ReservationClient['previewOrders']>().mockImplementation(collection => Promise.resolve({
    snapshot: reservationSnapshot(state), preview: createOrderSyncPreview(reservationSnapshot(state), collection),
  }))
  const execute = vi.fn<ReservationClient['execute']>().mockImplementation(command => {
    const result = applyReservationCommand(state, command)
    state = result.state
    return Promise.resolve({ snapshot: result.snapshot, replayed: result.replayed })
  })
  const client: ReservationClient = { read, execute, previewOrders }
  const mounted = render(<MemoryRouter initialEntries={[url]}><ReservationsPage client={client} /><LocationProbe /></MemoryRouter>)
  return { ...mounted, read, execute, previewOrders, user: userEvent.setup() }
}
async function connect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Connect reservation service' }))
  await screen.findByRole('button', { name: 'Refresh reservations' })
}
function draft(quantity = '20', note = 'Production planning hold') {
  fireEvent.change(screen.getByLabelText('Stock lot'), { target: { value: 'MAT-ALLOY' } })
  fireEvent.change(screen.getByLabelText('Units to reserve'), { target: { value: quantity } })
  fireEvent.change(screen.getByLabelText('Reservation note'), { target: { value: note } })
}
async function resolve<T>(pending: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => { pending.resolve(value); await Promise.resolve() })
}
async function reject<T>(pending: ReturnType<typeof deferred<T>>) {
  await act(async () => { pending.reject(new ReservationClientError('connection', 'Connection lost. Retry the same request.')); await Promise.resolve() })
}
afterEach(() => { vi.restoreAllMocks() })

describe('material reservation workbench interaction', () => {
  it('reveals storage upgrade guidance without connecting or changing saved records', async () => {
    const { user, read, execute } = setup()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const guidance = screen.getByText('Upgrading an existing JSON ledger?')
    expect(guidance.closest('details')).not.toHaveAttribute('open')
    await user.click(guidance)
    expect(guidance.closest('details')).toHaveAttribute('open')
    expect(screen.getByText('npm run reservations:migrate -- preview')).toBeVisible()
    expect(screen.getByText(/Apply requires that exact checksum/)).toBeVisible()
    expect(read).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
  })

  it('contacts the optional service only after explicit connection and never writes browser execution data', async () => {
    const { user, read, execute } = setup()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    expect(read).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await connect(user)
    expect(read).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'PO-8842' })).toBeVisible()
    expect(write).not.toHaveBeenCalled()
  })

  it('composes rapid selection and filtering before the next render without restoring stale URL state', async () => {
    const { user } = setup()
    await connect(user)
    const selection = screen.getByRole('button', { name: 'Select order PO-9901' })
    const search = screen.getByRole('searchbox', { name: 'Find order' })
    act(() => {
      fireEvent.click(selection)
      fireEvent.change(search, { target: { value: 'PO-8842' } })
    })
    expect(screen.getByLabelText('Current address')).toHaveTextContent('order=PO-9901')
    expect(screen.getByLabelText('Current address')).toHaveTextContent('q=PO-8842')
    expect(screen.getByLabelText('Current address')).toHaveTextContent('source=unit-proof')
    expect(screen.getByRole('heading', { name: 'PO-9901' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Select order PO-9901' })).not.toBeInTheDocument()
  })

  it('uses restored browser-history selection when filtering after Back and Forward navigation', async () => {
    const { user } = setup()
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Select order PO-9901' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find order' }), { target: { value: 'PO-8842' } })
    await user.click(screen.getByRole('button', { name: 'Back in test history' }))
    expect(screen.getByRole('heading', { name: 'PO-8842' })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Find order' })).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Forward in test history' }))
    expect(screen.getByRole('heading', { name: 'PO-9901' })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Find order' })).toHaveValue('PO-8842')
    await user.click(screen.getByRole('button', { name: 'Back in test history' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find order' }), { target: { value: 'PO-9901' } })
    expect(screen.getByLabelText('Current address')).toHaveTextContent('order=PO-8842')
    expect(screen.getByLabelText('Current address')).toHaveTextContent('q=PO-9901')
    expect(screen.getByLabelText('Current address')).toHaveTextContent('source=unit-proof')
    expect(screen.getByRole('heading', { name: 'PO-8842' })).toBeVisible()
  })

  it('preserves per-order drafts and selection outside filters without dropping unrelated URL context', async () => {
    const { user } = setup()
    await connect(user)
    draft('18', 'First order draft')
    await user.click(screen.getByRole('button', { name: 'Select order PO-9901' }))
    draft('29', 'Second order draft')
    await user.click(screen.getByRole('button', { name: 'Select order PO-8842' }))
    expect(screen.getByLabelText('Units to reserve')).toHaveValue(18)
    expect(screen.getByLabelText('Reservation note')).toHaveValue('First order draft')
    await user.type(screen.getByLabelText('Find order'), 'PO-9901')
    expect(screen.queryByRole('button', { name: 'Select order PO-8842' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'PO-8842' })).toBeVisible()
    expect(screen.getByLabelText('Current address')).toHaveTextContent('order=PO-8842')
    expect(screen.getByLabelText('Current address')).toHaveTextContent('source=unit-proof')
    await user.click(screen.getByRole('button', { name: 'Select order PO-9901' }))
    expect(screen.getByLabelText('Units to reserve')).toHaveValue(29)
  })

  it('retries a frozen reservation request after failure while preserving newer edits and selection', async () => {
    const { user, execute } = setup()
    const pending = deferred<Result>()
    execute.mockReturnValueOnce(pending.promise)
    await connect(user)
    draft('20', 'Captured first order note')
    await user.click(screen.getByRole('button', { name: 'Reserve material' }))
    const captured = execute.mock.calls[0]![0]
    expect(captured).toMatchObject({ kind: 'reserve', expectedRevision: 1, orderId: 'PO-8842', quantity: 20, note: 'Captured first order note' })
    draft('35', 'Newer first order draft')
    await user.click(screen.getByRole('button', { name: 'Select order PO-9901' }))
    draft('11', 'Other order untouched draft')
    await reject(pending)
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Reserve material' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Retry same request' }))
    expect(execute.mock.calls[1]![0]).toEqual(captured)
    expect(screen.getByRole('heading', { name: 'PO-9901' })).toBeVisible()
    expect(screen.getByLabelText('Reservation note')).toHaveValue('Other order untouched draft')
    await user.click(screen.getByRole('button', { name: 'Select order PO-8842' }))
    expect(screen.getByLabelText('Units to reserve')).toHaveValue(35)
    expect(screen.getByLabelText('Reservation note')).toHaveValue('Newer first order draft')
  })

  it('requires refresh, discard and a new explicit submit after a revision conflict', async () => {
    const { user, read, execute } = setup()
    execute.mockRejectedValueOnce(new ReservationClientError('revision_conflict', 'The service revision changed. Refresh before retrying.'))
    await connect(user)
    draft('20', 'Retained conflict draft')
    await user.click(screen.getByRole('button', { name: 'Reserve material' }))
    const captured = execute.mock.calls[0]![0]
    const other = applyReservationCommand(synced, { kind: 'reserve', requestId: reserveId, expectedRevision: 1,
      orderId: 'PO-9901', lotId: 'MAT-ALLOY', quantity: 10, note: 'Other operator allocation' })
    read.mockResolvedValueOnce(other.snapshot)
    execute.mockImplementationOnce(command => {
      const result = applyReservationCommand(other.state, command)
      return Promise.resolve({ snapshot: result.snapshot, replayed: result.replayed })
    })
    await user.click(screen.getByRole('button', { name: 'Refresh reservations' }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Reserve material' })).toBeDisabled()
    expect(screen.getByLabelText('Reservation note')).toHaveValue('Retained conflict draft')
    await user.click(screen.getByRole('button', { name: 'Discard pending request' }))
    await user.click(screen.getByRole('button', { name: 'Reserve material' }))
    expect(execute.mock.calls[1]![0]).toMatchObject({ kind: 'reserve', expectedRevision: 2, quantity: 20, note: 'Retained conflict draft' })
    expect(execute.mock.calls[1]![0].requestId).not.toBe(captured.requestId)
  })

  it('does not roll back a successful reservation when an older refresh response arrives late', async () => {
    const { user, read, execute } = setup()
    const pending = deferred<ReturnType<typeof reservationSnapshot>>()
    await connect(user)
    read.mockReturnValueOnce(pending.promise)
    await user.click(screen.getByRole('button', { name: 'Refresh reservations' }))
    draft('20', 'Newer saved reservation')
    await user.click(screen.getByRole('button', { name: 'Reserve material' }))
    const savedId = execute.mock.calls[0]![0].requestId
    await resolve(pending, reservationSnapshot(synced))
    expect(screen.getByRole('button', { name: 'Release ' + savedId })).toBeVisible()
    expect(screen.getByText(/Ledger revision 2/)).toBeVisible()
  })

  it('preserves a draft but requires a compatible lot after an imported order changes production line', async () => {
    const { user, read } = setup()
    await connect(user)
    draft('20', 'Keep my planning notes')
    const collection = { ...source, orders: source.orders.map(order => order.id === 'PO-8842' ? { ...order, line: 'packaging', lotIndexId: 'LOT-76' } : order) }
    const changed = applyReservationCommand(synced, { kind: 'sync-orders', requestId: '00000000-0000-4000-8000-000000000090', expectedRevision: 1, collection })
    read.mockResolvedValueOnce(changed.snapshot)
    await user.click(screen.getByRole('button', { name: 'Refresh reservations' }))
    expect(screen.getByText(/draft lot is not compatible/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Reserve material' })).toBeDisabled()
    expect(screen.getByLabelText('Units to reserve')).toHaveValue(20)
    expect(screen.getByLabelText('Reservation note')).toHaveValue('Keep my planning notes')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stock lot' }), 'MAT-PACK')
    expect(screen.getByRole('button', { name: 'Reserve material' })).toBeEnabled()
  })

  it('captures the saved-order collection for sync and retries it unchanged after local source edits', async () => {
    const { user, execute } = setup(createReservationState())
    const pending = deferred<Result>()
    execute.mockReturnValueOnce(pending.promise)
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    expect(execute).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm order sync' }))
    const captured = execute.mock.calls[0]![0]
    expect(captured).toMatchObject({ kind: 'sync-orders', expectedRevision: 0, collection: source })
    localStorage.setItem(collectionKey, JSON.stringify(createOrder(source, 'PO-9902', 'packaging', 'LOT-76')))
    await reject(pending)
    await user.click(screen.getByRole('button', { name: 'Retry same request' }))
    expect(execute.mock.calls[1]![0]).toEqual(captured)
    expect(screen.queryByRole('button', { name: 'Select order PO-9902' })).not.toBeInTheDocument()
    expect(localStorage.getItem(collectionKey)).toContain('PO-9902')
    expect(localStorage.getItem('reservation:unrelated')).toBe('retained unrelated bytes')
  })

  it('reviews without writes, focuses the review heading, and restores focus when cancelled', async () => {
    const { user, previewOrders, execute } = setup(createReservationState())
    const write = vi.spyOn(Storage.prototype, 'setItem')
    await connect(user)
    const trigger = screen.getByRole('button', { name: 'Sync saved orders' })
    trigger.focus(); await user.keyboard('{Enter}')
    expect(previewOrders.mock.calls[0]![0]).toEqual(source)
    expect(screen.getByRole('heading', { name: 'Review order synchronization' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Confirm order sync' })).toBeEnabled()
    expect(execute).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel sync review' }))
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('region', { name: 'Review order synchronization' })).not.toBeInTheDocument()
    expect(execute).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Current address')).toHaveTextContent('order=PO-8842&source=unit-proof')
  })

  it('requires another review if saved source changes before first confirmation', async () => {
    const { user, execute } = setup(createReservationState())
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    localStorage.setItem(collectionKey, JSON.stringify(createOrder(source, 'PO-9902', 'packaging', 'LOT-76')))
    await user.click(screen.getByRole('button', { name: 'Confirm order sync' }))
    expect(execute).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm order sync' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('changed after review')
    await user.click(screen.getByRole('button', { name: 'Review latest saved orders' }))
    await user.click(screen.getByRole('button', { name: 'Confirm order sync' }))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Select order PO-9902' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Review order synchronization' })).not.toBeInTheDocument()
  })

  it('rejects an unreadable source after review without sending or replacing it', async () => {
    const { user, execute } = setup(createReservationState())
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    localStorage.setItem(collectionKey, '{broken')
    await user.click(screen.getByRole('button', { name: 'Confirm order sync' }))
    expect(screen.getByRole('alert')).toHaveTextContent('cannot be verified now')
    expect(screen.getByRole('button', { name: 'Confirm order sync' })).toBeDisabled()
    expect(execute).not.toHaveBeenCalled()
    expect(localStorage.getItem(collectionKey)).toBe('{broken')
  })

  it('does not create no-op history and preserves reservation drafts during review', async () => {
    const { user, execute } = setup()
    await connect(user); draft('21', 'Keep this unsent note')
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    expect(screen.getByText(/Order references already match/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm order sync' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Cancel sync review' }))
    expect(screen.getByLabelText('Units to reserve')).toHaveValue(21)
    expect(screen.getByLabelText('Reservation note')).toHaveValue('Keep this unsent note')
    expect(execute).not.toHaveBeenCalled()
  })

  it('merges rapid edits into the latest order draft before a sync review', async () => {
    const { user } = setup()
    await connect(user)
    const units = screen.getByLabelText('Units to reserve'), note = screen.getByLabelText('Reservation note')
    act(() => {
      fireEvent.change(units, { target: { value: '17' } })
      fireEvent.change(note, { target: { value: 'Rapidly entered planner note' } })
    })
    expect(units).toHaveValue(17)
    expect(note).toHaveValue('Rapidly entered planner note')
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    await user.click(screen.getByRole('button', { name: 'Cancel sync review' }))
    expect(units).toHaveValue(17)
    expect(note).toHaveValue('Rapidly entered planner note')
  })

  it('requires removal acknowledgement, keeps full replacement semantics when filtered, and resets acknowledgement on re-review', async () => {
    const { user, execute } = setup()
    const reduced = { ...source, orders: source.orders.filter(order => order.id !== 'PO-9901') }
    localStorage.setItem(collectionKey, JSON.stringify(reduced))
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    const label = 'I understand removed order references leave this ledger; recorded history stays.'
    expect(screen.getByRole('button', { name: 'Confirm order sync' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: label }))
    expect(screen.getByRole('button', { name: 'Confirm order sync' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Review latest saved orders' }))
    expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: label }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Review changes' }), 'added')
    expect(screen.getByText(/No changes match this filter/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm order sync' }))
    expect(execute.mock.calls[0]![0]).toMatchObject({ kind: 'sync-orders', collection: reduced, expectedRevision: 1 })
  })

  it('shows changed fields and blocks the complete review when an affected order has an active hold', async () => {
    const reserved = applyReservationCommand(synced, { kind: 'reserve', requestId: reserveId, expectedRevision: 1,
      orderId: 'PO-8842', lotId: 'MAT-ALLOY', quantity: 20, note: 'Existing held order' }).state
    const { user, execute } = setup(reserved)
    const changed = { ...source, orders: source.orders.map(order => order.id === 'PO-8842' ? { ...order, archived: true } : order) }
    localStorage.setItem(collectionKey, JSON.stringify(changed))
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    expect(screen.getByText(/1 changed orders have active material holds/)).toBeVisible()
    expect(screen.getByText('Before: Active')).toBeVisible()
    expect(screen.getByText('After: Archived')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirm order sync' })).toBeDisabled()
    expect(execute).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel sync review' }))
    expect(screen.getByRole('button', { name: 'Release ' + reserveId })).toBeEnabled()
  })

  it('ignores a preview arriving after refresh and aborts the cancelled request', async () => {
    const { user, previewOrders, execute } = setup(createReservationState())
    const response = deferred<Awaited<ReturnType<ReservationClient['previewOrders']>>>()
    previewOrders.mockReturnValueOnce(response.promise)
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    const signal = previewOrders.mock.calls[0]![1]
    expect(screen.getByRole('heading', { name: 'Preparing order review' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Refresh reservations' }))
    expect(signal?.aborted).toBe(true)
    const snapshot = reservationSnapshot(createReservationState())
    await resolve(response, { snapshot, preview: createOrderSyncPreview(snapshot, source) })
    expect(screen.queryByRole('region', { name: 'Review order synchronization' })).not.toBeInTheDocument()
    expect(execute).not.toHaveBeenCalled()
  })

  it('ignores a late preview after a reservation write and preserves the newer revision', async () => {
    const { user, previewOrders } = setup()
    const response = deferred<Awaited<ReturnType<ReservationClient['previewOrders']>>>()
    previewOrders.mockReturnValueOnce(response.promise)
    await connect(user); draft('20', 'Write while preview waits')
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    await user.click(screen.getByRole('button', { name: 'Reserve material' }))
    const snapshot = reservationSnapshot(synced)
    await resolve(response, { snapshot, preview: createOrderSyncPreview(snapshot, source) })
    expect(screen.queryByRole('region', { name: 'Review order synchronization' })).not.toBeInTheDocument()
    expect(screen.getByText(/Ledger revision 2/)).toBeVisible()
  })

  it('does not steal newer draft focus when a delayed review arrives', async () => {
    const { user, previewOrders } = setup()
    const response = deferred<Awaited<ReturnType<ReservationClient['previewOrders']>>>()
    previewOrders.mockReturnValueOnce(response.promise)
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    const note = screen.getByLabelText('Reservation note')
    await user.click(note); fireEvent.change(note, { target: { value: 'Keep editing while preview loads' } })
    const snapshot = reservationSnapshot(synced)
    await resolve(response, { snapshot, preview: createOrderSyncPreview(snapshot, source) })
    expect(screen.getByRole('region', { name: 'Review order synchronization' })).toBeVisible()
    expect(note).toHaveFocus()
    expect(note).toHaveValue('Keep editing while preview loads')
  })

  it('invalidates a delayed review when opening a release decision and keeps dialog focus', async () => {
    const reserved = applyReservationCommand(synced, { kind: 'reserve', requestId: reserveId, expectedRevision: 1,
      orderId: 'PO-8842', lotId: 'MAT-ALLOY', quantity: 20, note: 'Hold for review focus test' }).state
    const { user, previewOrders } = setup(reserved)
    const response = deferred<Awaited<ReturnType<ReservationClient['previewOrders']>>>()
    previewOrders.mockReturnValueOnce(response.promise)
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    const signal = previewOrders.mock.calls[0]![1]
    await user.click(screen.getByRole('button', { name: 'Release ' + reserveId }))
    const reason = screen.getByLabelText('Release reason')
    await user.click(reason)
    const snapshot = reservationSnapshot(reserved)
    await resolve(response, { snapshot, preview: createOrderSyncPreview(snapshot, source) })
    expect(screen.queryByRole('region', { name: 'Review order synchronization' })).not.toBeInTheDocument()
    expect(signal?.aborted).toBe(true)
    expect(reason).toHaveFocus()
  })

  it('recovers from preview errors only on an explicit retry and cancels on unmount', async () => {
    const { user, previewOrders, execute, unmount } = setup(createReservationState())
    previewOrders.mockRejectedValueOnce(new ReservationClientError('connection', 'Preview service unavailable.'))
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    expect(screen.getByRole('heading', { name: 'Order review unavailable' })).toBeVisible()
    expect(execute).not.toHaveBeenCalled()
    const response = deferred<Awaited<ReturnType<ReservationClient['previewOrders']>>>()
    previewOrders.mockReturnValueOnce(response.promise)
    await user.click(screen.getByRole('button', { name: 'Review latest saved orders' }))
    const signal = previewOrders.mock.calls.at(-1)![1]
    unmount(); expect(signal?.aborted).toBe(true)
    const snapshot = reservationSnapshot(createReservationState())
    await resolve(response, { snapshot, preview: createOrderSyncPreview(snapshot, source) })
  })

  it('paginates review changes, resets pagination on filter, and preserves the selected order URL', async () => {
    const { user } = setup(createReservationState())
    let large = source
    for (let index = 0; index < 12; index++) large = createOrder(large, 'PO-' + String(7000 + index), 'assembly', 'LOT-55')
    localStorage.setItem(collectionKey, JSON.stringify(large))
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Sync saved orders' }))
    const review = screen.getByRole('region', { name: 'Review order synchronization' })
    expect(within(review).getByText(/Page 1 of 3/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next changes' }))
    expect(within(review).getByText(/Page 2 of 3/)).toBeVisible()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find changed order' }), { target: { value: 'PO-7000' } })
    expect(within(review).getByText(/1 matching changes · Page 1 of 1/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Previous changes' })).toBeDisabled()
    expect(screen.getByLabelText('Current address')).toHaveTextContent('order=PO-8842&source=unit-proof')
  })

  it('supports keyboard cancellation with restored focus and a focused release reason before committing', async () => {
    const reserved = applyReservationCommand(synced, { kind: 'reserve', requestId: reserveId, expectedRevision: 1,
      orderId: 'PO-8842', lotId: 'MAT-ALLOY', quantity: 20, note: 'Release example allocation' })
    const { user, execute } = setup(reserved.state)
    await connect(user)
    const trigger = screen.getByRole('button', { name: 'Release ' + reserveId })
    trigger.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'Release material reservation' })
    expect(dialog).toBeVisible()
    await user.type(within(dialog).getByLabelText('Release reason'), 'Changed production plan')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(execute).not.toHaveBeenCalled()
    await user.click(trigger)
    fireEvent.change(screen.getByLabelText('Release reason'), { target: { value: 'Changed production plan' } })
    await user.click(screen.getByRole('button', { name: 'Release reservation' }))
    expect(execute.mock.calls[0]![0]).toMatchObject({ kind: 'release', expectedRevision: 2, reservationId: reserveId, reason: 'Changed production plan' })
  })

  it('focuses an actionable retry after release failure and preserves the captured request and reason', async () => {
    const reserved = applyReservationCommand(synced, { kind: 'reserve', requestId: reserveId, expectedRevision: 1,
      orderId: 'PO-8842', lotId: 'MAT-ALLOY', quantity: 20, note: 'Release failure example' })
    const { user, execute } = setup(reserved.state)
    execute.mockRejectedValueOnce(new ReservationClientError('connection', 'The release request could not be confirmed. Retry the same request.'))
    await connect(user)
    const trigger = screen.getByRole('button', { name: 'Release ' + reserveId })
    trigger.focus()
    await user.keyboard('{Enter}')
    fireEvent.change(screen.getByRole('textbox', { name: 'Release reason' }), { target: { value: 'Changed production plan' } })
    await user.click(screen.getByRole('button', { name: 'Release reservation' }))
    const captured = execute.mock.calls[0]![0]
    expect(captured).toMatchObject({ kind: 'release', expectedRevision: 2, reservationId: reserveId, reason: 'Changed production plan' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The release request could not be confirmed')
    const retry = screen.getByRole('button', { name: 'Retry same request' })
    expect(retry).toBeEnabled()
    expect(retry).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(execute.mock.calls[1]![0]).toEqual(captured)
    expect(screen.queryByRole('button', { name: 'Release ' + reserveId })).not.toBeInTheDocument()
    expect(screen.getByText('Release: Changed production plan')).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Material reservations workspace' })).getByRole('status')).toHaveFocus()
  })

  it('does not steal focus from a newer draft when a delayed release failure arrives', async () => {
    const reserved = applyReservationCommand(synced, { kind: 'reserve', requestId: reserveId, expectedRevision: 1,
      orderId: 'PO-8842', lotId: 'MAT-ALLOY', quantity: 20, note: 'Delayed release example' })
    const { user, execute } = setup(reserved.state)
    const pending = deferred<Result>()
    execute.mockReturnValueOnce(pending.promise)
    await connect(user)
    await user.click(screen.getByRole('button', { name: 'Release ' + reserveId }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Release reason' }), { target: { value: 'Original release reason' } })
    await user.click(screen.getByRole('button', { name: 'Release reservation' }))
    const note = screen.getByRole('textbox', { name: 'Reservation note' })
    await user.click(note)
    fireEvent.change(note, { target: { value: 'Newer unsent planning note' } })
    await reject(pending)
    expect(note).toHaveFocus()
    expect(note).toHaveValue('Newer unsent planning note')
    expect(screen.getByRole('button', { name: 'Retry same request' })).toBeEnabled()
    expect(execute.mock.calls[0]![0]).toMatchObject({ kind: 'release', reason: 'Original release reason' })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each(['read', 'execute'] as const)('aborts a pending %s on unmount without applying its late result', async operation => {
    const { user, read, execute, unmount } = setup()
    const pendingRead = deferred<ReturnType<typeof reservationSnapshot>>()
    const pendingSave = deferred<Result>()
    if (operation === 'read') read.mockReturnValueOnce(pendingRead.promise)
    if (operation === 'execute') execute.mockReturnValueOnce(pendingSave.promise)
    await user.click(screen.getByRole('button', { name: 'Connect reservation service' }))
    if (operation === 'execute') {
      draft()
      await user.click(screen.getByRole('button', { name: 'Reserve material' }))
    }
    const signal = operation === 'read' ? read.mock.calls.at(-1)?.[0] : execute.mock.calls.at(-1)?.[1]
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
    await resolve(pendingRead, reservationSnapshot(synced))
    await resolve(pendingSave, { snapshot: reservationSnapshot(synced), replayed: false })
    expect(screen.queryByRole('button', { name: 'Refresh reservations' })).not.toBeInTheDocument()
  })
})
