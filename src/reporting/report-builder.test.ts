import { describe, expect, it } from 'vitest';
import { entityReport } from './report-builder';
describe('report builder', () => { it('builds a status summary', () => expect(entityReport('Ops', [{ id: 'x', kind: 'work', title: 'X', status: 'open', revision: 1, fields: {} }], 'now').summary).toEqual({ records: 1, statuses: 1 })); });
