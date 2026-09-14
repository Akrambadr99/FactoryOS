import type { Snapshot } from '../workspace/types';
export type ImportPreview = {
    ok: true;
    snapshot: Snapshot;
    counts: Record<string, number>;
} | {
    ok: false;
    message: string;
};
export function previewSnapshot(raw: string, productName: string): ImportPreview { try {
    const value = JSON.parse(raw) as Partial<Snapshot>;
    if (value.schema !== 1 || value.product !== productName || !Array.isArray(value.entities) || !Array.isArray(value.audit))
        return { ok: false, message: 'This file is not a compatible ' + productName + ' workspace.' };
    const counts = value.entities.reduce<Record<string, number>>((result, entity) => ({ ...result, [entity.kind]: (result[entity.kind] ?? 0) + 1 }), {});
    return { ok: true, snapshot: value as Snapshot, counts };
}
catch {
    return { ok: false, message: 'The selected file does not contain valid JSON.' };
} }
