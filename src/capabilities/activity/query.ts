export interface ActivityEvent { id: string; at: string; actor: string; action: string; entityIds: readonly string[]; summary: string }
export interface ActivityQuery { actor?: string; action?: string; entityId?: string; from?: string; to?: string; text?: string }
export function queryActivity<T extends ActivityEvent>(events: readonly T[], query: ActivityQuery): T[] {
  const text = query.text?.trim().toLowerCase()
  return events.filter(event =>
    (!query.actor || event.actor === query.actor) &&
    (!query.action || event.action === query.action) &&
    (!query.entityId || event.entityIds.includes(query.entityId)) &&
    (!query.from || event.at >= query.from) &&
    (!query.to || event.at <= query.to) &&
    (!text || event.summary.toLowerCase().includes(text))
  ).toSorted((left, right) => right.at.localeCompare(left.at))
}
