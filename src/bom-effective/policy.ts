import { requireThat } from '../workspace/values'
export const workflowKey = "bom-effective"
export const workflowLabel = "BOM effective revisions"
export const ruleKind = "dependency"
export interface BomEffectiveRecord { measured: number; limit: number; evidence: string; revision: number }
export function validateAuthorization(record: BomEffectiveRecord) {
  requireThat(Number.isSafeInteger(record.measured) && Number.isSafeInteger(record.limit), 'Workflow measurements must be safe integers.')
  requireThat(record.measured >= 0 && record.limit >= 0, 'Workflow measurements cannot be negative.')
  requireThat(record.measured === record.limit, 'Order BOM revision does not match Released BOM revision.')
  requireThat(record.evidence.trim().length >= 8, 'BOM effective revisions require traceable evidence.')
  requireThat(record.revision > 0, 'BOM effective revisions require a current record revision.')
  return { authorized: true as const, fingerprint: [workflowKey, record.measured, record.limit, record.revision].join(':') }
}
export function canRoleAdvance(role: string, phase: string) {
  const matrix: Record<string, readonly string[]> = { draft: ['coordinator'], review: ['reviewer'], authorized: ['operator'], active: ['owner'], blocked: ['reviewer'] }
  return (matrix[phase] ?? []).includes(role)
}
