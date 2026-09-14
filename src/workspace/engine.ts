/* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain */
import type { Command, Product, Snapshot } from './types';
import { find, requireThat, text } from './values';
import { validateFields, validateSnapshot } from './validation';
export function fresh(product: Product): Snapshot {
    const snapshot: Snapshot = { schema: 1, product: product.name, revision: 0, entities: structuredClone(product.seed), audit: [], receipts: [] };
    validateSnapshot(snapshot, product);
    return snapshot;
}
export function execute(current: Snapshot, command: Command, product: Product, now: string): Snapshot {
    validateSnapshot(current, product);
    requireThat(command.id.trim().length > 0 && Number.isFinite(Date.parse(now)), 'Command identity and timestamp are required.');
    const fingerprint = JSON.stringify({ ...command, input: Object.fromEntries(Object.entries(command.input).sort(([a], [b]) => a.localeCompare(b))) });
    const receipt = current.receipts.find(receipt => receipt.id === command.id);
    if (receipt) {
        requireThat(receipt.fingerprint === fingerprint, 'Command identifier was reused with different content.');
        return current;
    }
    requireThat(current.revision === command.expectedRevision, 'This workspace changed. Refresh and review the latest values before retrying.');
    const actor = product.actors.find(actor => actor.id === command.actorId);
    requireThat(actor, 'Unknown workspace actor.');
    const next = structuredClone(current);
    let entity = command.entityId ? find(next.entities, command.entityId) : undefined;
    let summary = '';
    if (command.type === 'create') {
        const kind = product.kinds.find(kind => kind.key === command.kind);
        requireThat(kind && kind.editors.includes(actor.role), 'This role cannot create this record.');
        entity = { id: command.id, kind: kind.key, title: command.title?.trim() ?? '', status: kind.initial, revision: 1, fields: { ...command.input } };
        requireThat(!next.entities.some(item => item.id === entity?.id), 'Record identifier already exists.');
        next.entities.push(entity);
        summary = 'Created ' + entity.title;
    }
    else {
        if (!entity)
            throw new Error('Select a record first.');
        const currentKind = entity.kind;
        const kind = product.kinds.find(kind => kind.key === currentKind);
        requireThat(kind, 'Unknown record kind.');
        if (command.type === 'edit') {
            requireThat(kind.editors.includes(actor.role), 'This role cannot edit this record.');
            requireThat(entity.status === kind.initial, 'Only records in their initial state can be edited. Use a workflow action for active records.');
            entity.title = command.title?.trim() ?? entity.title;
            entity.fields = { ...command.input };
            summary = 'Updated ' + entity.title;
        }
        else if (command.type === 'comment') {
            const comment = text(command.input, 'comment').trim();
            requireThat(comment.length > 0 && comment.length <= 2000, 'Comments must contain between 1 and 2000 characters.');
            summary = comment;
        }
        else {
            const entityKind = entity.kind;
            const operation = product.operations.find(operation => operation.key === command.operation && operation.kind === entityKind);
            requireThat(operation && operation.roles.includes(actor.role), 'This role cannot perform this operation.');
            requireThat(operation.from.includes(entity.status), 'This operation is no longer available in the current state.');
            validateFields(command.input, operation.fields ?? [], next.entities);
            let serial = 0;
            summary = operation.run({ state: next, entity, actor, input: command.input, now, add: (kindKey, title, fields, status) => {
                    const definition = product.kinds.find(kind => kind.key === kindKey);
                    requireThat(definition, 'Unknown linked record type.');
                    const child = { id: command.id + '-' + String(++serial), kind: kindKey, title, fields, status: status ?? definition.initial, revision: 1 };
                    next.entities.push(child);
                    return child;
                } });
        }
    }
    const changed: string[] = [];
    for (const item of next.entities) {
        const before = current.entities.find(previous => previous.id === item.id);
        if (!before || JSON.stringify(before) !== JSON.stringify(item)) {
            changed.push(item.id);
            if (before)
                item.revision = before.revision + 1;
        }
    }
    next.revision++;
    next.audit.push({ id: command.id, at: now, actor: actor.name, action: command.operation ?? command.type, entityIds: [...new Set([...(entity ? [entity.id] : []), ...changed])], summary });
    next.receipts.push({ id: command.id, fingerprint });
    validateSnapshot(next, product);
    return next;
}
