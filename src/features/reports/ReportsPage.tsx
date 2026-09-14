import { useAppServices } from '../../application/useAppServices';
import { DataTable, type TableColumn } from '../../components/DataTable';
import { PageTitle } from '../../components/PageTitle';
import { reportCsv } from '../../reporting/csv';
import { entityReport } from '../../reporting/report-builder';
import type { Entity } from '../../workspace/types';
const columns: TableColumn<Entity>[] = [{ key: 'title', label: 'Record', render: row => row.title }, { key: 'kind', label: 'Type', render: row => row.kind }, { key: 'status', label: 'Status', render: row => row.status }, { key: 'revision', label: 'Revision', render: row => row.revision }];
export function ReportsPage() { const { repository } = useAppServices(), snapshot = repository.read(), report = entityReport('Operational report', snapshot.entities, new Date().toISOString()); return <main className="suite-page"><PageTitle eyebrow="REPORTING" title="Operational reports" detail={'CSV-ready reporting model with ' + String(report.rows.length) + ' current records.'}/><DataTable caption="Current operational records" columns={columns} rows={snapshot.entities} rowKey={row => row.id}/><details><summary>Export preview</summary><pre>{reportCsv(report)}</pre></details></main>; }
