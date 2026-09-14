import { requireThat } from '../workspace/values'
export const workflowKey = "shift-handoff"
export const workflowLabel = "Shift handoff timing"
export const ruleKind = "window"
export interface ShiftHandoffRecord { measured: number; limit: number; evidence: string; revision: number }
export function validateAuthorization(record: ShiftHandoffRecord) {
  requireThat(Number.isSafeInteger(record.measured) && Number.isSafeInteger(record.limit), 'Workflow measurements must be safe integers.')
  requireThat(record.measured >= 0 && record.limit >= 0, 'Workflow measurements cannot be negative.')
  requireThat(record.measured <= record.limit, 'Handoff minute falls outside Latest handoff minute.')
  requireThat(record.evidence.trim().length >= 8, 'Shift handoff timing require traceable evidence.')
  requireThat(record.revision > 0, 'Shift handoff timing require a current record revision.')
  return { authorized: true as const, fingerprint: [workflowKey, record.measured, record.limit, record.revision].join(':') }
}
export function canRoleAdvance(role: string, phase: string) {
  const matrix: Record<string, readonly string[]> = { draft: ['coordinator'], review: ['reviewer'], authorized: ['operator'], active: ['owner'], blocked: ['reviewer'] }
  return (matrix[phase] ?? []).includes(role)
}
