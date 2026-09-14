import { describe, expect, it } from 'vitest'
import { recurrenceDates } from './recurrence'
describe('recurrence', () => {
  it('expands a weekly schedule', () => expect(recurrenceDates('2026-01-01', { frequency: 'weekly', interval: 1, count: 3 })).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']))
  it('handles month boundaries in UTC', () => expect(recurrenceDates('2026-01-31', { frequency: 'daily', interval: 1, count: 2 })).toEqual(['2026-01-31', '2026-02-01']))
  it('bounds expansion size', () => expect(() => recurrenceDates('2026-01-01', { frequency: 'daily', interval: 1, count: 101 })).toThrow(/limits/))
})
