import { describe, expect, it } from 'vitest';
import { SavedReportCatalog } from './saved-reports';
const report = { id: 'r1', name: 'Open', kind: 'work', statuses: ['open'], ownerId: 'u1', updatedAt: 'now' };
describe('saved reports', () => { it('scopes reports by owner', () => { const catalog = new SavedReportCatalog([report]); expect(catalog.list('u1')).toHaveLength(1); expect(catalog.list('u2')).toHaveLength(0); }); it('replaces an existing report', () => { const catalog = new SavedReportCatalog([report]); catalog.save({ ...report, name: 'Active' }); expect(catalog.list('u1')[0]?.name).toBe('Active'); }); });
