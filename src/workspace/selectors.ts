import type { Entity, Product, Snapshot } from './types';
export function queryEntities(snapshot: Snapshot, kind: string, query: string, status: string): Entity[] {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return snapshot.entities.filter(entity => entity.kind === kind && (!status || entity.status === status) && words.every(word => [entity.title, entity.id, ...Object.values(entity.fields).map(String)].join(' ').toLocaleLowerCase().includes(word))).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
export function linkedRecords(snapshot: Snapshot, product: Product, id: string): Entity[] {
    return snapshot.entities.filter(entity => product.kinds.find(kind => kind.key === entity.kind)?.fields.some(field => field.type === 'reference' && entity.fields[field.key] === id));
}
export function csv(entities: Entity[]): string {
    const safe = (value: string) => '"' + (/^[=+@\-\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"';
    return [['ID', 'Title', 'State', 'Revision'], ...entities.map(entity => [entity.id, entity.title, entity.status, String(entity.revision)])].map(row => row.map(safe).join(',')).join('\r\n');
}
