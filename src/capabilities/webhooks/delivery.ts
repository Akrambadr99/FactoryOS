export interface WebhookDelivery { id: string; endpoint: string; event: string; attempts: number; status: 'queued' | 'delivering' | 'delivered' | 'failed'; lastError?: string | undefined; deliveredAt?: string | undefined }
export type DeliveryAction = { type: 'attempt' } | { type: 'succeed'; at: string } | { type: 'fail'; message: string; maximumAttempts: number }
export function reduceDelivery(delivery: WebhookDelivery, action: DeliveryAction): WebhookDelivery {
  if (delivery.status === 'delivered') return delivery
  if (action.type === 'attempt') return { ...delivery, attempts: delivery.attempts + 1, status: 'delivering', lastError: undefined }
  if (action.type === 'succeed') return { ...delivery, status: 'delivered', deliveredAt: action.at, lastError: undefined }
  return { ...delivery, status: delivery.attempts >= action.maximumAttempts ? 'failed' : 'queued', lastError: action.message }
}
export function deliveryKey(endpoint: string, eventId: string): string { return endpoint.toLowerCase() + '::' + eventId }
