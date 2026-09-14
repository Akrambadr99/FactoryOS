import { describe, expect, it } from 'vitest';
import { decideSync, mergeRemote } from './sync-engine';
describe('sync engine', () => { it('detects divergent equal revisions', () => expect(decideSync({ id: 'x', revision: 2, updatedAt: 'a' }, { id: 'x', revision: 2, updatedAt: 'b' })).toBe('conflict')); it('keeps the newest revision', () => expect(mergeRemote([{ id: 'x', revision: 1, updatedAt: 'a' }], [{ id: 'x', revision: 2, updatedAt: 'b' }])[0]?.revision).toBe(2)); });
