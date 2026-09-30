import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
// These callbacks execute in Chromium; keep Node test types independent of application compilation.
declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void }
declare const document: { documentElement: { scrollWidth: number } }
declare const window: { scrollTo(x: number, y: number): void }

const key = 'factoryos:production-orders:v1'
const workspace = '/execution/recovery-workspace?order=PO-8842&show=all&size=5'
const recoveryTitle = 'Saved workspace data needs attention'

test('damaged nested data has focused recovery, private exact-text export and URL-preserving retry', async ({ page }) => {
  await page.goto('/')
  const good = await page.evaluate<string>('import("/src/execution/order-machine/orderCollection.ts").then(module => JSON.stringify(module.seedOrderCollection()))')
  const raw = JSON.stringify({ ...(JSON.parse(good) as Record<string, unknown>), orders: [null] })
  await page.goto('/')
  await page.evaluate(({ key, raw }) => { localStorage.setItem(key, raw); localStorage.setItem('unrelated:recovery-fixture', 'private-other-entry') }, { key, raw })
  await page.goto(workspace)
  await expect(page.getByRole('heading', { name: recoveryTitle })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Your next step' })).toBeVisible()
  await expect(page.getByText(/not a validated backup/)).toBeVisible()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw)
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download recovery copy' }).click()
  const download = await pendingDownload
  expect(download.suggestedFilename()).toBe('factoryos-recovery.txt')
  const downloadedPath = await download.path()
  if (!downloadedPath) throw new Error('Expected a local recovery download')
  expect(await readFile(downloadedPath, 'utf8')).toBe(raw)
  expect(await page.evaluate(() => localStorage.getItem('unrelated:recovery-fixture'))).toBe('private-other-entry')
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => { window.scrollTo(0, 0) })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const titleBox = await page.getByRole('heading', { name: recoveryTitle }).boundingBox()
    const explanationBox = await page.locator('.workflow-recovery header > p').last().boundingBox()
    const nextBox = await page.getByRole('heading', { name: 'Your next step' }).boundingBox()
    if (!titleBox || !explanationBox || !nextBox) throw new Error('Recovery content must have a visible layout')
    expect(titleBox.x).toBeGreaterThanOrEqual(0)
    expect(titleBox.y).toBeGreaterThanOrEqual(0)
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(width)
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(explanationBox.y)
    expect(explanationBox.y + explanationBox.height).toBeLessThanOrEqual(nextBox.y)
    await expect(page.getByRole('button', { name: 'Retry this page' })).toBeInViewport()
    await page.screenshot({ path: `../UI_SCREENSHOTS/production-foundation-FactoryOS-${String(width)}.png`, fullPage: true })
  }
  // Simulate an external, validated repair. The application offers no destructive reset.
  await page.evaluate(({ key, raw }) => { localStorage.setItem(key, raw) }, { key, raw: good })
  await page.getByRole('button', { name: 'Retry this page' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Order recovery workspace', exact: true })).toBeVisible()
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(workspace)
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(good)
})

for (const raw of ['', '{broken']) {
  test(`invalid saved text remains intact on retry: ${raw || 'empty text'}`, async ({ page }) => {
    await page.goto('/')
    await page.evaluate(({ key, raw }) => { localStorage.setItem(key, raw) }, { key, raw })
    await page.goto(workspace)
    await expect(page.getByRole('heading', { name: recoveryTitle })).toBeVisible()
    await page.getByRole('button', { name: 'Retry this page' }).click()
    await expect(page.getByRole('heading', { name: recoveryTitle })).toBeVisible()
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw)
    await page.getByRole('link', { name: 'Return to overview' }).click()
    await expect(page.getByRole('heading', { name: recoveryTitle })).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe('/')
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(raw)
  })
}

test('direct detail entry exposes typed corruption recovery without swallowing it in record context', async ({ page }) => {
  await page.goto(workspace)
  const detail = await page.getByRole('link', { name: 'Open record details' }).getAttribute('href')
  if (!detail) throw new Error('Expected a selected record detail link')
  await page.evaluate(key => { localStorage.setItem(key, '{broken') }, key)
  await page.goto(detail)
  await expect(page.getByRole('heading', { name: recoveryTitle })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Download recovery copy' })).toBeEnabled()
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe('{broken')
})

test('blocked browser storage shows an actionable provider recovery screen without a stack trace', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('PRIVATE-NATIVE-STORAGE-DETAIL') } }) })
  await page.goto(workspace)
  await expect(page.getByRole('heading', { name: 'This screen could not be opened' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Retry this page' })).toBeEnabled()
  await expect(page.getByText('PRIVATE-NATIVE-STORAGE-DETAIL')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Download recovery copy' })).toHaveCount(0)
})
