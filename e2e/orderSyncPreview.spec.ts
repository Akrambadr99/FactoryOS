import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { startReservationService } from './reservationService.js'

declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void }
declare const document: { documentElement: { scrollWidth: number } }
const endpoint = 'http://127.0.0.1:4404/api/reservations'
const previewEndpoint = endpoint + '/order-sync-preview'
const headers = { Origin: 'http://127.0.0.1:4304', 'X-FactoryOS-Client': 'reservations' }
const sourceKey = 'factoryos:production-orders:v1'
const acknowledgment = 'I understand removed order references leave this ledger; recorded history stays.'
interface BrowserCollection { orders: { id: string; aggregate: { order: { target: number; revision: number } } }[] }
interface Snapshot {
  revision: number
  orders: { id: string; target: number }[]
  reservations: { id: string; orderId: string; status: string; releaseReason: string | null }[]
  events: { sequence: number; kind: string; requestId: string }[]
}
let service: Awaited<ReturnType<typeof startReservationService>> | undefined
test.beforeEach(async () => { service = await startReservationService() })
test.afterEach(async () => {
  try { await service?.assertSqliteStorage() }
  finally { await service?.close(); service = undefined }
})

function review(page: Page) { return page.getByRole('region', { name: 'Review order synchronization', exact: true }) }
async function source(page: Page) { return page.evaluate(key => localStorage.getItem(key), sourceKey) }
async function prepare(page: Page) {
  await page.goto('/')
  const raw = await page.evaluate<string>('import("/src/execution/order-machine/orderCollection.ts").then(module => JSON.stringify(module.createOrder(module.seedOrderCollection(), "PO-9901", "assembly", "LOT-55")))')
  await page.evaluate(({ key, raw }) => { localStorage.setItem(key, raw) }, { key: sourceKey, raw })
  await page.goto('/execution/reservations?order=PO-9901&source=preview-proof')
  await connect(page)
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect reservation service', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh reservations', exact: true })).toBeEnabled()
}
async function inspect(page: Page) {
  await page.getByRole('button', { name: 'Sync saved orders', exact: true }).click()
  await expect(review(page)).toBeVisible()
  await expect(review(page).getByRole('heading', { name: 'Review order synchronization', exact: true })).toBeFocused()
}
async function confirm(page: Page) {
  const response = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Confirm order sync', exact: true }).click()
  return response
}
async function initialSync(page: Page) {
  await inspect(page)
  expect((await confirm(page)).ok()).toBe(true)
  await expect(review(page)).toHaveCount(0)
}
async function backend(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get(endpoint, { headers })
  expect(response.status()).toBe(200)
  return await response.json() as Snapshot
}
async function changeSource(page: Page, options: { remove?: string; update?: { id: string; target: number } }) {
  await page.evaluate(({ key, options }) => {
    const raw = localStorage.getItem(key)
    if (!raw) throw new Error('Missing browser collection fixture')
    const collection = JSON.parse(raw) as BrowserCollection
    if (options.remove) collection.orders = collection.orders.filter(order => order.id !== options.remove)
    if (options.update) {
      const order = collection.orders.find(order => order.id === options.update?.id)
      if (!order) throw new Error('Missing browser order fixture')
      order.aggregate.order.target = options.update.target
      order.aggregate.order.revision++
    }
    localStorage.setItem(key, JSON.stringify(collection))
  }, { key: sourceKey, options })
}
async function reserve(page: Page, orderId: string) {
  await page.getByRole('button', { name: 'Select order ' + orderId, exact: true }).click()
  await page.getByRole('combobox', { name: 'Stock lot', exact: true }).selectOption('MAT-ALLOY')
  await page.getByRole('spinbutton', { name: 'Units to reserve', exact: true }).fill('20')
  await page.getByRole('textbox', { name: 'Reservation note', exact: true }).fill('Planning allocation before sync review')
  const response = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Reserve material', exact: true }).click()
  expect((await response).ok()).toBe(true)
}
function gate() {
  let resolve = () => { /* Replaced synchronously by the promise constructor. */ }
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('order-sync preview is read-only and an identical collection cannot add another ledger event', async ({ page, request }) => {
  await prepare(page)
  const before = await backend(request), browserBytes = await source(page)
  await inspect(page)
  await expect(review(page)).toContainText(/Added\s*7/i)
  await expect(review(page)).toContainText(/Updated\s*0/i)
  await expect(review(page)).toContainText(/Removed\s*0/i)
  expect(await backend(request)).toEqual(before)
  expect(await source(page)).toBe(browserBytes)
  await review(page).getByRole('searchbox', { name: 'Find changed order', exact: true }).fill('PO-9901')
  await expect(review(page).getByRole('heading', { name: 'PO-9901 · Add', exact: true })).toBeVisible()
  await expect(review(page).getByRole('heading', { name: 'PO-8842 · Add', exact: true })).toHaveCount(0)
  expect((await confirm(page)).ok()).toBe(true)
  await expect(review(page)).toHaveCount(0)
  const committed = await backend(request)
  expect(committed.revision).toBe(1)
  expect(committed.orders).toHaveLength(7)
  await inspect(page)
  await expect(review(page)).toContainText(/Unchanged\s*7/i)
  await expect(page.getByRole('button', { name: 'Confirm order sync', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel sync review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sync saved orders', exact: true })).toBeFocused()
  expect(await backend(request)).toEqual(committed)
  expect(await source(page)).toBe(browserBytes)
})

test('removal requires a fresh acknowledgment, cancellation restores focus and recorded history stays', async ({ page, request }) => {
  await prepare(page)
  await initialSync(page)
  await reserve(page, 'PO-9901')
  const hold = (await backend(request)).reservations[0]
  if (!hold) throw new Error('Missing real reservation fixture')
  await page.getByRole('button', { name: 'Release ' + hold.id, exact: true }).click()
  await page.getByRole('textbox', { name: 'Release reason', exact: true }).fill('Production plan withdrawn before removal')
  await page.getByRole('button', { name: 'Release reservation', exact: true }).click()
  await expect.poll(async () => (await backend(request)).revision).toBe(3)
  const before = await backend(request)
  await changeSource(page, { remove: 'PO-9901' })
  await inspect(page)
  await expect(review(page)).toContainText(/Removed\s*1/i)
  await expect(review(page)).toContainText('PO-9901')
  const confirmButton = page.getByRole('button', { name: 'Confirm order sync', exact: true })
  const consent = page.getByRole('checkbox', { name: acknowledgment, exact: true })
  await expect(confirmButton).toBeDisabled()
  await consent.check()
  await expect(confirmButton).toBeEnabled()
  await page.getByRole('button', { name: 'Cancel sync review', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Sync saved orders', exact: true })).toBeFocused()
  expect(await backend(request)).toEqual(before)
  await inspect(page)
  await expect(consent).not.toBeChecked()
  await expect(confirmButton).toBeDisabled()
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate('window.scrollTo({ top: 0, left: 0, behavior: "instant" })')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `test-results/order-sync-review-${String(width)}.png`, fullPage: true })
    const [header, title, cancel, explanation] = await Promise.all([
      review(page).locator(':scope > header').boundingBox(),
      review(page).locator(':scope > header > div').boundingBox(),
      review(page).getByRole('button', { name: 'Cancel sync review', exact: true }).boundingBox(),
      review(page).locator(':scope > p').first().boundingBox(),
    ])
    if (!header || !title || !cancel || !explanation) throw new Error('Missing visible review layout bounds')
    for (const child of [title, cancel]) {
      expect(child.x, `Header content left edge at ${String(width)}px`).toBeGreaterThanOrEqual(header.x - 1)
      expect(child.x + child.width, `Header content right edge at ${String(width)}px`).toBeLessThanOrEqual(header.x + header.width + 1)
      expect(child.y, `Header content top edge at ${String(width)}px`).toBeGreaterThanOrEqual(header.y - 1)
      expect(child.y + child.height, `Header content bottom edge at ${String(width)}px`).toBeLessThanOrEqual(header.y + header.height + 1)
    }
    expect(explanation.y, `Review explanation must follow the entire header at ${String(width)}px`).toBeGreaterThanOrEqual(header.y + header.height - 1)
    expect(title.x + title.width <= cancel.x + 1 || cancel.x + cancel.width <= title.x + 1 ||
      title.y + title.height <= cancel.y + 1 || cancel.y + cancel.height <= title.y + 1,
    `Review title and cancel action must not overlap at ${String(width)}px`).toBe(true)
  }
  await consent.check()
  expect((await confirm(page)).ok()).toBe(true)
  await expect(review(page)).toHaveCount(0)
  const after = await backend(request)
  expect(after.revision).toBe(4)
  expect(after.orders.some(order => order.id === 'PO-9901')).toBe(false)
  expect(after.reservations).toEqual(before.reservations)
  expect(after.events.slice(0, before.events.length)).toEqual(before.events)
  await expect(page).toHaveURL(/order=PO-9901/)
  await expect(page).toHaveURL(/source=preview-proof/)
})

test('active holds block changed-order synchronization while URL selection and newer drafts remain intact', async ({ page, request }) => {
  await prepare(page)
  await initialSync(page)
  await reserve(page, 'PO-8842')
  await page.getByRole('button', { name: 'Select order PO-9901', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'PO-9901', exact: true })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Units to reserve', exact: true }).fill('17')
  await page.getByRole('textbox', { name: 'Reservation note', exact: true }).fill('Retained unsent planner draft')
  await expect(page.getByRole('spinbutton', { name: 'Units to reserve', exact: true })).toHaveValue('17')
  await expect(page.getByRole('textbox', { name: 'Reservation note', exact: true })).toHaveValue('Retained unsent planner draft')
  const address = page.url(), before = await backend(request)
  await changeSource(page, { remove: 'PO-8842', update: { id: 'PO-9901', target: 180 } })
  await inspect(page)
  await expect(page.getByRole('spinbutton', { name: 'Units to reserve', exact: true })).toHaveValue('17')
  await expect(page.getByRole('textbox', { name: 'Reservation note', exact: true })).toHaveValue('Retained unsent planner draft')
  await expect(review(page)).toContainText(/Updated\s*1/i)
  await expect(review(page)).toContainText(/Removed\s*1/i)
  await expect(review(page)).toContainText(/active hold/i)
  await review(page).getByRole('combobox', { name: 'Review changes', exact: true }).selectOption('blocked')
  await expect(review(page).getByRole('heading', { name: 'PO-8842 · Remove', exact: true })).toBeVisible()
  await expect(review(page).getByRole('heading', { name: 'PO-9901 · Update', exact: true })).toHaveCount(0)
  await page.getByRole('checkbox', { name: acknowledgment, exact: true }).check()
  await expect(page.getByRole('button', { name: 'Confirm order sync', exact: true })).toBeDisabled()
  expect(await backend(request)).toEqual(before)
  await page.getByRole('button', { name: 'Cancel sync review', exact: true }).click()
  await expect(page).toHaveURL(address)
  await expect(page.getByRole('spinbutton', { name: 'Units to reserve', exact: true })).toHaveValue('17')
  await expect(page.getByRole('textbox', { name: 'Reservation note', exact: true })).toHaveValue('Retained unsent planner draft')
})

test('changed browser source invalidates first confirmation without posting until explicitly reviewed again', async ({ page, request }) => {
  await prepare(page)
  await initialSync(page)
  await changeSource(page, { update: { id: 'PO-9901', target: 150 } })
  await inspect(page)
  const posted: string[] = []
  page.on('request', current => { if (current.url() === endpoint && current.method() === 'POST') posted.push(current.postData() ?? '') })
  await changeSource(page, { update: { id: 'PO-9901', target: 180 } })
  const latestBrowserBytes = await source(page)
  await page.getByRole('button', { name: 'Confirm order sync', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(/changed|review/i)
  expect(posted).toEqual([])
  expect((await backend(request)).revision).toBe(1)
  await page.getByRole('button', { name: 'Review latest saved orders', exact: true }).click()
  await expect(review(page).getByRole('heading', { name: 'Review order synchronization', exact: true })).toBeFocused()
  expect((await confirm(page)).ok()).toBe(true)
  const after = await backend(request)
  expect(after.revision).toBe(2)
  expect(after.orders.find(order => order.id === 'PO-9901')?.target).toBe(180)
  expect(posted).toHaveLength(1)
  expect(await source(page)).toBe(latestBrowserBytes)
})

test('a competing ledger revision rejects stale sync and exact retries until a new review is confirmed', async ({ page, context, request }) => {
  await prepare(page)
  await initialSync(page)
  const other = await context.newPage()
  await other.goto('/execution/reservations?order=PO-8842')
  await connect(other)
  await changeSource(page, { update: { id: 'PO-9901', target: 150 } })
  await inspect(page)
  await reserve(other, 'PO-8842')
  const posted: string[] = []
  page.on('request', current => { if (current.url() === endpoint && current.method() === 'POST') posted.push(current.postData() ?? '') })
  expect((await confirm(page)).status()).toBe(409)
  await expect(page.getByRole('alert')).toContainText(/revision|changed|conflict/i)
  await changeSource(page, { update: { id: 'PO-9901', target: 180 } })
  const retryResponse = page.waitForResponse(response => response.url() === endpoint && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Retry same request', exact: true }).click()
  expect((await retryResponse).status()).toBe(409)
  expect(posted).toHaveLength(2)
  expect(posted[1]).toBe(posted[0])
  expect((await backend(request)).revision).toBe(2)
  await page.getByRole('button', { name: 'Refresh reservations', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh reservations', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Discard pending request', exact: true }).click()
  await inspect(page)
  expect((await confirm(page)).ok()).toBe(true)
  const after = await backend(request)
  expect(after.revision).toBe(3)
  expect(after.orders.find(order => order.id === 'PO-9901')?.target).toBe(180)
  expect(posted).toHaveLength(3)
  expect(posted[2]).not.toBe(posted[0])
  expect(JSON.parse(posted[2] ?? '{}')).toMatchObject({ kind: 'sync-orders', expectedRevision: 2 })
  await other.close()
})

test('a lost sync acknowledgment retries the captured command after browser data changes without importing those changes', async ({ page, request }) => {
  await prepare(page)
  await inspect(page)
  const posted: string[] = []
  await page.route(endpoint, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    posted.push(route.request().postData() ?? '')
    const response = await route.fetch()
    if (posted.length === 1) { await route.abort('failed'); return }
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Confirm order sync', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry same request', exact: true })).toBeEnabled()
  expect((await backend(request)).revision).toBe(1)
  await changeSource(page, { update: { id: 'PO-9901', target: 180 } })
  const latestBrowserBytes = await source(page)
  await page.getByRole('button', { name: 'Retry same request', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry same request', exact: true })).toHaveCount(0)
  expect(posted).toHaveLength(2)
  expect(posted[1]).toBe(posted[0])
  const after = await backend(request)
  expect(after.revision).toBe(1)
  expect(after.events).toHaveLength(1)
  expect(after.orders.find(order => order.id === 'PO-9901')?.target).toBe(120)
  expect(await source(page)).toBe(latestBrowserBytes)
})

test('refresh cancels an in-flight preview and its late response cannot replace the current view or draft', async ({ page, request }) => {
  await prepare(page)
  await initialSync(page)
  await page.getByRole('textbox', { name: 'Reservation note', exact: true }).fill('Preserved while preview is pending')
  await changeSource(page, { update: { id: 'PO-9901', target: 180 } })
  const arrived = gate(), release = gate(), finished = gate()
  await page.route(previewEndpoint, async route => {
    const response = await route.fetch()
    arrived.resolve()
    await release.promise
    try { await route.fulfill({ response }) }
    catch { /* Refresh intentionally aborts the browser request. */ }
    finally { finished.resolve() }
  })
  try {
    await page.getByRole('button', { name: 'Sync saved orders', exact: true }).click()
    await arrived.promise
    await page.getByRole('button', { name: 'Refresh reservations', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Refresh reservations', exact: true })).toBeEnabled()
    release.resolve()
    await finished.promise
    await expect(review(page)).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Reservation note', exact: true })).toHaveValue('Preserved while preview is pending')
    await expect(page).toHaveURL(/order=PO-9901/)
    expect((await backend(request)).revision).toBe(1)
  } finally { release.resolve() }
})

test('a delayed preview does not steal focus from an actively edited reservation draft', async ({ page, request }) => {
  await prepare(page)
  await initialSync(page)
  await changeSource(page, { update: { id: 'PO-9901', target: 180 } })
  const arrived = gate(), release = gate()
  await page.route(previewEndpoint, async route => {
    const response = await route.fetch()
    arrived.resolve()
    await release.promise
    await route.fulfill({ response })
  })
  try {
    await page.getByRole('button', { name: 'Sync saved orders', exact: true }).click()
    await arrived.promise
    const note = page.getByRole('textbox', { name: 'Reservation note', exact: true })
    await note.fill('Planner continues editing')
    await expect(note).toBeFocused()
    release.resolve()
    await expect(review(page)).toBeVisible()
    await expect(note).toBeFocused()
    await expect(review(page).getByRole('heading', { name: 'Review order synchronization', exact: true })).not.toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type(' after review arrives')
    await expect(note).toHaveValue('Planner continues editing after review arrives')
    expect((await backend(request)).revision).toBe(1)
  } finally { release.resolve() }
})
