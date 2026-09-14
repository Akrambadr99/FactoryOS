import { describe, expect, it } from 'vitest';
import { movingAverage, trend } from './trend';
describe('trend', () => { it('detects growth', () => expect(trend([{ period: 'a', value: 1 }, { period: 'b', value: 3 }])).toEqual({ change: 2, direction: 'up' })); it('averages a rolling window', () => expect(movingAverage([{ period: 'a', value: 2 }, { period: 'b', value: 4 }], 2)[1]?.value).toBe(3)); });
