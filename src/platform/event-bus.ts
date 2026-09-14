export type EventMap = Record<string, unknown>;
export type Unsubscribe = () => void;
export class EventBus<E extends EventMap> {
    private readonly listeners = new Map<keyof E, Set<(payload: E[keyof E]) => void>>();
    on<K extends keyof E>(type: K, listener: (payload: E[K]) => void): Unsubscribe { const set = this.listeners.get(type) ?? new Set(); set.add(listener as (payload: E[keyof E]) => void); this.listeners.set(type, set); return () => { set.delete(listener as (payload: E[keyof E]) => void); }; }
    emit<K extends keyof E>(type: K, payload: E[K]) { this.listeners.get(type)?.forEach(listener => { listener(payload); }); }
    clear() { this.listeners.clear(); }
}
