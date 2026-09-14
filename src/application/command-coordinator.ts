import type { Command, Snapshot } from '../workspace/types';
import type { WorkspaceGateway } from '../data/gateway';
export interface CommandOutcome {
    state: Snapshot;
    changed: boolean;
    message: string;
}
export async function coordinate(gateway: WorkspaceGateway, before: Snapshot, command: Command): Promise<CommandOutcome> { const state = await gateway.execute(command); return { state, changed: state.revision !== before.revision, message: state.audit.at(-1)?.summary ?? 'Command replayed without changes.' }; }
