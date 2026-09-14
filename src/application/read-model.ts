import type { Product, Snapshot } from '../workspace/types';
export interface WorkspaceReadModel {
    revision: number;
    totalRecords: number;
    byKind: readonly {
        kind: string;
        label: string;
        count: number;
        active: number;
    }[];
    auditEvents: number;
}
export function buildReadModel(snapshot: Snapshot, product: Product): WorkspaceReadModel { return { revision: snapshot.revision, totalRecords: snapshot.entities.length, byKind: product.kinds.map(kind => { const records = snapshot.entities.filter(entity => entity.kind === kind.key); return { kind: kind.key, label: kind.label, count: records.length, active: records.filter(record => !['closed', 'cancelled', 'complete', 'paid', 'settled', 'restored', 'released', 'expired'].includes(record.status)).length }; }), auditEvents: snapshot.audit.length }; }
