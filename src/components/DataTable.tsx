/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- keyboard users need to reach horizontally scrollable data */
import type { ReactNode } from 'react';
export interface TableColumn<T> {
    key: string;
    label: string;
    render: (row: T) => ReactNode;
}
export function DataTable<T>({ caption, columns, rows, rowKey }: {
    caption: string;
    columns: readonly TableColumn<T>[];
    rows: readonly T[];
    rowKey: (row: T) => string;
}) { return <div className="suite-table-wrap" tabIndex={0} role="region" aria-label={caption}><table><caption>{caption}</caption><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td className="suite-table-empty" colSpan={columns.length}>No records match the current view.</td></tr> : rows.map(row => <tr key={rowKey(row)}>{columns.map(column => <td key={column.key} data-label={column.label}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>; }
