import { requireThat } from '../workspace/values'
export const workflowKey = "routing-step"
export const workflowLabel = "Routing execution"
export const ruleKind = "sequence"
export interface RoutingStepRecord { measured: number; limit: number; evidence: string; revision: number }
export function validateAuthorization(record: RoutingStepRecord) {
  requireThat(Number.isSafeInteger(record.measured) && Number.isSafeInteger(record.limit), 'Workflow measurements must be safe integers.')
  requireThat(record.measured >= 0 && record.limit >= 0, 'Workflow measurements cannot be negative.')
  requireThat(record.measured >= record.limit, 'Completed routing step have not reached Required routing step.')
  requireThat(record.evidence.trim().length >= 8, 'Routing execution require traceable evidence.')
  requireThat(record.revision > 0, 'Routing execution require a current record revision.')
  return { authorized: true as const, fingerprint: [workflowKey, record.measured, record.limit, record.revision].join(':') }
}
export function canRoleAdvance(role: string, phase: string) {
  const matrix: Record<string, readonly string[]> = { draft: ['coordinator'], review: ['reviewer'], authorized: ['operator'], active: ['owner'], blocked: ['reviewer'] }
  return (matrix[phase] ?? []).includes(role)
}
