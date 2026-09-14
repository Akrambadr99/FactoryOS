import { Link } from 'react-router-dom';
import { useAppServices } from '../../application/useAppServices';
import { buildReadModel } from '../../application/read-model';
import { ArchitectureDiagram } from '../../components/ArchitectureDiagram';
import { PageTitle } from '../../components/PageTitle';
import { StatGrid } from '../../components/StatGrid';
import { SuiteCard } from '../../components/SuiteCard';
export function DashboardPage() { const { product, repository } = useAppServices(), snapshot = repository.read(), model = buildReadModel(snapshot, product); return <main className="suite-page"><PageTitle eyebrow="CONSTRUCTION DELIVERY" title={product.name + ' command center'} detail="A connected view of operational records, governed workflows and decision evidence."/><StatGrid items={[{ label: 'Workspace revision', value: String(model.revision) }, { label: 'Connected records', value: String(model.totalRecords) }, { label: 'Domain modules', value: String(product.kinds.length) }, { label: 'Audit events', value: String(model.auditEvents) }]}/><SuiteCard title="Architecture flow" detail="Every write follows the same validated application boundary."><ArchitectureDiagram /></SuiteCard><div className="suite-grid">{model.byKind.map(item => <Link className="suite-link-card" key={item.kind} to="/operations"><b>{item.label}</b><strong>{item.count}</strong><small>{item.active} active records</small></Link>)}</div></main>; }
