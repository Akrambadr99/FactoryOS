import { describe, expect, it } from 'vitest';
import { migrate } from './migration';
describe('migration', () => { it('runs an ordered upgrade', () => expect(migrate({ schema: 1, value: 'x' }, 2, [{ from: 1, to: 2, run: value => ({ ...value, schema: 2 }) }]).schema).toBe(2)); it('rejects missing steps', () => expect(() => migrate({ schema: 1 }, 3, [])).toThrow(/Missing migration/)); });
