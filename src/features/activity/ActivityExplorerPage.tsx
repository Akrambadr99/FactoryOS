import { useState } from 'react'
import { useAppServices } from '../../application/useAppServices'
import { queryActivity } from '../../capabilities/activity/query'
import { EmptyState } from '../../components/EmptyState'
import { PageTitle } from '../../components/PageTitle'
import { Timeline } from '../../components/Timeline'
export function ActivityExplorerPage() {
  const { repository } = useAppServices()
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [text, setText] = useState('')
  const snapshot = repository.read()
  const actors = [...new Set(snapshot.audit.map(event => event.actor))].sort()
  const actions = [...new Set(snapshot.audit.map(event => event.action))].sort()
  const events = queryActivity(snapshot.audit, { ...(actor ? { actor } : {}), ...(action ? { action } : {}), ...(text ? { text } : {}) })
  return <main className="suite-page"><PageTitle eyebrow="ACTIVITY EXPLORER" title="Operational activity" detail="Combine actor, action, and text filters over immutable audit history."/><div className="filters"><select aria-label="Activity actor" value={actor} onChange={event => { setActor(event.target.value) }}><option value="">All actors</option>{actors.map(value => <option key={value}>{value}</option>)}</select><select aria-label="Activity action" value={action} onChange={event => { setAction(event.target.value) }}><option value="">All actions</option>{actions.map(value => <option key={value}>{value}</option>)}</select><input aria-label="Search activity" value={text} onChange={event => { setText(event.target.value) }} placeholder="Search history…"/></div>{events.length ? <Timeline items={events.map(event => ({ id: event.id, title: event.action, detail: event.summary, at: event.at }))}/> : <EmptyState title="No matching activity" detail="Change or clear the filters to see more history."/>}</main>
}
