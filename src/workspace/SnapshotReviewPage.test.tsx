import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SnapshotReviewPage } from './SnapshotReviewPage'
import { type SnapshotAdapter } from './collectionSnapshot'
import { array, nonEmptyText, nonNegativeInteger, object, uniqueBy } from './storageValidation'

interface Item { id: string; revision: number }
const rule = uniqueBy(array(object<Item>({ id: nonEmptyText, revision: nonNegativeInteger })), 'id')
const items = Array.from({ length: 12 }, (_, i) => ({ id: 'R-' + String(i + 1).padStart(2, '0'), revision: 1 }))
function setup() {
  const adapter: SnapshotAdapter<Item[]> = { product: 'Example', scope: 'items', label: 'Example records',
    read: storage => { const value: unknown = JSON.parse(storage.getItem('items') ?? JSON.stringify(items)); return rule(value) },
    validate: rule, groups: value => [{ key: 'items', label: 'Items', records: value.map(item => ({ id: item.id, label: 'Item ' + item.id, value: item })) }] }
  localStorage.clear(); localStorage.setItem('items', JSON.stringify(items))
  const write = vi.spyOn(Storage.prototype, 'setItem')
  const mounted = render(<SnapshotReviewPage adapter={adapter} />)
  return { ...mounted, write, user: userEvent.setup() }
}
const raw = (payload = items) => JSON.stringify({ format: 'collection-snapshot', version: 1, product: 'Example', scope: 'items', createdAt: '2026-09-30T12:00:00.000Z', payload })
function paste(text: string) { fireEvent.change(screen.getByLabelText('Snapshot JSON'), { target: { value: text } }) }
function deferredFile() {
  let resolve!: (value: string) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  const file = new File(['{}'], 'review.json', { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: () => promise })
  return { file, resolve, reject }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('snapshot review interaction', () => {
  it('focuses the comparison and clears obsolete results when input changes', async () => {
    const { user, write } = setup()
    paste(raw()); await user.click(screen.getByRole('button', { name: 'Compare snapshot' }))
    expect(screen.getByRole('heading', { name: 'Snapshot comparison' })).toHaveFocus()
    expect(screen.getByText(/complete collection matches/)).toBeVisible()
    paste('{broken')
    expect(screen.queryByRole('heading', { name: 'Snapshot comparison' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Compare snapshot' }))
    expect(screen.getByRole('alert')).toHaveTextContent('not readable JSON')
    expect(screen.getByLabelText('Snapshot JSON')).toHaveValue('{broken')
    expect(write).not.toHaveBeenCalled()
  })
  it('filters pages and preserves selected detail outside the current view', async () => {
    const { user } = setup()
    paste(raw()); await user.click(screen.getByRole('button', { name: 'Compare snapshot' }))
    await user.selectOptions(screen.getByLabelText('Show records'), 'all')
    await user.click(screen.getByRole('button', { name: 'Inspect R-01' }))
    await user.click(screen.getByRole('button', { name: 'Next records' }))
    expect(screen.getByText('12 matching records · Page 2 of 2')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'R-01' })).toBeVisible()
    expect(screen.getByText('This selected record is outside the current view.')).toBeVisible()
    await user.type(screen.getByLabelText('Find record'), 'R-12')
    expect(screen.getByText('1 matching records · Page 1 of 1')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Next records' })).toBeDisabled()
  })
  it('marks a changed comparison stale and refreshes without replacing user input', async () => {
    const { user, write } = setup()
    paste(raw()); await user.click(screen.getByRole('button', { name: 'Compare snapshot' }))
    act(() => { localStorage.setItem('items', JSON.stringify(items.map(item => ({ ...item, revision: 2 })))); window.dispatchEvent(new Event('storage')) })
    expect(screen.getByRole('alert')).toHaveTextContent('out of date')
    expect(screen.getByLabelText('Snapshot JSON')).toHaveValue(raw())
    write.mockClear()
    await user.click(screen.getByRole('button', { name: 'Refresh comparison' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect R-01' })).toBeVisible()
    expect(write).not.toHaveBeenCalled()
  })
  it('does not invalidate a comparison when unrelated storage changes', async () => {
    const { user } = setup()
    paste(raw()); await user.click(screen.getByRole('button', { name: 'Compare snapshot' }))
    act(() => { localStorage.setItem('unrelated', 'value'); window.dispatchEvent(new Event('storage')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('never replaces later typed text with a late file read', async () => {
    setup()
    const pending = deferredFile()
    fireEvent.change(screen.getByLabelText(/Snapshot file/), { target: { files: [pending.file] } })
    expect(screen.getByRole('status')).toHaveTextContent('Reading')
    paste('newer manual input')
    await act(async () => { pending.resolve(raw()); await Promise.resolve() })
    expect(screen.getByLabelText('Snapshot JSON')).toHaveValue('newer manual input')
    expect(screen.getByRole('status')).not.toHaveTextContent('File loaded')
  })
  it('keeps the newest file when reads finish out of order', async () => {
    setup()
    const first = deferredFile(), second = deferredFile()
    fireEvent.change(screen.getByLabelText(/Snapshot file/), { target: { files: [first.file] } })
    fireEvent.change(screen.getByLabelText(/Snapshot file/), { target: { files: [second.file] } })
    await act(async () => { second.resolve(raw([])); await Promise.resolve() })
    await act(async () => { first.resolve(raw()); await Promise.resolve() })
    expect(screen.getByLabelText('Snapshot JSON')).toHaveValue(raw([]))
  })
  it('preserves text on a failed file read and allows a retry', async () => {
    setup(); paste('retained text')
    const pending = deferredFile()
    fireEvent.change(screen.getByLabelText(/Snapshot file/), { target: { files: [pending.file] } })
    await act(async () => { pending.reject(new Error('PRIVATE PATH')); await Promise.resolve() })
    expect(screen.getByRole('alert')).toHaveTextContent('file could not be read')
    expect(screen.getByRole('alert')).not.toHaveTextContent('PRIVATE PATH')
    expect(screen.getByLabelText('Snapshot JSON')).toHaveValue('retained text')
    const retry = deferredFile()
    fireEvent.change(screen.getByLabelText(/Snapshot file/), { target: { files: [retry.file] } })
    await act(async () => { retry.resolve(raw()); await Promise.resolve() })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Snapshot JSON')).toHaveValue(raw())
  })
  it('rejects oversized files without invoking their reader', () => {
    setup(); paste('retained text')
    const file = new File(['x'], 'big.json'), text = vi.fn()
    Object.defineProperties(file, { size: { value: 20000001 }, text: { value: text } })
    fireEvent.change(screen.getByLabelText(/Snapshot file/), { target: { files: [file] } })
    expect(screen.getByRole('alert')).toHaveTextContent('20 MB')
    expect(screen.getByLabelText('Snapshot JSON')).toHaveValue('retained text')
    expect(text).not.toHaveBeenCalled()
  })
  it('ignores pending file reads after leaving the screen', async () => {
    const { unmount } = setup(), pending = deferredFile()
    fireEvent.change(screen.getByLabelText(/Snapshot file/), { target: { files: [pending.file] } })
    unmount()
    await act(async () => { pending.resolve(raw()); await Promise.resolve() })
    expect(screen.queryByLabelText('Snapshot JSON')).not.toBeInTheDocument()
  })
  it('downloads only a validated snapshot and revokes its temporary URL', async () => {
    const { user, write } = setup()
    const create = vi.fn(() => 'blob:snapshot'), revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('example-collection-snapshot-v1.json')
    })
    await user.click(screen.getByRole('button', { name: 'Download collection snapshot' }))
    expect(create).toHaveBeenCalledWith(expect.any(Blob)); expect(click).toHaveBeenCalled()
    await waitFor(() => { expect(revoke).toHaveBeenCalledWith('blob:snapshot') })
    expect(write).not.toHaveBeenCalled()
  })
})
