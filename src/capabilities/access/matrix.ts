export interface AccessRule { role: string; resource: string; actions: readonly string[]; effect: 'allow' | 'deny' }
export interface AccessDecision { allowed: boolean; matchedRules: number; reason: string }
export function decideAccess(role: string, resource: string, action: string, rules: readonly AccessRule[]): AccessDecision {
  const matched = rules.filter(rule => (rule.role === role || rule.role === '*') && (rule.resource === resource || rule.resource === '*') && (rule.actions.includes(action) || rule.actions.includes('*')))
  if (matched.some(rule => rule.effect === 'deny')) return { allowed: false, matchedRules: matched.length, reason: 'An explicit deny rule matched.' }
  if (matched.some(rule => rule.effect === 'allow')) return { allowed: true, matchedRules: matched.length, reason: 'An allow rule matched.' }
  return { allowed: false, matchedRules: 0, reason: 'No allow rule matched.' }
}
export function actionsFor(role: string, resource: string, actions: readonly string[], rules: readonly AccessRule[]): string[] { return actions.filter(action => decideAccess(role, resource, action, rules).allowed) }
