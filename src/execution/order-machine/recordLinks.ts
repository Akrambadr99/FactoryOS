import type { OrderCollection } from './orderCollection'

type Record = OrderCollection['orders'][number]
function selected(path: string, id: string) { return path + (path.includes('?') ? '&' : '?') + 'record=' + encodeURIComponent(id) }
export function recordDetailPath(record: Record) { return selected('/execution/orders/' + record.id, record.id) }
export function recordDecisionPath(record: Record) { return selected('/execution/lots/' + record.lotIndexId + '/genealogy?depth=1', record.id) }
