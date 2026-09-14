import type { Report } from './types';
function cell(value: string | number) { const text = String(value).replaceAll('"', '""'), quoted = text.includes(',') || text.includes('"') || text.includes(String.fromCharCode(10)); return quoted ? '"' + text + '"' : text; }
export function reportCsv<T>(report: Report<T>): string { return [report.columns.map(column => cell(column.label)).join(','), ...report.rows.map(row => report.columns.map(column => cell(column.value(row))).join(','))].join(String.fromCharCode(10)); }
