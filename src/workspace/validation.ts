/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain */
import type { Entity, Field, Product, Snapshot, Value } from './types';
import { requireThat } from './values';
export function validateFields(fields: Record<string, Value>, definitions: Field[], entities: Entity[]) {
    requireThat(Object.keys(fields).every(key => definitions.some(field => field.key === key)), 'Unrecognized field in record.');
    for (const field of definitions) {
        const value = fields[field.key];
        if (value === undefined || value === '') {
            requireThat(!field.required, field.label + ' is required.');
            continue;
        }
        if (field.type === 'number') {
            requireThat(typeof value === 'number' && Number.isFinite(value), field.label + ' must be a finite number.');
            requireThat(!field.integer || Number.isSafeInteger(value), field.label + ' must be a safe integer.');
            requireThat(field.min === undefined || value >= field.min, field.label + ' is below its minimum.');
            requireThat(field.max === undefined || value <= field.max, field.label + ' exceeds its maximum.');
        }
        else {
            requireThat(typeof value === 'string' && value.length <= (field.max ?? 4000), field.label + ' must be valid text.');
            if (field.required)
                requireThat(value.trim().length > 0, field.label + ' is required.');
            if (field.type === 'date')
                requireThat(/^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0, 10) === value, field.label + ' must be a calendar date.');
            if (field.type === 'select')
                requireThat(field.options?.includes(value), field.label + ' has an invalid selection.');
            if (field.type === 'reference')
                requireThat(entities.some(entity => entity.kind === field.reference && entity.id === value), field.label + ' refers to a missing record.');
        }
    }
}
export function validateSnapshot(snapshot: Snapshot, product: Product) {
    requireThat(snapshot.schema === 1 && snapshot.product === product.name, 'This backup belongs to another product or schema.');
    requireThat(Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0, 'Invalid workspace revision.');
    requireThat(Array.isArray(snapshot.entities) && Array.isArray(snapshot.audit) && Array.isArray(snapshot.receipts), 'Invalid workspace collections.');
    requireThat(snapshot.entities.length <= 10000 && snapshot.audit.length <= 100000, 'Workspace exceeds supported limits.');
    requireThat(new Set(snapshot.entities.map(entity => entity.id)).size === snapshot.entities.length, 'Duplicate record identifiers.');
    for (const entity of snapshot.entities) {
        requireThat(typeof entity.id === 'string' && entity.id.length > 0 && typeof entity.title === 'string' && entity.title.trim().length > 0 && entity.title.length <= 200, 'Invalid record identity or title.');
        requireThat(Number.isSafeInteger(entity.revision) && entity.revision > 0, 'Invalid record revision.');
        const kind = product.kinds.find(kind => kind.key === entity.kind);
        requireThat(kind && kind.states.includes(entity.status), 'Invalid record kind or state.');
        validateFields(entity.fields, kind.fields, snapshot.entities);
    }
    for (const audit of snapshot.audit)
        requireThat(typeof audit.id === 'string' && typeof audit.at === 'string' && Number.isFinite(Date.parse(audit.at)) && typeof audit.actor === 'string' && typeof audit.action === 'string' && typeof audit.summary === 'string' && Array.isArray(audit.entityIds) && audit.entityIds.every(id => typeof id === 'string'), 'Invalid audit event.');
    for (const receipt of snapshot.receipts)
        requireThat(typeof receipt.id === 'string' && typeof receipt.fingerprint === 'string', 'Invalid command receipt.');
    product.validate(snapshot.entities);
}
export function decode(raw: string, product: Product): Snapshot {
    requireThat(raw.length <= 20000000, 'Backup is too large.');
    const snapshot = JSON.parse(raw) as Snapshot;
    validateSnapshot(snapshot, product);
    return snapshot;
}
