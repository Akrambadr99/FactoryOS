import { describe, expect, it } from 'vitest'
import { deliveryKey, reduceDelivery, type WebhookDelivery } from './delivery'
const queued: WebhookDelivery = { id: 'd', endpoint: 'HTTPS://EXAMPLE.TEST', event: 'saved', attempts: 0, status: 'queued' }
describe('webhook delivery', () => {
  it('creates a stable idempotency key', () => expect(deliveryKey(queued.endpoint, 'e1')).toBe('https://example.test::e1'))
  it('requeues a transient failure', () => expect(reduceDelivery(reduceDelivery(queued, { type: 'attempt' }), { type: 'fail', message: 'offline', maximumAttempts: 3 }).status).toBe('queued'))
  it('makes successful delivery terminal', () => { const delivered = reduceDelivery(queued, { type: 'succeed', at: 'now' }); expect(reduceDelivery(delivered, { type: 'attempt' })).toBe(delivered) })
})
