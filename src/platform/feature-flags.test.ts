import { describe, expect, it } from 'vitest';
import { isFeatureEnabled } from './feature-flags';
describe('feature flags', () => { it('enforces role targeting', () => expect(isFeatureEnabled({ key: 'reports', enabled: true, roles: ['admin'] }, 'viewer', 'u1')).toBe(false)); it('allows a fully rolled out feature', () => expect(isFeatureEnabled({ key: 'reports', enabled: true, percentage: 100 }, 'viewer', 'u1')).toBe(true)); });
