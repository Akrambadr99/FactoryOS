import { describe, expect, it } from 'vitest'
import { snoozeItem, unreadCount, visibleInbox } from './rules'
const items = [{ id: 'low', createdAt: '2026-02-01', priority: 'low' as const }, { id: 'high', createdAt: '2026-01-01', priority: 'high' as const }]
describe('inbox rules', () => {
  it('orders by priority before recency', () => expect(visibleInbox(items, '2026-03-01').map(item => item.id)).toEqual(['high', 'low']))
  it('hides a snoozed item from unread count', () => expect(unreadCount(snoozeItem(items, 'high', '2026-04-01'), '2026-03-01')).toBe(1))
})
