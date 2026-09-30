import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void }
declare const document: { documentElement: { scrollWidth: number } }
declare const window: { scrollTo(options: { top: number; left: number; behavior: 'instant' }): void }
declare function getComputedStyle(element: unknown): { color: string; backgroundColor: string }

function luminance(color: string) {
  const channels = color.match(/[0-9]+(?:[.][0-9]+)?/g)?.map(Number)
  if (channels?.length !== 3) throw new Error('Expected an opaque computed RGB color')
  const [red = 0, green = 0, blue = 0] = channels.map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}
const key = 'factoryos:production-orders:v1'
const modulePath = '/src/execution/order-machine/orderCollection.ts'
async function fixture(page: Page) {
  await page.goto('/')
  return page.evaluate<string>(`import("${modulePath}").then(module => JSON.stringify(module.seedOrderCollection()))`)
}
async function changedFixture(page: Page) {
  return page.evaluate<string>(`import("${modulePath}").then(module => JSON.stringify(module.setLotIndexAvailability(module.seedOrderCollection(), 'LOT-55', false, 'quality approver', 1).collection))`)
}
function snapshot(raw: string, product = 'FactoryOS') {
  return JSON.stringify({ format: 'collection-snapshot', version: 1, product,
    scope: 'production-orders', createdAt: '2026-09-30T12:00:00.000Z', payload: JSON.parse(raw) as unknown })
}
async function openReview(page: Page, raw: string) {
  await page.evaluate(({ key, raw }) => {
    localStorage.setItem(key, raw)
    localStorage.setItem('unrelated:snapshot-fixture', 'retained')
  }, { key, raw })
  await page.goto('/data-snapshots')
  await expect(page.getByRole('heading', { name: 'Collection snapshots', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Snapshots', exact: true })).toHaveAttribute('aria-current', 'page')
}
async function savedBytes(page: Page) {
  return page.evaluate<string>('JSON.stringify(Object.fromEntries(Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b))))')
}

test('downloads the complete domain snapshot and reviews the same file without writes', async ({ page }) => {
  const raw = await fixture(page)
  await openReview(page, raw)
  const before = await savedBytes(page)
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download collection snapshot', exact: true }).click()
  const download = await pendingDownload, path = await download.path()
  if (!path) throw new Error('Expected a downloaded collection snapshot')
  const exported = await readFile(path, 'utf8')
  expect(JSON.parse(exported)).toMatchObject({ product: 'FactoryOS', scope: 'production-orders', payload: JSON.parse(raw) as unknown })
  await page.getByLabel('Snapshot file').setInputFiles({ name: 'collection.json', mimeType: 'application/json', buffer: Buffer.from(exported) })
  await expect(page.getByLabel('Snapshot JSON', { exact: true })).toHaveValue(exported)
  await page.getByRole('button', { name: 'Compare snapshot', exact: true }).click()
  await expect(page.getByText('Comparison ready. No saved data was changed.', { exact: true })).toBeVisible()
  await page.getByLabel('Show records', { exact: true }).selectOption('all')
  await page.getByRole('button', { name: 'Inspect PO-8842', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'PO-8842', exact: true })).toBeVisible()
  expect(await savedBytes(page)).toBe(before)
})

test('inspects a changed related domain source using filtering and keyboard activation', async ({ page }) => {
  const raw = await fixture(page), changed = await changedFixture(page)
  await openReview(page, raw)
  const before = await savedBytes(page)
  await page.getByLabel('Snapshot JSON', { exact: true }).fill(snapshot(changed))
  await page.getByRole('button', { name: 'Compare snapshot', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Snapshot comparison', exact: true })).toBeVisible()
  await page.getByLabel('Show records', { exact: true }).selectOption('changed')
  await page.getByLabel('Find record', { exact: true }).fill('LOT-55')
  const inspect = page.getByRole('button', { name: 'Inspect LOT-55', exact: true })
  await inspect.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'LOT-55', exact: true })).toBeVisible()
  await page.getByText('Current local record', { exact: true }).click()
  await page.getByText('Snapshot record', { exact: true }).click()
  const detailBlocks = page.locator('.snapshot-detail pre')
  await expect(detailBlocks).toHaveCount(2)
  for (const block of await detailBlocks.all()) {
    const colors = await block.evaluate(element => {
      const style = getComputedStyle(element)
      return { foreground: style.color, background: style.backgroundColor }
    })
    const foreground = luminance(colors.foreground), background = luminance(colors.background)
    const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    expect(contrast).toBeGreaterThanOrEqual(4.5)
  }
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const title = await page.getByRole('heading', { name: 'Collection snapshots', exact: true }).boundingBox()
    const description = await page.locator('.snapshot-review .suite-title-copy > p').boundingBox()
    if (!title || !description) throw new Error('The snapshot heading and description must have visible layout')
    expect(title.x).toBeGreaterThanOrEqual(0)
    expect(title.y).toBeGreaterThanOrEqual(0)
    expect(title.x + title.width).toBeLessThanOrEqual(width)
    expect(title.y + title.height).toBeLessThanOrEqual(description.y)
    await expect(page.getByRole('button', { name: 'Download collection snapshot', exact: true })).toBeInViewport()
    await expect(page.getByLabel('Show records', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Find record', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'LOT-55', exact: true })).toBeVisible()
    await page.screenshot({ path: `../UI_SCREENSHOTS/collection-snapshots-FactoryOS-${String(width)}.png`, fullPage: true })
  }
  expect(await savedBytes(page)).toBe(before)
})

test('rejects malformed and wrong-product files without modifying any saved entry', async ({ page }) => {
  const raw = await fixture(page)
  await openReview(page, raw)
  const before = await savedBytes(page)
  const malformed = JSON.stringify({ format: 'collection-snapshot', version: 1, product: 'FactoryOS',
    scope: 'production-orders', createdAt: '2026-09-30T12:00:00.000Z', payload: { orders: [null] } })
  for (const candidate of ['{not-json', snapshot(raw, 'DifferentProduct'), malformed]) {
    await page.getByLabel('Snapshot JSON', { exact: true }).fill(candidate)
    await page.getByRole('button', { name: 'Compare snapshot', exact: true }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Snapshot comparison', exact: true })).toHaveCount(0)
    expect(await savedBytes(page)).toBe(before)
  }
})

test('refreshes a stale comparison after a real second-tab update without restoring old data', async ({ page, context }) => {
  const raw = await fixture(page), changed = await changedFixture(page)
  await openReview(page, raw)
  await page.getByLabel('Snapshot JSON', { exact: true }).fill(snapshot(raw))
  await page.getByRole('button', { name: 'Compare snapshot', exact: true }).click()
  await expect(page.getByText('Comparison ready. No saved data was changed.', { exact: true })).toBeVisible()
  const other = await context.newPage()
  await other.goto('/')
  await other.evaluate(({ key, raw }) => { localStorage.setItem(key, raw) }, { key, raw: changed })
  await page.bringToFront()
  await expect(page.getByRole('button', { name: 'Refresh comparison', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh comparison', exact: true }).click()
  await page.getByLabel('Show records', { exact: true }).selectOption('changed')
  await expect(page.getByRole('button', { name: 'Inspect LOT-55', exact: true })).toBeVisible()
  await expect(page.getByLabel('Snapshot JSON', { exact: true })).toHaveValue(snapshot(raw))
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(changed)
  expect(await page.evaluate(() => localStorage.getItem('unrelated:snapshot-fixture'))).toBe('retained')
  await other.close()
})
