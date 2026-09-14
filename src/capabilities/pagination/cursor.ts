export interface Cursor { sortValue: string; id: string }
export function encodeCursor(cursor: Cursor): string { return btoa(JSON.stringify(cursor)) }
export function decodeCursor(value: string): Cursor { try { const parsed = JSON.parse(atob(value)) as Partial<Cursor>; if (typeof parsed.sortValue !== 'string' || typeof parsed.id !== 'string') throw new Error(); return { sortValue: parsed.sortValue, id: parsed.id } } catch { throw new Error('Cursor is invalid.') } }
export function cursorPage<T>(items: readonly T[], size: number, cursor: Cursor | undefined, identify: (item: T) => Cursor): { items: T[]; next?: Cursor } {
  if (!Number.isInteger(size) || size < 1) throw new Error('Page size must be positive.')
  const start = cursor ? items.findIndex(item => { const key = identify(item); return key.id === cursor.id && key.sortValue === cursor.sortValue }) + 1 : 0
  if (cursor && start === 0) throw new Error('Cursor record was not found.')
  const page = items.slice(start, start + size)
  const last = page.at(-1)
  return { items: page, ...(last && start + size < items.length ? { next: identify(last) } : {}) }
}
