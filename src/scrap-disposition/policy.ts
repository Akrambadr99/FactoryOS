import { requireThat } from '../workspace/values'
export const workflowKey = "scrap-disposition"
export const workflowLabel = "Scrap disposition"
export const ruleKind = "threshold"
export interface ScrapDispositionRecord { measured: number; limit: number; evidence: string; revision: number }
export function validateAuthorization(record: ScrapDispositionRecord) {
  requireThat(Number.isSafeInteger(record.measured) && Number.isSafeInteger(record.limit), 'Workflow measurements must be safe integers.')
  requireThat(record.measured >= 0 && record.limit >= 0, 'Workflow measurements cannot be negative.')
  requireThat(record.measured <= record.limit, 'Scrap percentage exceed Maximum scrap percentage.')
  requireThat(record.evidence.trim().length >= 8, 'Scrap disposition require traceable evidence.')
  requireThat(record.revision > 0, 'Scrap disposition require a current record revision.')
  return { authorized: true as const, fingerprint: [workflowKey, record.measured, record.limit, record.revision].join(':') }
}
export function canRoleAdvance(role: string, phase: string) {
  const matrix: Record<string, readonly string[]> = { draft: ['coordinator'], review: ['reviewer'], authorized: ['operator'], active: ['owner'], blocked: ['reviewer'] }
  return (matrix[phase] ?? []).includes(role)
}
