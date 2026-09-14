export interface VersionedRecord {
    readonly id: string;
    revision: number;
    updatedAt: string;
}
export type SyncDecision = 'local' | 'remote' | 'conflict';
export function decideSync(local: VersionedRecord, remote: VersionedRecord): SyncDecision {
    if (local.revision === remote.revision)
        return local.updatedAt === remote.updatedAt ? 'remote' : 'conflict';
    return local.revision > remote.revision ? 'local' : 'remote';
}
export function mergeRemote<T extends VersionedRecord>(local: T[], remote: T[]) {
    const byId = new Map(local.map(item => [item.id, item]));
    for (const item of remote) {
        const current = byId.get(item.id);
        if (!current || decideSync(current, item) === 'remote')
            byId.set(item.id, item);
    }
    return [...byId.values()];
}
