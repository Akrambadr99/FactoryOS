import { describe, expect, it } from 'vitest';
import { product } from '../product/definition';
import { createSession } from './session';
describe('session', () => { it('derives actor capabilities', () => expect(createSession(product, 'actor-0').capabilities.length).toBeGreaterThan(0)); it('rejects unknown actors', () => expect(() => createSession(product, 'missing')).toThrow(/not found/)); it('keeps capabilities unique', () => { const values = createSession(product, 'actor-0').capabilities; expect(new Set(values).size).toBe(values.length); }); });
