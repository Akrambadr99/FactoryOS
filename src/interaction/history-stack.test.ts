import { describe, expect, it } from 'vitest';
import { createHistory, pushHistory, redoHistory, undoHistory } from './history-stack';
describe('history stack', () => { it('supports undo and redo', () => { const changed = pushHistory(createHistory('one'), 'two'); expect(undoHistory(changed).present).toBe('one'); expect(redoHistory(undoHistory(changed)).present).toBe('two'); }); it('clears redo after a new branch', () => { const branched = pushHistory(undoHistory(pushHistory(createHistory(1), 2)), 3); expect(branched.future).toEqual([]); }); it('enforces a bounded past', () => { let state = createHistory(0); for (let value = 1; value <= 5; value += 1)
    state = pushHistory(state, value, 2); expect(state.past).toEqual([3, 4]); }); });
