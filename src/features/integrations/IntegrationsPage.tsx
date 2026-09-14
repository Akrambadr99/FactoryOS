import { PageTitle } from '../../components/PageTitle';
import { StatGrid } from '../../components/StatGrid';
import { SuiteCard } from '../../components/SuiteCard';
import { Outbox } from '../../platform/outbox';
const box = new Outbox();
box.enqueue({ id: 'bootstrap', topic: 'workspace.ready', payload: { source: 'local' }, createdAt: '2026-09-12T00:00:00Z', attempts: 0 });
export function IntegrationsPage() { return <main className="suite-page"><PageTitle eyebrow="INTEGRATIONS" title="Reliable delivery" detail="Transactional outbox, bounded retry and revision-aware synchronization isolate external failures."/><StatGrid items={[{ label: 'Pending delivery', value: String(box.size()) }, { label: 'Retry policy', value: 'Exponential' }, { label: 'Conflict mode', value: 'Revision guard' }]}/><div className="suite-grid"><SuiteCard title="Transactional outbox" detail="Idempotent messages remain pending until acknowledged."/><SuiteCard title="Retry controller" detail="Capped exponential delays handle transient failures."/><SuiteCard title="Sync engine" detail="Record revisions detect divergent concurrent updates."/></div></main>; }
