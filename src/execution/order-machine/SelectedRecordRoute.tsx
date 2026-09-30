import type { ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { RecordScope } from '../../workspace/RecordScope'
import { openSelectedRecord } from './selectedRecord'

export function SelectedRecordRoute({ children }: { children: ReactNode }) {
  const [params] = useSearchParams()
  const route = useParams()
  const id = params.get('record') ?? route['orderId'] ?? 'PO-8842'
  return <RecordScope id={id} back={'/execution/recovery-workspace?order=' + encodeURIComponent(id)}
    open={target => openSelectedRecord(window.localStorage, target)}>{children}</RecordScope>
}
