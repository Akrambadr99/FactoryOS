import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { startReservationService } from './reservationService.js'

declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void }
declare const document: { documentElement: { scrollWidth: number } }
const endpoint = 'http://127.0.0.1:4404/api/reservations'
const headers = { Origin: 'http://127.0.0.1:4304', 'X-FactoryOS-Client': 'reservations' }
const storageKeys = ['factoryos:production-orders:v1', 'factoryos:order:PO-8842:v1', 'reservation:unrelated'] as const
interface ServerSnapshot { revision: number; reservations: { id: string; orderId: string; quantity: number; note: string; status: string; releaseReason: string | null }[] }
let service: Awaited<ReturnType<typeof startReservationService>> | undefined
test.beforeEach(async () => { service = await startReservationService() })
test.afterEach(async () => {
  try { await service?.assertSqliteStorage() }
  finally { await service?.close(); service = undefined }
})

async function saved(page: Page) {
  return page.evaluate(keys => keys.map(key => [key, localStorage.getItem(key)]), storageKeys)
}
async function prepare(page: Page) {
  await page.goto('/')
  const raw = await page.evaluate<string>('import("/src/execution/order-machine/orderCollection.ts").then(module => JSON.stringify(module.createOrder(module.seedOrderCollection(), "PO-9901", "assembly", "LOT-55")))')
  await page.evaluate(({ keys, raw }) => {
    localStorage.setItem(keys[0], raw)
    localStorage.setItem(keys[1], 'retained legacy bytes')
    localStorage.setItem(keys[2], 'retained unrelated bytes')
  }, { keys: storageKeys, raw })
  await page.goto('/execution/reservations?order=PO-8842&source=browser-proof')
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect reservation service', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh reservations', exact: true })).toBeEnabled()
}
async function connectAndSync(page: Page) {
  await connect(page)
  await page.getByRole('button', { name: 'Sync saved orders', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Select order PO-8842', exact: true })).toBeVisible()
}
async function draft(page: Page, quantity: string, note: string) {
  await page.getByRole('combobox', { name: 'Stock lot', exact: true }).selectOption('MAT-ALLOY')
  await page.getByRole('spinbutton', { name: 'Units to reserve', exact: true }).fill(quantity)
  await page.getByRole('textbox', { name: 'Reservation note', exact: true }).fill(note)
}
async function reserve(page: Page) {
  const response = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Reserve material', exact: true }).click()
  return response
}
async function backend(request: APIRequestContext): Promise<ServerSnapshot> {
  const response = await request.get(endpoint, { headers })
  expect(response.status()).toBe(200)
  return await response.json() as ServerSnapshot
}
async function firstReservation(request: APIRequestContext) {
  const first = (await backend(request)).reservations[0]
  if (!first) throw new Error('Expected a reservation in the real service ledger')
  return first
}

test('reservation selection and filters survive reconnect without replacing hidden selection', async ({ page, request }) => {
  await prepare(page)
  const serviceRequests: string[] = []
  page.on('request', current => { if (current.url() === endpoint) serviceRequests.push(current.method()) })
  const upgradeHelp = page.getByText('Upgrading an existing JSON ledger?', { exact: true })
  const previewCommand = page.getByText('npm run reservations:migrate -- preview', { exact: true })
  await expect(previewCommand).not.toBeVisible()
  await upgradeHelp.focus()
  await page.keyboard.press('Enter')
  await expect(previewCommand).toBeVisible()
  expect(serviceRequests).toEqual([])
  expect((await backend(request)).revision).toBe(0)
  await connectAndSync(page)
  await page.getByRole('button', { name: 'Select order PO-9901', exact: true }).click()
  await page.getByLabel('Find order', { exact: true }).fill('PO-8842')
  await expect(page.getByRole('heading', { name: 'PO-9901', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Select order PO-9901', exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/order=PO-9901/)
  await expect(page).toHaveURL(/source=browser-proof/)
  await page.reload()
  await connect(page)
  await expect(page.getByLabel('Find order', { exact: true })).toHaveValue('PO-8842')
  await expect(page.getByRole('heading', { name: 'PO-9901', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Order state', exact: true }).selectOption('all')
  await page.getByLabel('Find order', { exact: true }).fill('')
  await expect(page.getByRole('button', { name: 'Select order PO-8847', exact: true })).toBeVisible()
})

test('real reservation persists across browser refresh without changing local execution data', async ({ page, request }) => {
  await prepare(page)
  const before = await saved(page)
  await connectAndSync(page)
  await draft(page, '40', 'Assembly shift allocation')
  expect((await reserve(page)).ok()).toBe(true)
  await expect.poll(async () => (await backend(request)).reservations.length).toBe(1)
  const recorded = await firstReservation(request)
  expect(recorded).toMatchObject({ orderId: 'PO-8842', quantity: 40, note: 'Assembly shift allocation', status: 'active' })
  await page.reload()
  await connect(page)
  await expect(page.getByRole('button', { name: 'Release ' + recorded.id, exact: true })).toBeVisible()
  expect(await saved(page)).toEqual(before)
})

test('two views recover a stale revision without losing draft or automatically resubmitting it', async ({ page, context, request }) => {
  await prepare(page)
  await connectAndSync(page)
  const other = await context.newPage()
  await other.goto('/execution/reservations?order=PO-8842')
  await connect(other)
  await draft(other, '30', 'Retained second-view request')
  await page.getByRole('button', { name: 'Select order PO-9901', exact: true }).click()
  await draft(page, '40', 'First-view request')
  expect((await reserve(page)).ok()).toBe(true)
  expect((await reserve(other)).status()).toBe(409)
  await expect(other.getByRole('alert')).toContainText(/revision|changed|conflict/i)
  await expect(other.getByRole('spinbutton', { name: 'Units to reserve', exact: true })).toHaveValue('30')
  await expect(other.getByRole('textbox', { name: 'Reservation note', exact: true })).toHaveValue('Retained second-view request')
  await expect(other.getByRole('button', { name: 'Retry same request', exact: true })).toBeVisible()
  await other.getByRole('button', { name: 'Refresh reservations', exact: true }).click()
  await expect(other.getByRole('button', { name: 'Reserve material', exact: true })).toBeDisabled()
  expect((await backend(request)).reservations).toHaveLength(1)
  await other.getByRole('button', { name: 'Discard pending request', exact: true }).click()
  await expect(other.getByRole('textbox', { name: 'Reservation note', exact: true })).toHaveValue('Retained second-view request')
  expect((await reserve(other)).ok()).toBe(true)
  expect((await backend(request)).reservations.map(item => item.quantity).sort((a, b) => a - b)).toEqual([30, 40])
  await other.close()
})

test('a lost real-server acknowledgment retries the same request exactly once and preserves newer edits', async ({ page, request }) => {
  await prepare(page)
  await connectAndSync(page)
  const submitted: string[] = []
  await page.route(endpoint, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    submitted.push(route.request().postData() ?? '')
    // Forward to the actual service before dropping only the first response.
    const response = await route.fetch()
    if (submitted.length === 1) { await route.abort('failed'); return }
    await route.fulfill({ response })
  })
  await draft(page, '20', 'Captured request')
  await page.getByRole('button', { name: 'Reserve material', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry same request', exact: true })).toBeVisible()
  expect((await backend(request)).reservations).toHaveLength(1)
  await draft(page, '35', 'Newer unsent draft')
  await page.getByRole('button', { name: 'Retry same request', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry same request', exact: true })).toHaveCount(0)
  expect(submitted).toHaveLength(2)
  expect(submitted[1]).toBe(submitted[0])
  const reservations = (await backend(request)).reservations
  expect(reservations).toHaveLength(1)
  expect(reservations[0]).toMatchObject({ quantity: 20, note: 'Captured request' })
  await expect(page.getByRole('spinbutton', { name: 'Units to reserve', exact: true })).toHaveValue('35')
  await expect(page.getByRole('textbox', { name: 'Reservation note', exact: true })).toHaveValue('Newer unsent draft')
})

test('release confirmation supports keyboard cancel and focuses an exact retry before recording its reason', async ({ page, request }) => {
  await prepare(page)
  await connectAndSync(page)
  await draft(page, '20', 'Release example')
  expect((await reserve(page)).ok()).toBe(true)
  const id = (await firstReservation(request)).id
  const trigger = page.getByRole('button', { name: 'Release ' + id, exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Release material reservation', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Release material reservation' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Keep reservation' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('textbox', { name: 'Release reason', exact: true })).toBeFocused()
  await dialog.getByRole('textbox', { name: 'Release reason', exact: true }).fill('Planning changed')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect((await firstReservation(request)).status).toBe('active')
  const submitted: string[] = []
  await page.route(endpoint, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    submitted.push(route.request().postData() ?? '')
    // The first release fails before reaching the service; the retry uses the real ledger.
    if (submitted.length === 1) { await route.abort('failed'); return }
    await route.continue()
  })
  await trigger.click()
  await dialog.getByRole('textbox', { name: 'Release reason', exact: true }).fill('Planning changed')
  await dialog.getByRole('button', { name: 'Release reservation', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('alert')).toBeVisible()
  const retry = page.getByRole('button', { name: 'Retry same request', exact: true })
  await expect(retry).toBeEnabled()
  await expect(retry).toBeFocused()
  expect((await backend(request)).revision).toBe(2)
  expect((await firstReservation(request)).status).toBe('active')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await firstReservation(request)).status).toBe('released')
  expect(submitted).toHaveLength(2)
  expect(submitted[1]).toBe(submitted[0])
  expect(JSON.parse(submitted[0] ?? '{}')).toMatchObject({ kind: 'release', reservationId: id, reason: 'Planning changed', expectedRevision: 2 })
  expect((await firstReservation(request)).releaseReason).toBe('Planning changed')
  await expect(page.getByRole('status')).toBeFocused()
})

test('selected reservation workflow remains usable at tablet and mobile widths with an empty filtered list', async ({ page }) => {
  await prepare(page)
  await connectAndSync(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate('window.scrollTo({ top: 0, left: 0, behavior: "instant" })')
  const skip = page.getByRole('link', { name: 'Skip to main content', exact: true })
  await expect(skip).toHaveCSS('position', 'fixed')
  await expect(skip).not.toBeInViewport()
  await skip.focus()
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  await draft(page, '24', 'Desktop material planning review')
  expect((await reserve(page)).ok()).toBe(true)
  await expect(page.getByRole('button', { name: /^Release [0-9a-f-]+$/ })).toBeVisible()
  await page.evaluate('window.scrollTo({ top: 0, left: 0, behavior: "instant" })')
  await expect(skip).not.toBeInViewport()
  await expect.poll(() => page.evaluate<number>('window.scrollY')).toBe(0)
  await page.screenshot({ path: 'test-results/reservations-1440.png', fullPage: true })
  await page.getByLabel('Find order', { exact: true }).fill('unmatched-order')
  await expect(page.getByRole('button', { name: /^Select order / })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'PO-8842', exact: true })).toBeVisible()
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate('window.scrollTo({ top: 0, left: 0, behavior: "instant" })')
    await expect.poll(() => page.evaluate<number>('window.scrollY')).toBe(0)
    await expect(skip).not.toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(page.getByRole('combobox', { name: 'Stock lot', exact: true })).toBeVisible()
    await expect(page.getByLabel('Units to reserve', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reserve material', exact: true })).toBeVisible()
    await page.screenshot({ path: 'test-results/reservations-' + String(width) + '.png', fullPage: true })
  }
})
