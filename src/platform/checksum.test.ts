import { describe, expect, it } from 'vitest';
import { checksum, stableJson } from './checksum';
describe('checksum', () => { it('sorts object keys', () => expect(stableJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')); it('is deterministic', () => expect(checksum({ a: [1, 2] })).toBe(checksum({ a: [1, 2] }))); });
