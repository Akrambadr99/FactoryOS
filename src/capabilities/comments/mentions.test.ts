import { describe, expect, it } from 'vitest'
import { extractMentions, renderMentionText } from './mentions'
describe('mentions', () => {
  it('deduplicates recipients by identity', () => expect(extractMentions('@[A](u1) and @[A again](u1)')).toEqual([{ id: 'u1', label: 'A' }]))
  it('renders a readable fallback', () => expect(renderMentionText('Ask @[Sam](u2)')).toBe('Ask @Sam'))
})
