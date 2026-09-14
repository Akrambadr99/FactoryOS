import { describe, expect, it } from 'vitest'
import { matchesSearch, parseSearchQuery } from './query-parser'
describe('structured search', () => {
  it('parses fields, phrases and negation', () => expect(parseSearchQuery('status:open owner:"Ada Lovelace" -blocked')).toEqual([{ field: 'status', value: 'open', negated: false }, { field: 'owner', value: 'Ada Lovelace', negated: false }, { value: 'blocked', negated: true }]))
  it('matches all positive and negative tokens', () => expect(matchesSearch({ status: 'Open', owner: 'Ada Lovelace', title: 'Ready' }, parseSearchQuery('status:open -blocked'))).toBe(true))
})
