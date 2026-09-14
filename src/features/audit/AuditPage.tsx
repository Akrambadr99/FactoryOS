import { useAppServices } from '../../application/useAppServices';
import { EmptyPanel } from '../../components/EmptyPanel';
import { PageTitle } from '../../components/PageTitle';
import { SuiteCard } from '../../components/SuiteCard';
export function AuditPage() { const { repository } = useAppServices(), snapshot = repository.read(); return <main className="suite-page"><PageTitle eyebrow="IMMUTABLE EVIDENCE" title="Audit timeline" detail="Commands retain actor, timestamp, affected records and a human-readable outcome."/>{snapshot.audit.length === 0 ? <EmptyPanel title="No commands recorded" detail="Run a workflow operation to create the first audit event."/> : <div className="suite-stack">{snapshot.audit.toReversed().map(event => <SuiteCard key={event.id} title={event.summary} detail={event.actor + ' · ' + new Date(event.at).toLocaleString()}><p>{event.action} · {event.entityIds.join(', ')}</p></SuiteCard>)}</div>}</main>; }
