import type { Actor, Product } from '../workspace/types';
export interface Session {
    actor: Actor;
    capabilities: string[];
}
export function createSession(product: Product, actorId: string): Session {
    const actor = product.actors.find(candidate => candidate.id === actorId);
    if (!actor)
        throw new Error('Session actor was not found.');
    const capabilities = [...new Set([...product.kinds.filter(kind => kind.editors.includes(actor.role)).map(kind => 'edit:' + kind.key), ...product.operations.filter(operation => operation.roles.includes(actor.role)).map(operation => 'operate:' + operation.key)])].sort();
    return { actor, capabilities };
}
