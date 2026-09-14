import { PageTitle } from '../../components/PageTitle';
import { Timeline } from '../../components/Timeline';
import { NotificationCenter } from '../../platform/notification-center';
const center = new NotificationCenter([{ id: 'review', title: 'Control review scheduled', detail: 'Operations and security owners have been assigned.', level: 'info', createdAt: '2026-09-12T08:00:00Z' }, { id: 'sync', title: 'Synchronization healthy', detail: 'The most recent revision has been reconciled.', level: 'info', createdAt: '2026-09-12T09:00:00Z', readAt: '2026-09-12T09:05:00Z' }]);
export function NotificationsPage() { return <main className="suite-page"><PageTitle eyebrow="NOTIFICATIONS" title="Operational inbox" detail={String(center.unread()) + ' unread notification'}/><Timeline items={center.list().map(item => ({ id: item.id, title: item.title, detail: item.detail, at: item.createdAt }))}/></main>; }
