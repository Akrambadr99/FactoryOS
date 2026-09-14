import { describe, expect, it } from 'vitest'
import { addComment, deleteComment, editComment, type CommentRecord } from './thread'
const comment: CommentRecord = { id: 'c1', authorId: 'u1', body: ' First ', createdAt: 'now', updatedAt: 'now', revision: 1 }
describe('comment thread', () => {
  it('normalizes a new comment', () => expect(addComment([], comment)[0]?.body).toBe('First'))
  it('rejects another author edit', () => expect(() => editComment([comment], 'c1', 'u2', 'Changed', 'later')).toThrow(/cannot/))
  it('retains a tombstone on delete', () => expect(deleteComment([comment], 'c1', 'u1', 'later')[0]).toMatchObject({ body: '', deletedAt: 'later', revision: 2 }))
})
