export type Value = string | number | boolean;
export interface Entity {
    id: string;
    kind: string;
    title: string;
    status: string;
    revision: number;
    fields: Record<string, Value>;
}
export interface Field {
    key: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select' | 'reference';
    required?: boolean;
    min?: number;
    max?: number;
    integer?: boolean;
    options?: string[];
    reference?: string;
    initial?: Value;
}
export interface Kind {
    key: string;
    label: string;
    states: string[];
    fields: Field[];
    editors: string[];
    initial: string;
}
export interface Actor {
    id: string;
    name: string;
    role: string;
}
export interface Audit {
    id: string;
    at: string;
    actor: string;
    action: string;
    entityIds: string[];
    summary: string;
}
export interface Snapshot {
    schema: 1;
    product: string;
    revision: number;
    entities: Entity[];
    audit: Audit[];
    receipts: {
        id: string;
        fingerprint: string;
    }[];
}
export interface Operation {
    key: string;
    label: string;
    kind: string;
    from: string[];
    roles: string[];
    fields?: Field[];
    run: (context: Context) => string;
}
export interface Context {
    state: Snapshot;
    entity: Entity;
    actor: Actor;
    input: Record<string, Value>;
    now: string;
    add: (kind: string, title: string, fields: Record<string, Value>, status?: string) => Entity;
}
export interface Product {
    name: string;
    description: string;
    accent: string;
    actors: Actor[];
    kinds: Kind[];
    operations: Operation[];
    seed: Entity[];
    validate: (entities: Entity[]) => void;
    metrics: (entities: Entity[]) => {
        label: string;
        value: string;
    }[];
}
export interface Command {
    id: string;
    expectedRevision: number;
    actorId: string;
    type: 'create' | 'edit' | 'operate' | 'comment';
    entityId?: string;
    kind?: string;
    title?: string;
    input: Record<string, Value>;
    operation?: string;
}
