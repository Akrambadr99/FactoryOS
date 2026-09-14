export interface Delegation { id: string; approverId: string; delegateId: string; startsAt: string; endsAt: string; revokedAt?: string }
export function activeDelegate(approverId: string, at: string, delegations: readonly Delegation[]): string {
  const matches = delegations.filter(item => item.approverId === approverId && !item.revokedAt && item.startsAt <= at && item.endsAt >= at)
  if (matches.length > 1) throw new Error('Overlapping approval delegations require review.')
  return matches[0]?.delegateId ?? approverId
}
export function validateDelegation(candidate: Delegation, existing: readonly Delegation[]): void {
  if (candidate.approverId === candidate.delegateId) throw new Error('An approver cannot delegate to themselves.')
  if (candidate.startsAt > candidate.endsAt) throw new Error('Delegation dates are invalid.')
  if (existing.some(item => item.id !== candidate.id && item.approverId === candidate.approverId && !item.revokedAt && item.startsAt <= candidate.endsAt && item.endsAt >= candidate.startsAt)) throw new Error('Delegation overlaps an existing period.')
}
