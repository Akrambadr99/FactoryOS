import type { Snapshot } from '../workspace/types';
import { csv } from '../workspace/selectors';
export function exportBackup(snapshot: Snapshot): string { return JSON.stringify(snapshot, null, 2); }
export function exportKindCsv(snapshot: Snapshot, kind: string): string { return csv(snapshot.entities.filter(entity => entity.kind === kind)); }
export function exportAuditJson(snapshot: Snapshot): string { return JSON.stringify(snapshot.audit, null, 2); }
