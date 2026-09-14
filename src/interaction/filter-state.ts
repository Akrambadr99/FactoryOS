export interface WorkspaceFilter {
    query: string;
    kind: string;
    statuses: string[];
}
export type FilterAction = {
    type: 'query';
    value: string;
} | {
    type: 'kind';
    value: string;
} | {
    type: 'toggle-status';
    value: string;
} | {
    type: 'clear';
};
export const emptyFilter: WorkspaceFilter = { query: '', kind: 'all', statuses: [] };
export function reduceFilter(state: WorkspaceFilter, action: FilterAction): WorkspaceFilter { if (action.type === 'clear')
    return emptyFilter; if (action.type === 'query')
    return { ...state, query: action.value }; if (action.type === 'kind')
    return { ...state, kind: action.value, statuses: [] }; const statuses = state.statuses.includes(action.value) ? state.statuses.filter(value => value !== action.value) : [...state.statuses, action.value]; return { ...state, statuses }; }
export function hasActiveFilter(filter: WorkspaceFilter) { return Boolean(filter.query.trim() || filter.kind !== 'all' || filter.statuses.length); }
