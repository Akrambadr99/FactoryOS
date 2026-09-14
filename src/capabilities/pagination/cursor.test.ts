import { describe, expect, it } from 'vitest'
import { cursorPage, decodeCursor, encodeCursor } from './cursor'
describe('cursor pagination', () => {
  it('round trips a cursor', () => expect(decodeCursor(encodeCursor({ sortValue: 'A', id: '1' }))).toEqual({ sortValue: 'A', id: '1' }))
  it('continues after the cursor record', () => { const rows = [{ id: '1' }, { id: '2' }, { id: '3' }]; const identify = (row: { id: string }) => ({ id: row.id, sortValue: row.id }); const first = cursorPage(rows, 2, undefined, identify); expect(first.items.map(row => row.id)).toEqual(['1', '2']); expect(cursorPage(rows, 2, first.next, identify).items.map(row => row.id)).toEqual(['3']) })
  it('rejects an unknown cursor', () => expect(() => cursorPage([{ id: '1' }], 1, { id: 'x', sortValue: 'x' }, row => ({ id: row.id, sortValue: row.id }))).toThrow(/not found/))
})
