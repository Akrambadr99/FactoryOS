export interface HistoryState<T> {
    past: readonly T[];
    present: T;
    future: readonly T[];
}
export function createHistory<T>(initial: T): HistoryState<T> { return { past: [], present: initial, future: [] }; }
export function pushHistory<T>(state: HistoryState<T>, value: T, limit = 30): HistoryState<T> { return { past: [...state.past, state.present].slice(-limit), present: value, future: [] }; }
export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> { const previous = state.past.at(-1); return previous === undefined ? state : { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] }; }
export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> { const next = state.future[0]; return next === undefined ? state : { past: [...state.past, state.present], present: next, future: state.future.slice(1) }; }
