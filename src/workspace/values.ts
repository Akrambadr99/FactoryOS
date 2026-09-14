import type { Entity, Value } from './types';
export function text(fields: Record<string, Value>, key: string): string {
    const value = fields[key];
    if (typeof value !== 'string')
        throw new Error('Missing text field: ' + key);
    return value;
}
export function number(fields: Record<string, Value>, key: string): number {
    const value = fields[key];
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error('Invalid numeric field: ' + key);
    return value;
}
export function requireThat(condition: unknown, message: string): asserts condition {
    if (!condition)
        throw new Error(message);
}
export function find(entities: Entity[], id: string, kind?: string): Entity {
    const result = entities.find(entity => entity.id === id && (!kind || entity.kind === kind));
    if (!result)
        throw new Error('Linked record was not found: ' + id);
    return result;
}
export function rows(entities: Entity[], kind: string): Entity[] { return entities.filter(entity => entity.kind === kind); }
export function total(entities: Entity[], key: string): number { return entities.reduce((sum, entity) => sum + number(entity.fields, key), 0); }
export function money(value: number): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100); }
export function overlaps(start: string, end: string, otherStart: string, otherEnd: string): boolean { return start < otherEnd && otherStart < end; }
export function entity(id: string, kind: string, title: string, status: string, fields: Record<string, Value>): Entity { return { id, kind, title, status, revision: 1, fields }; }
