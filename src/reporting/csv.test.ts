import { describe, expect, it } from 'vitest';
import { reportCsv } from './csv';
describe('csv', () => {
    it('escapes cells', () => expect(reportCsv({ title: 'x', generatedAt: 'now', columns: [{ key: 'name', label: 'Name', value: (row: {
                    name: string;
                }) => row.name }], rows: [{ name: 'A, "B"' }], summary: {} })).toContain('"A, ""B"""'));
});
