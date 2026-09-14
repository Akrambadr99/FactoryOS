import { requireThat } from '../workspace/values'
export const workflowKey = "rework-release"
export const workflowLabel = "Rework release"
export const ruleKind = "qualification"
export interface ReworkReleaseRecord { measured: number; limit: number; evidence: string; revision: number }
export function validateAuthorization(record: ReworkReleaseRecord) {
  requireThat(Number.isSafeInteger(record.measured) && Number.isSafeInteger(record.limit), 'Workflow measurements must be safe integers.')
  requireThat(record.measured >= 0 && record.limit >= 0, 'Workflow measurements cannot be negative.')
  requireThat(record.measured >= record.limit, 'Operator certification fall below Minimum certification.')
  requireThat(record.evidence.trim().length >= 8, 'Rework release require traceable evidence.')
  requireThat(record.revision > 0, 'Rework release require a current record revision.')
  return { authorized: true as const, fingerprint: [workflowKey, record.measured, record.limit, record.revision].join(':') }
}
export function canRoleAdvance(role: string, phase: string) {
  const matrix: Record<string, readonly string[]> = { draft: ['coordinator'], review: ['reviewer'], authorized: ['operator'], active: ['owner'], blocked: ['reviewer'] }
  return (matrix[phase] ?? []).includes(role)
}
