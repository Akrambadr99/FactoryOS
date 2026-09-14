import { describe, expect, it } from 'vitest';
import { product } from '../product/definition';
import { fresh } from '../workspace/engine';
import { buildReadModel } from './read-model';
describe('workspace read model', () => { const model = buildReadModel(fresh(product), product); it('counts all records', () => expect(model.byKind.reduce((sum, item) => sum + item.count, 0)).toBe(model.totalRecords)); it('contains every configured kind', () => expect(model.byKind).toHaveLength(product.kinds.length)); it('starts at revision zero', () => expect(model.revision).toBe(0)); it('does not produce negative active counts', () => expect(model.byKind.every(item => item.active >= 0)).toBe(true)); });
