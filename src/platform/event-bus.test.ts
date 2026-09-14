import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './event-bus';
describe('event bus', () => {
    it('publishes typed payloads', () => {
        const bus = new EventBus<{
            saved: {
                id: string;
            };
        }>(), listener = vi.fn();
        bus.on('saved', listener);
        bus.emit('saved', { id: 'x' });
        expect(listener).toHaveBeenCalledWith({ id: 'x' });
    });
    it('unsubscribes listeners', () => {
        const bus = new EventBus<{
            saved: string;
        }>(), listener = vi.fn(), off = bus.on('saved', listener);
        off();
        bus.emit('saved', 'x');
        expect(listener).not.toHaveBeenCalled();
    });
});
