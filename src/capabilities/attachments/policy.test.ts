import { describe, expect, it } from 'vitest'
import { duplicateAttachment, inspectAttachment } from './policy'
const policy = { maximumBytes: 1000, allowedMime: ['text/plain'], blockedExtensions: ['.exe'] }
describe('attachment policy', () => {
  it('collects all rejection reasons', () => expect(inspectAttachment({ name: '../bad.exe', size: 2000, mime: 'app/exe' }, policy).reasons).toHaveLength(4))
  it('accepts a valid candidate', () => expect(inspectAttachment({ name: 'note.txt', size: 20, mime: 'text/plain' }, policy).accepted).toBe(true))
  it('detects a case-insensitive duplicate', () => expect(duplicateAttachment({ name: 'NOTE.txt', size: 20, mime: 'text/plain' }, [{ name: 'note.txt', size: 20, mime: 'text/plain' }])).toBe(true))
})
