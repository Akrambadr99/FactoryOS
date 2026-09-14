import { describe, expect, it } from 'vitest';
import { NotificationCenter } from './notification-center';
describe('notification center', () => { it('tracks unread items', () => { const center = new NotificationCenter(); center.push({ id: 'n1', title: 'Review', detail: 'Queued', level: 'warning', createdAt: 'now' }); expect(center.unread()).toBe(1); center.read('n1', 'later'); expect(center.unread()).toBe(0); }); });
