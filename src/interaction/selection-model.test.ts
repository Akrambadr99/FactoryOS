import { describe, expect, it } from 'vitest';
import { reconcileSelection, selectVisible, toggleSelection } from './selection-model';
const empty = { ids: new Set<string>() };
describe('selection model', () => { it('preserves hidden selections when selecting a visible page', () => expect([...selectVisible({ ids: new Set(['hidden']) }, ['visible']).ids]).toEqual(['hidden', 'visible'])); it('toggles one record without mutating the source', () => { const next = toggleSelection(empty, 'one'); expect(next.ids.has('one')).toBe(true); expect(empty.ids.size).toBe(0); }); it('drops deleted record ids', () => expect(reconcileSelection({ anchor: 'gone', ids: new Set(['gone', 'kept']) }, new Set(['kept']))).toEqual({ ids: new Set(['kept']) })); });
