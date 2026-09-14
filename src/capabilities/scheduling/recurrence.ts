export interface RecurrenceRule { frequency: 'daily' | 'weekly'; interval: number; count: number }
export function recurrenceDates(start: string, rule: RecurrenceRule): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error('Start date must use YYYY-MM-DD.')
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || !Number.isInteger(rule.count) || rule.count < 1 || rule.count > 100) throw new Error('Recurrence rule is outside supported limits.')
  const date = new Date(start + 'T00:00:00Z')
  if (Number.isNaN(date.getTime())) throw new Error('Start date is invalid.')
  const step = rule.interval * (rule.frequency === 'weekly' ? 7 : 1)
  return Array.from({ length: rule.count }, (_, index) => {
    const next = new Date(date)
    next.setUTCDate(next.getUTCDate() + step * index)
    return next.toISOString().slice(0, 10)
  })
}
