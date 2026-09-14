import type { Command, Product, Snapshot } from '../workspace/types';
import { Repository, type StoragePort } from '../workspace/repository';
export interface WorkspaceGateway {
    read(): Promise<Snapshot>;
    execute(command: Command): Promise<Snapshot>;
    restore(raw: string, expectedRevision: number, actorId: string): Promise<Snapshot>;
}
export class LocalWorkspaceGateway implements WorkspaceGateway {
    private readonly repository: Repository;
    private readonly now: () => string;
    constructor(product: Product, storage: StoragePort, now: () => string = () => new Date().toISOString()) { this.repository = new Repository(product, storage); this.now = now; }
    async read() { return Promise.resolve(this.repository.read()); }
    async execute(command: Command) { return Promise.resolve(this.repository.commit(command, this.now())); }
    async restore(raw: string, expectedRevision: number, actorId: string) { return Promise.resolve(this.repository.restore(raw, expectedRevision, actorId, this.now())); }
}
