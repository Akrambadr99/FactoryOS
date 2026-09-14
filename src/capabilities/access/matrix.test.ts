import { describe, expect, it } from 'vitest'
import { actionsFor, decideAccess } from './matrix'
const rules = [{ role: 'editor', resource: 'record', actions: ['edit', 'delete'], effect: 'allow' as const }, { role: 'editor', resource: 'record', actions: ['delete'], effect: 'deny' as const }]
describe('access matrix', () => {
  it('gives explicit deny precedence', () => expect(decideAccess('editor', 'record', 'delete', rules).allowed).toBe(false))
  it('lists effective actions', () => expect(actionsFor('editor', 'record', ['view', 'edit', 'delete'], rules)).toEqual(['edit']))
})
