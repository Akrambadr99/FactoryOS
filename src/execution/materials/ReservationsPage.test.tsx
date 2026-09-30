import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOrder, seedOrderCollection } from '../order-machine/orderCollection'
import { ReservationsPage } from './ReservationsPage'
import { ReservationClientError, type ReservationClient } from './reservationClient'
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
  const execute = vi.fn<ReservationClient['execute']>().mockImplementation(command => {
    const result = applyReservationCommand(state, command)
    state = result.state
    return Promise.resolve({ snapshot: result.snapshot, replayed: result.replayed })
  })
  const client: ReservationClient = { read, execute }
  const mounted = render(<MemoryRouter initialEntries={[url]}><ReservationsPage client={client} /><LocationProbe /></MemoryRouter>)
  return { ...mounted, read, execute, user: userEvent.setup() }
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
