import { describe, expect, it } from 'vitest'
import { activeDelegate, validateDelegation, type Delegation } from './delegation'
const delegation: Delegation = { id: 'd1', approverId: 'a', delegateId: 'b', startsAt: '2026-01-01', endsAt: '2026-01-31' }
describe('approval delegation', () => {
  it('resolves an active delegate', () => expect(activeDelegate('a', '2026-01-15', [delegation])).toBe('b'))
  it('falls back outside the period', () => expect(activeDelegate('a', '2026-02-01', [delegation])).toBe('a'))
  it('rejects overlapping periods', () => expect(() => validateDelegation({ ...delegation, id: 'd2' }, [delegation])).toThrow(/overlaps/))
})
