export interface CommentRecord { id: string; authorId: string; body: string; createdAt: string; updatedAt: string; revision: number; deletedAt?: string }
export function addComment(comments: readonly CommentRecord[], comment: CommentRecord): CommentRecord[] {
  if (!comment.body.trim()) throw new Error('Comment body is required.')
  if (comments.some(item => item.id === comment.id)) return [...comments]
  return [...comments, { ...comment, body: comment.body.trim() }]
}
export function editComment(comments: readonly CommentRecord[], id: string, authorId: string, body: string, at: string): CommentRecord[] {
  if (!body.trim()) throw new Error('Comment body is required.')
  return comments.map(comment => {
    if (comment.id !== id) return comment
    if (comment.authorId !== authorId || comment.deletedAt) throw new Error('Comment cannot be edited.')
    return { ...comment, body: body.trim(), updatedAt: at, revision: comment.revision + 1 }
  })
}
export function deleteComment(comments: readonly CommentRecord[], id: string, actorId: string, at: string): CommentRecord[] {
  return comments.map(comment => comment.id === id && comment.authorId === actorId ? { ...comment, deletedAt: at, body: '', revision: comment.revision + 1 } : comment)
}
