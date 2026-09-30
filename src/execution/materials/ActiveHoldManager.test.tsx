import { useState, type Dispatch, type SetStateAction } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createOrder, seedOrderCollection } from '../order-machine/orderCollection'
import { applyReservationCommand, createReservationState, reservationSnapshot, type ReservationSnapshot } from './reservations'
import { ActiveHoldManager } from './ActiveHoldManager'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
function fixture(count: number) {
  let collection = seedOrderCollection()
  for (let index = 0; index < count; index++) collection = createOrder(collection, 'PO-' + String(7000 + index),
    index % 2 === 0 ? 'assembly' : 'packaging', index % 2 === 0 ? 'LOT-55' : 'LOT-76')
  let state = applyReservationCommand(createReservationState(), { kind: 'sync-orders', requestId: id(1), expectedRevision: 0, collection }).state
  for (let index = 0; index < count; index++) state = applyReservationCommand(state, { kind: 'reserve', requestId: id(100 + index),
    expectedRevision: state.revision, orderId: 'PO-' + String(7000 + index), lotId: index % 2 === 0 ? 'MAT-ALLOY' : 'MAT-PACK',
    quantity: 3, note: 'Planning hold for order ' + String(7000 + index) }).state
  return state
}
const many = fixture(28), snapshot = reservationSnapshot(many)
function Harness({ data = snapshot, initial = [], pending = false, onReview = () => undefined }: {
  data?: ReservationSnapshot; initial?: readonly string[]; pending?: boolean; onReview?: () => void
}) {
  const [selection, setSelection] = useState<readonly string[]>(initial)
  return <><ActiveHoldManager snapshot={data} selection={selection} onSelection={setSelection} onReview={onReview} pending={pending} />
    <div role="group" aria-label="Selected hold identities">{JSON.stringify(selection)}</div></>
}
async function expand(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByText('Manage active holds', { exact: true })) }
const checkbox = (index: number) => screen.getByRole('checkbox', { name: 'Select hold ' + id(100 + index) })
type SelectionAction = SetStateAction<readonly string[]>
function apply(action: SelectionAction | undefined, current: readonly string[]) {
  if (action === undefined) throw new Error('Missing selection update.')
  return typeof action === 'function' ? action(current) : action
}

describe('active hold selection workbench', () => {
  it('describes every stable checkbox name with its visible order, material, and quantity', async () => {
    render(<Harness />); const user = userEvent.setup(); await expand(user)
    expect(checkbox(0)).toHaveAccessibleName('Select hold ' + id(100))
    expect(checkbox(0)).toHaveAccessibleDescription('PO-7000 · MAT-ALLOY 3 units')
    expect(checkbox(1)).toHaveAccessibleDescription('PO-7001 · MAT-PACK 3 units')
    const references = checkbox(0).getAttribute('aria-describedby')?.split(' ') ?? []
    expect(references).toHaveLength(2)
    for (const reference of references) expect(document.getElementById(reference)).toBeVisible()
  })

  it('preserves hidden selections across search, production-line filters, and pagination', async () => {
    render(<Harness />); const user = userEvent.setup(); await expand(user)
    await user.click(checkbox(0)); await user.click(checkbox(1))
    await user.type(screen.getByLabelText('Find active hold'), '7000')
    expect(screen.getByRole('status')).toHaveTextContent('2 selected · 1 outside this view')
    await user.clear(screen.getByLabelText('Find active hold'))
    await user.selectOptions(screen.getByLabelText('Hold production line'), 'assembly')
    expect(checkbox(0)).toBeChecked(); expect(screen.getByRole('status')).toHaveTextContent('2 selected · 1 outside this view')
    await user.click(screen.getByRole('button', { name: 'Next holds' }))
    expect(screen.getByRole('status')).toHaveTextContent('2 selected · 2 outside this view')
    await user.selectOptions(screen.getByLabelText('Hold production line'), 'all')
    expect(screen.getByText('28 matching holds · Page 1 of 4')).toBeVisible()
    expect(checkbox(0)).toBeChecked(); expect(checkbox(1)).toBeChecked()
    expect(screen.getByLabelText('Selected hold identities')).toHaveTextContent(JSON.stringify([id(100), id(101)]))
  })

  it('enforces 25 across hidden pages without silently taking only part of the visible group', async () => {
    render(<Harness />); const user = userEvent.setup(); await expand(user)
    for (let page = 1; page <= 3; page++) {
      await user.click(screen.getByRole('button', { name: 'Select visible holds' }))
      await user.click(screen.getByRole('button', { name: 'Next holds' }))
    }
    expect(screen.getByRole('status')).toHaveTextContent('24 selected · 24 outside this view')
    expect(screen.getByRole('button', { name: 'Select visible holds' })).toBeDisabled()
    expect(checkbox(24)).not.toBeChecked(); expect(checkbox(27)).not.toBeChecked()
    await user.click(checkbox(24))
    expect(screen.getByRole('status')).toHaveTextContent('25 selected · 24 outside this view')
    expect(checkbox(24)).toBeEnabled(); expect(checkbox(25)).toBeDisabled()
    await user.click(checkbox(24)); await user.click(checkbox(25))
    expect(checkbox(25)).toBeChecked(); expect(checkbox(24)).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Clear hold selection' }))
    expect(screen.getByRole('status')).toHaveTextContent('0 selected · 0 outside this view')
  })

  it('allows newer selection edits while a request is pending but cannot start another review', async () => {
    const onReview = vi.fn()
    render(<Harness pending initial={[id(100)]} onReview={onReview} />)
    const user = userEvent.setup(); await expand(user)
    expect(screen.getByText(/Selection changes do not alter your pending request/)).toBeVisible()
    expect(checkbox(1)).toBeEnabled()
    await user.click(checkbox(1)); await user.click(checkbox(0))
    expect(screen.getByLabelText('Selected hold identities')).toHaveTextContent(JSON.stringify([id(101)]))
    expect(screen.getByRole('button', { name: 'Review selected releases' })).toBeDisabled()
    expect(onReview).not.toHaveBeenCalled()
  })

  it('retains unavailable selections after ledger refresh until explicit cleanup without dropping active hidden holds', async () => {
    const { rerender } = render(<Harness initial={[id(100), id(110)]} />)
    const user = userEvent.setup(); await expand(user)
    const released = applyReservationCommand(many, { kind: 'release', requestId: id(500), expectedRevision: many.revision,
      reservationId: id(100), reason: 'Released by another planner' }).snapshot
    rerender(<Harness data={released} initial={[id(100), id(110)]} />)
    expect(screen.getByLabelText('Selected hold identities')).toHaveTextContent(JSON.stringify([id(100), id(110)]))
    expect(screen.getByText(/1 selected holds are no longer active/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review selected releases' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Remove unavailable selections' }))
    expect(screen.getByLabelText('Selected hold identities')).toHaveTextContent(JSON.stringify([id(110)]))
    expect(screen.getByRole('status')).toHaveTextContent('1 selected · 1 outside this view')
    expect(screen.getByRole('button', { name: 'Review selected releases' })).toBeEnabled()
  })

  it('distinguishes no matching holds from no active holds and keeps selection cleanup explicit', async () => {
    const { rerender } = render(<Harness initial={[id(100)]} />)
    const user = userEvent.setup(); await expand(user)
    await user.type(screen.getByLabelText('Find active hold'), 'does-not-match')
    expect(screen.getByText(/No active holds match/)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent('1 selected · 1 outside this view')
    rerender(<Harness data={reservationSnapshot(createReservationState())} initial={[id(100)]} />)
    expect(screen.getByText(/No active holds remain/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remove unavailable selections' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Remove unavailable selections' }))
    expect(screen.getByRole('status')).toHaveTextContent('0 selected · 0 outside this view')
  })

  it('composes checkbox updates queued before the parent supplies new selection props', () => {
    const onSelection = vi.fn<Dispatch<SetStateAction<readonly string[]>>>()
    render(<ActiveHoldManager snapshot={snapshot} selection={[]} onSelection={onSelection} onReview={() => undefined} pending={false} />)
    fireEvent.click(screen.getByText('Manage active holds', { exact: true }))
    fireEvent.click(checkbox(0)); fireEvent.click(checkbox(1))
    const first = onSelection.mock.calls[0]?.[0], second = onSelection.mock.calls[1]?.[0]
    expect(typeof first).toBe('function'); expect(typeof second).toBe('function')
    expect(apply(second, apply(first, []))).toEqual([id(100), id(101)])
    const latest = snapshot.reservations.slice(2, 26).map(hold => hold.id)
    const atLimit = apply(first, latest)
    expect(atLimit).toHaveLength(25)
    expect(apply(second, atLimit)).toBe(atLimit)
    expect(apply(first, atLimit)).toBe(atLimit)
  })

  it('checks bulk selection against the latest state and preserves newer active IDs during cleanup', () => {
    const onSelection = vi.fn<Dispatch<SetStateAction<readonly string[]>>>()
    const { rerender } = render(<ActiveHoldManager snapshot={snapshot} selection={[]} onSelection={onSelection} onReview={() => undefined} pending={false} />)
    fireEvent.click(screen.getByText('Manage active holds', { exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Select visible holds' }))
    const bulk = onSelection.mock.calls[0]?.[0], latest = snapshot.reservations.slice(4, 28).map(hold => hold.id)
    expect(typeof bulk).toBe('function')
    expect(apply(bulk, latest)).toBe(latest)
    expect(apply(bulk, [id(127)])).toEqual([id(127), ...snapshot.reservations.slice(0, 8).map(hold => hold.id)])
    rerender(<ActiveHoldManager snapshot={snapshot} selection={[id(999)]} onSelection={onSelection} onReview={() => undefined} pending={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable selections' }))
    const cleanup = onSelection.mock.calls.at(-1)?.[0]
    expect(typeof cleanup).toBe('function')
    expect(apply(cleanup, [id(999), id(127)])).toEqual([id(127)])
  })
})
