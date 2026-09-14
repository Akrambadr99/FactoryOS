import type { Entity } from '../workspace/types';
import { StatePill } from './StatePill';
export function RecordTable({ rows }: {
    rows: readonly Entity[];
}) { return <div className="suite-table"><div className="suite-table-head"><b>Record</b><b>Type</b><b>State</b><b>Revision</b></div>{rows.map(row => <div key={row.id}><span><b>{row.title}</b><small>{row.id}</small></span><span>{row.kind}</span><StatePill value={row.status}/><span>r{row.revision}</span></div>)}</div>; }
