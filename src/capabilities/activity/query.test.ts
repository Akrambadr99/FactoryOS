import { describe, expect, it } from 'vitest'
import { queryActivity, type ActivityEvent } from './query'
const events: ActivityEvent[] = [{ id: '1', at: '2026-01-01', actor: 'A', action: 'edit', entityIds: ['x'], summary: 'Changed owner' }, { id: '2', at: '2026-02-01', actor: 'B', action: 'approve', entityIds: ['y'], summary: 'Approved request' }]
describe('activity query', () => {
  it('combines actor and text filters', () => expect(queryActivity(events, { actor: 'A', text: 'owner' }).map(event => event.id)).toEqual(['1']))
  it('returns newest events first', () => expect(queryActivity(events, {}).map(event => event.id)).toEqual(['2', '1']))
})
