import { describe, expect, it } from 'vitest';
import { Outbox } from './outbox';
const message = { id: '1', topic: 'entity.saved', payload: { id: 'e1' }, createdAt: '2026-09-12', attempts: 0 };
describe('outbox', () => { it('deduplicates messages', () => { const box = new Outbox(); box.enqueue(message); box.enqueue(message); expect(box.size()).toBe(1); }); it('tracks delivery', () => { const box = new Outbox(); box.enqueue(message); box.attempt('1'); expect(box.pending()[0]?.attempts).toBe(1); box.markSent('1', 'later'); expect(box.size()).toBe(0); }); });
