export interface Draft<T> {
    entityId: string;
    value: T;
    dirty: boolean;
    updatedAt: string;
}
export type DraftRegistry<T> = ReadonlyMap<string, Draft<T>>;
export function updateDraft<T>(registry: DraftRegistry<T>, entityId: string, value: T, updatedAt: string): DraftRegistry<T> { const next = new Map(registry); next.set(entityId, { entityId, value, dirty: true, updatedAt }); return next; }
export function discardDraft<T>(registry: DraftRegistry<T>, entityId: string): DraftRegistry<T> { const next = new Map(registry); next.delete(entityId); return next; }
export function commitDraft<T>(registry: DraftRegistry<T>, entityId: string): DraftRegistry<T> { const current = registry.get(entityId); if (!current)
    return registry; const next = new Map(registry); next.set(entityId, { ...current, dirty: false }); return next; }
