export interface SelectionModel {
    anchor?: string;
    ids: ReadonlySet<string>;
}
export function toggleSelection(model: SelectionModel, id: string): SelectionModel { const ids = new Set(model.ids); if (ids.has(id))
    ids.delete(id);
else
    ids.add(id); return { anchor: id, ids }; }
export function selectVisible(model: SelectionModel, visibleIds: readonly string[]): SelectionModel { const ids = new Set(model.ids); for (const id of visibleIds)
    ids.add(id); return { ...model, ids }; }
export function reconcileSelection(model: SelectionModel, existingIds: ReadonlySet<string>): SelectionModel { const ids = new Set([...model.ids].filter(id => existingIds.has(id))); return { ...(model.anchor && existingIds.has(model.anchor) ? { anchor: model.anchor } : {}), ids }; }
