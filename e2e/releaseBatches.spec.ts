import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { startReservationService } from './reservationService.js'

declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void }
declare const document: { documentElement: { scrollWidth: number } }
const endpoint = 'http://127.0.0.1:4404/api/reservations'
const batchEndpoint = endpoint + '/release-batch'
const headers = { Origin: 'http://127.0.0.1:4304', 'X-FactoryOS-Client': 'reservations' }
const storageKeys = ['factoryos:production-orders:v1', 'factoryos:order:PO-8842:v1', 'batch:unrelated'] as const
interface Hold {
  id: string
  orderId: string
  lotId: string
  quantity: number
  note: string
  status: 'active' | 'released'
  releaseReason: string | null
}
interface Snapshot {
  revision: number
  reservations: Hold[]
  events: { sequence: number; kind: string; requestId: string; reservationId: string | null }[]
}
interface BatchBody { expectedRevision: number; reason: string; releases: { requestId: string; reservationId: string }[] }
let service: Awaited<ReturnType<typeof startReservationService>> | undefined

test.beforeEach(async () => { service = await startReservationService() })
test.afterEach(async () => {
  try { await service?.assertSqliteStorage() }
  finally { await service?.close(); service = undefined }
})

function workbench(page: Page) { return page.getByRole('region', { name: 'Active material holds', exact: true }) }
function dialog(page: Page) { return page.getByRole('dialog', { name: 'Release selected material holds', exact: true }) }
function selection(page: Page, id: string) { return workbench(page).getByRole('checkbox', { name: 'Select hold ' + id, exact: true }) }
function holdAt(snapshot: Snapshot, index: number): Hold {
  const hold = snapshot.reservations[index]
  if (!hold) throw new Error('Missing real hold fixture at index ' + String(index))
  return hold
}
async function saved(page: Page) { return page.evaluate(keys => keys.map(key => [key, localStorage.getItem(key)]), storageKeys) }
async function backend(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get(endpoint, { headers })
  expect(response.status()).toBe(200)
  return await response.json() as Snapshot
}
async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect reservation service', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh reservations', exact: true })).toBeEnabled()
}
async function refresh(page: Page, revision: number) {
  await page.getByRole('button', { name: 'Refresh reservations', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh reservations', exact: true })).toBeEnabled()
  await expect(page.getByText('Ledger revision ' + String(revision) + ' · Last successfully loaded state', { exact: true })).toBeVisible()
}
async function prepare(page: Page, request: APIRequestContext, count = 3): Promise<Snapshot> {
  await page.goto('/')
  const raw = await page.evaluate<string>(`import("/src/execution/order-machine/orderCollection.ts").then(module => {
    let collection = module.seedOrderCollection();
    for (let index = 0; index < ${String(count)}; index++) {
      const line = index % 2 ? 'packaging' : 'assembly';
      collection = module.createOrder(collection, 'PO-' + (10000 + index), line, line === 'assembly' ? 'LOT-55' : 'LOT-76');
    }
    return JSON.stringify(collection);
  })`)
  await page.evaluate(({ keys, raw }) => {
    localStorage.setItem(keys[0], raw)
    localStorage.setItem(keys[1], 'retained legacy bytes')
    localStorage.setItem(keys[2], 'retained unrelated bytes')
  }, { keys: storageKeys, raw })
  await page.goto('/execution/reservations?order=PO-10000&source=batch-proof')
  await connect(page)
  await page.getByRole('button', { name: 'Sync saved orders', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Review order synchronization', exact: true })).toBeVisible()
  const synced = page.waitForResponse(current => current.url() === endpoint && current.request().method() === 'POST')
  await page.getByRole('button', { name: 'Confirm order sync', exact: true }).click()
  expect((await synced).status()).toBe(200)
  await expect(page.getByRole('region', { name: 'Review order synchronization', exact: true })).toHaveCount(0)
  let snapshot = await backend(request)
  // Create real holds through the same durable HTTP command boundary; the browser
  // exercises selection/review/release rather than repeating unrelated setup forms.
  for (let index = 0; index < count; index++) {
    const response = await request.post(endpoint, { headers, data: {
      kind: 'reserve', requestId: randomUUID(), expectedRevision: snapshot.revision,
      orderId: 'PO-' + String(10000 + index), lotId: index % 2 ? 'MAT-PACK' : 'MAT-ALLOY',
      quantity: index % 3 + 1, note: 'Planner allocation ' + String(index + 1),
    } })
    expect(response.status()).toBe(200)
    snapshot = (await response.json() as { snapshot: Snapshot }).snapshot
  }
  await refresh(page, snapshot.revision)
  return snapshot
}
async function openWorkbench(page: Page) {
  await expect(workbench(page)).not.toBeVisible()
  await page.getByText('Manage active holds', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(workbench(page)).toBeVisible()
}
async function selectHolds(page: Page, holds: Hold[]) {
  for (const hold of holds) {
    await workbench(page).getByRole('searchbox', { name: 'Find active hold', exact: true }).fill(hold.orderId)
    await selection(page, hold.id).check()
  }
  await workbench(page).getByRole('searchbox', { name: 'Find active hold', exact: true }).fill('')
}
async function reviewSelected(page: Page, reason: string) {
  await workbench(page).getByRole('button', { name: 'Review selected releases', exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByRole('heading', { name: 'Release selected material holds', exact: true })).toBeFocused()
  await dialog(page).getByRole('textbox', { name: 'Batch release reason', exact: true }).fill(reason)
}
async function confirm(page: Page) {
  const response = page.waitForResponse(current => current.url() === batchEndpoint && current.request().method() === 'POST')
  await dialog(page).getByRole('button', { name: 'Release selected holds', exact: true }).click()
  return response
}
function recordBatches(page: Page) {
  const bodies: string[] = []
  page.on('request', current => { if (current.url() === batchEndpoint && current.method() === 'POST') bodies.push(current.postData() ?? '') })
  return bodies
}
function gate() {
  let resolve = () => { /* Replaced synchronously by the promise constructor. */ }
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function scrollTop(locator: Locator): Promise<number> {
  return locator.evaluate((element: { scrollTop: number }) => element.scrollTop)
}

test('hidden hold selections remain explicit and batch confirmation releases exactly the captured subset', async ({ page, request }) => {
  const before = await prepare(page, request), bytes = await saved(page)
  const first = holdAt(before, 0), second = holdAt(before, 1), untouched = holdAt(before, 2)
  await openWorkbench(page)
  await selectHolds(page, [first, second])
  await workbench(page).getByRole('combobox', { name: 'Hold production line', exact: true }).selectOption('assembly')
  await workbench(page).getByRole('searchbox', { name: 'Find active hold', exact: true }).fill(untouched.orderId)
  await expect(workbench(page)).toContainText('2 selected · 2 outside this view')
  await expect(selection(page, untouched.id)).not.toBeChecked()
  const bodies = recordBatches(page)
  await reviewSelected(page, 'Release only the two reviewed planning holds')
  await expect(dialog(page)).toContainText(first.orderId)
  await expect(dialog(page)).toContainText(second.orderId)
  await expect(dialog(page)).not.toContainText(untouched.orderId)
  expect((await confirm(page)).status()).toBe(200)
  await expect(dialog(page)).toHaveCount(0)
  const after = await backend(request)
  expect(after.revision).toBe(before.revision + 2)
  expect(after.reservations.filter(hold => hold.status === 'released').map(hold => hold.id).sort()).toEqual([first.id, second.id].sort())
  expect(after.reservations.find(hold => hold.id === untouched.id)).toEqual(untouched)
  expect(after.events.slice(0, before.events.length)).toEqual(before.events)
  expect(after.events.slice(before.events.length).map(event => event.kind)).toEqual(['release', 'release'])
  expect(bodies).toHaveLength(1)
  const command = JSON.parse(bodies[0] ?? '{}') as BatchBody
  expect(command.expectedRevision).toBe(before.revision)
  expect(command.releases.map(item => item.reservationId).sort()).toEqual([first.id, second.id].sort())
  await expect(workbench(page)).toContainText('0 selected')
  expect(await saved(page)).toEqual(bytes)
  await expect(page).toHaveURL(/order=PO-10000&source=batch-proof/)
})

test('batch review supports keyboard cancellation, reason recovery and contained responsive controls without writing', async ({ page, request }) => {
  const before = await prepare(page, request)
  await openWorkbench(page)
  await selectHolds(page, [holdAt(before, 0), holdAt(before, 1)])
  const bodies = recordBatches(page)
  const reason = 'Planning decision retained while reviewing the selected holds'
  await reviewSelected(page, reason)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(workbench(page).getByRole('button', { name: 'Review selected releases', exact: true })).toBeFocused()
  await workbench(page).getByRole('button', { name: 'Review selected releases', exact: true }).click()
  const captured = dialog(page).getByRole('list', { name: 'Captured holds', exact: true })
  const reasonField = dialog(page).getByRole('textbox', { name: 'Batch release reason', exact: true })
  await expect(dialog(page).getByRole('heading', { name: 'Release selected material holds', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(captured).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(reasonField).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(captured).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog(page).getByRole('button', { name: 'Release selected holds', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(captured).toBeFocused()
  await expect(reasonField).toHaveValue(reason)
  await reasonField.fill('short')
  await expect(dialog(page).getByRole('button', { name: 'Release selected holds', exact: true })).toBeDisabled()
  await reasonField.fill(reason)
  await expect(dialog(page).getByRole('button', { name: 'Release selected holds', exact: true })).toBeEnabled()
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate('window.scrollTo({ top: 0, left: 0, behavior: "instant" })')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `test-results/release-batch-review-${String(width)}.png`, animations: 'disabled' })
    const [bounds, reasonBounds, confirmBounds, cancelBounds] = await Promise.all([
      dialog(page).boundingBox(), reasonField.boundingBox(),
      dialog(page).getByRole('button', { name: 'Release selected holds', exact: true }).boundingBox(),
      dialog(page).getByRole('button', { name: 'Keep selected holds', exact: true }).boundingBox(),
    ])
    if (!bounds || !reasonBounds || !confirmBounds || !cancelBounds) throw new Error('Missing visible batch review layout bounds')
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000)
    for (const child of [reasonBounds, confirmBounds, cancelBounds]) {
      expect(child.x).toBeGreaterThanOrEqual(bounds.x)
      expect(child.x + child.width).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(child.y).toBeGreaterThanOrEqual(bounds.y)
      expect(child.y + child.height).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
    expect(confirmBounds.x + confirmBounds.width <= cancelBounds.x + 1 || cancelBounds.x + cancelBounds.width <= confirmBounds.x + 1 ||
      confirmBounds.y + confirmBounds.height <= cancelBounds.y + 1 || cancelBounds.y + cancelBounds.height <= confirmBounds.y + 1).toBe(true)
  }
  await dialog(page).getByRole('button', { name: 'Keep selected holds', exact: true }).click()
  await expect(workbench(page).getByRole('button', { name: 'Review selected releases', exact: true })).toBeFocused()
  await expect(workbench(page)).toContainText('2 selected · 0 outside this view')
  expect(bodies).toEqual([])
  expect(await backend(request)).toEqual(before)
})

test('a competing tab causes atomic revision failure and exact retry until an explicitly refreshed review', async ({ page, context, request }) => {
  const before = await prepare(page, request)
  const first = holdAt(before, 0), second = holdAt(before, 1), otherHold = holdAt(before, 2)
  await openWorkbench(page)
  await selectHolds(page, [first, second])
  await reviewSelected(page, 'Two selected holds reviewed before a competing service change')
  const other = await context.newPage()
  await other.goto('/execution/reservations?order=' + otherHold.orderId)
  await connect(other)
  await other.getByRole('button', { name: 'Release ' + otherHold.id, exact: true }).click()
  await other.getByRole('textbox', { name: 'Release reason', exact: true }).fill('Independent planner released the unselected hold')
  await other.getByRole('button', { name: 'Release reservation', exact: true }).click()
  await expect.poll(async () => (await backend(request)).revision).toBe(before.revision + 1)
  const winner = await backend(request), bodies = recordBatches(page)
  expect((await confirm(page)).status()).toBe(409)
  await expect(page.getByRole('alert')).toContainText(/revision|changed|conflict/i)
  expect(await backend(request)).toEqual(winner)
  await expect(workbench(page)).toContainText('2 selected')
  const retryResponse = page.waitForResponse(current => current.url() === batchEndpoint && current.request().method() === 'POST')
  await page.getByRole('button', { name: 'Retry same request', exact: true }).click()
  expect((await retryResponse).status()).toBe(409)
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
  expect(await backend(request)).toEqual(winner)
  await refresh(page, winner.revision)
  await page.getByRole('button', { name: 'Discard pending request', exact: true }).click()
  await reviewSelected(page, 'Explicitly reviewed again after loading the latest ledger')
  expect((await confirm(page)).status()).toBe(200)
  const after = await backend(request)
  expect(after.revision).toBe(winner.revision + 2)
  expect(after.reservations.every(hold => hold.status === 'released')).toBe(true)
  expect(after.reservations.find(hold => hold.id === otherHold.id)).toEqual(winner.reservations.find(hold => hold.id === otherHold.id))
  expect(after.events.slice(0, winner.events.length)).toEqual(winner.events)
  expect(bodies).toHaveLength(3)
  expect(bodies[2]).not.toBe(bodies[0])
  expect(JSON.parse(bodies[2] ?? '{}')).toMatchObject({ expectedRevision: winner.revision })
  await other.close()
})

test('a lost batch acknowledgment retries identical captured bytes and preserves newer selection and reservation drafts', async ({ page, request }) => {
  const before = await prepare(page, request), bytes = await saved(page)
  const first = holdAt(before, 0), second = holdAt(before, 1), newer = holdAt(before, 2)
  await openWorkbench(page)
  for (const hold of before.reservations) {
    await expect(selection(page, hold.id)).toHaveAccessibleDescription(`${hold.orderId} · ${hold.lotId} ${String(hold.quantity)} units`)
  }
  await selectHolds(page, [first, second])
  await reviewSelected(page, 'Atomic release retained after a lost acknowledgment')
  const bodies: string[] = []
  const retryArrived = gate(), releaseRetry = gate()
  await page.route(batchEndpoint, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    bodies.push(route.request().postData() ?? '')
    const response = await route.fetch()
    if (bodies.length === 1) { await route.abort('failed'); return }
    retryArrived.resolve()
    await releaseRetry.promise
    await route.fulfill({ response })
  })
  try {
    await dialog(page).getByRole('button', { name: 'Release selected holds', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Retry same request', exact: true })).toBeEnabled()
    const savedBatch = await backend(request)
    expect(savedBatch.revision).toBe(before.revision + 2)
    await selection(page, newer.id).check()
    await page.getByRole('spinbutton', { name: 'Units to reserve', exact: true }).fill('19')
    await page.getByRole('button', { name: 'Retry same request', exact: true }).click()
    await retryArrived.promise
    const note = page.getByRole('textbox', { name: 'Reservation note', exact: true })
    await note.fill('Newer single-order draft survives batch receipt recovery')
    await expect(note).toBeFocused()
    releaseRetry.resolve()
    await expect(page.getByRole('button', { name: 'Retry same request', exact: true })).toHaveCount(0)
    await expect(note).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type(' and keeps typing focus')
    await expect(note).toHaveValue('Newer single-order draft survives batch receipt recovery and keeps typing focus')
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toBe(bodies[0])
    expect(await backend(request)).toEqual(savedBatch)
    await expect(selection(page, newer.id)).toBeChecked()
    await expect(workbench(page)).toContainText('1 selected · 0 outside this view')
    await expect(page.getByRole('spinbutton', { name: 'Units to reserve', exact: true })).toHaveValue('19')
    expect(await saved(page)).toEqual(bytes)
  } finally { releaseRetry.resolve() }
})

test('a batch transport failure before consumption preserves selection and restores an actionable exact retry', async ({ page, request }) => {
  const before = await prepare(page, request)
  const first = holdAt(before, 0), second = holdAt(before, 1)
  await openWorkbench(page)
  await selectHolds(page, [first, second])
  await reviewSelected(page, 'Retry the same pair after a transport interruption')
  const bodies: string[] = []
  await page.route(batchEndpoint, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    bodies.push(route.request().postData() ?? '')
    if (bodies.length === 1) { await route.abort('failed'); return }
    await route.continue()
  })
  await dialog(page).getByRole('button', { name: 'Release selected holds', exact: true }).click()
  const retry = page.getByRole('button', { name: 'Retry same request', exact: true })
  await expect(retry).toBeEnabled()
  await expect(retry).toBeFocused()
  await expect(selection(page, first.id)).toBeChecked()
  await expect(selection(page, second.id)).toBeChecked()
  expect(await backend(request)).toEqual(before)
  await retry.click()
  await expect(retry).toHaveCount(0)
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
  const after = await backend(request)
  expect(after.revision).toBe(before.revision + 2)
  expect(after.reservations.filter(hold => hold.status === 'released')).toHaveLength(2)
})

test('visible-page selection never expands into other pages and enforces the 25-hold review limit', async ({ page, request }) => {
  const before = await prepare(page, request, 27)
  await openWorkbench(page)
  for (const count of [8, 16, 24]) {
    await workbench(page).getByRole('button', { name: 'Select visible holds', exact: true }).click()
    await expect(workbench(page)).toContainText(String(count) + ' selected · ' + String(count - 8) + ' outside this view')
    await workbench(page).getByRole('button', { name: 'Next holds', exact: true }).click()
  }
  await expect(workbench(page)).toContainText('24 selected · 24 outside this view')
  await expect(workbench(page).getByRole('checkbox', { checked: true })).toHaveCount(0)
  await selection(page, holdAt(before, 24).id).check()
  await expect(workbench(page)).toContainText('25 selected · 24 outside this view')
  await expect(selection(page, holdAt(before, 25).id)).toBeDisabled()
  await expect(selection(page, holdAt(before, 26).id)).toBeDisabled()
  await workbench(page).getByRole('button', { name: 'Previous holds', exact: true }).click()
  await expect(workbench(page).getByRole('checkbox', { checked: true })).toHaveCount(8)
  const bodies = recordBatches(page)
  const reviewButton = workbench(page).getByRole('button', { name: 'Review selected releases', exact: true })
  await reviewButton.click()
  await expect(dialog(page).getByRole('heading', { name: 'Release selected material holds', exact: true })).toBeFocused()
  const captured = dialog(page).getByRole('list', { name: 'Captured holds', exact: true })
  await expect(captured.getByRole('listitem')).toHaveCount(25)
  await page.keyboard.press('Tab')
  await expect(captured).toBeFocused()
  const maximumScroll = await captured.evaluate((element: { scrollHeight: number; clientHeight: number }) => element.scrollHeight - element.clientHeight)
  expect(maximumScroll).toBeGreaterThan(0)
  await page.keyboard.press('End')
  await expect.poll(async () => scrollTop(captured)).toBeCloseTo(maximumScroll, 0)
  await expect(captured.getByRole('listitem').last()).toBeInViewport()
  await page.keyboard.press('Home')
  await expect.poll(async () => scrollTop(captured)).toBe(0)
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => scrollTop(captured)).toBeGreaterThan(0)
  await page.keyboard.press('Home')
  await expect.poll(async () => scrollTop(captured)).toBe(0)
  await page.keyboard.press('PageDown')
  await expect.poll(async () => scrollTop(captured)).toBeGreaterThan(0)
  await expect(captured).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(reviewButton).toBeFocused()
  await expect(workbench(page)).toContainText('25 selected')
  expect(bodies).toEqual([])
  await workbench(page).getByRole('button', { name: 'Clear hold selection', exact: true }).click()
  await expect(workbench(page)).toContainText('0 selected')
  await expect(workbench(page).getByRole('button', { name: 'Review selected releases', exact: true })).toBeDisabled()
  expect(await backend(request)).toEqual(before)
})
