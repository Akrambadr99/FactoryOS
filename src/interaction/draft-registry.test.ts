import { describe, expect, it } from 'vitest';
import { commitDraft, discardDraft, updateDraft, type DraftRegistry } from './draft-registry';
describe('draft registry', () => { it('keeps edits scoped by entity', () => { let drafts: DraftRegistry<{
    title: string;
}> = new Map(); drafts = updateDraft(drafts, 'a', { title: 'A' }, 'now'); drafts = updateDraft(drafts, 'b', { title: 'B' }, 'later'); expect(drafts.get('a')?.value).toEqual({ title: 'A' }); }); it('marks a committed draft clean', () => expect(commitDraft(updateDraft(new Map(), 'a', 'value', 'now'), 'a').get('a')?.dirty).toBe(false)); it('discards one draft only', () => { let drafts = updateDraft(new Map(), 'a', 'A', 'now'); drafts = updateDraft(drafts, 'b', 'B', 'now'); expect(discardDraft(drafts, 'a').has('b')).toBe(true); }); });
