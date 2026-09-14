import type { Command, Product, Snapshot } from './types';
import { execute, fresh } from './engine';
import { decode } from './validation';
import { requireThat } from './values';
export interface StoragePort {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
}
export class Repository {
    readonly key: string;
    private readonly product: Product;
    private readonly storage: StoragePort;
    constructor(product: Product, storage: StoragePort) { this.product = product; this.storage = storage; this.key = product.name.toLowerCase() + ':workspace:v1'; }
    read(): Snapshot { const raw = this.storage.getItem(this.key); return raw === null ? fresh(this.product) : decode(raw, this.product); }
    commit(command: Command, now: string): Snapshot {
        const before = this.read();
        const next = execute(before, command, this.product, now);
        if (next !== before)
            this.storage.setItem(this.key, JSON.stringify(next));
        return next;
    }
    restore(raw: string, expectedRevision: number, actorId: string, now: string): Snapshot {
        const actor = this.product.actors.find(actor => actor.id === actorId);
        requireThat(actor?.role === this.product.actors[0]?.role, 'Workspace owner authority is required to restore a backup.');
        if (!actor)
            throw new Error('Unknown workspace actor.');
        const current = this.read();
        requireThat(current.revision === expectedRevision, 'Workspace changed before restore. Refresh first.');
        const candidate = decode(raw, this.product);
        const next: Snapshot = { ...candidate, revision: current.revision + 1, receipts: current.receipts, audit: [...current.audit, { id: 'restore-' + String(current.revision + 1), at: now, actor: actor.name, action: 'restore', entityIds: [], summary: 'Restored validated backup from revision ' + String(candidate.revision) }] };
        this.storage.setItem(this.key, JSON.stringify(next));
        return next;
    }
}
