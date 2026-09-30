import { expect, test } from '@playwright/test'

test('detail changes reach the selected workspace record and survive reload', async ({ page }) => {
  await page.goto('/execution/recovery-workspace?order=PO-8842')
  const selected = page.getByLabel('Selected order', { exact: true })
  const before = await selected.textContent()
  await page.getByRole('link', { name: 'Open record details' }).click()
  await expect(page.getByLabel('Selected record context')).toContainText('PO-8842')
  await page.getByRole('button', { name: 'Release material lot' }).click()
  await page.getByRole('link', { name: 'Back to workspace' }).click()
  await expect(selected).not.toHaveText(before ?? '')
  const after = await selected.textContent()
  await page.reload()
  await expect(selected).toHaveText(after ?? '')
  await page.getByRole('link', { name: 'Open record details' }).click()
  await expect(page.getByLabel('Selected record context')).toContainText('PO-8842')
})

test('secondary record selection and return navigation work at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto('/execution/recovery-workspace?order=PO-8843')
  await page.getByRole('link', { name: 'Open record details' }).click()
  await expect(page.getByLabel('Selected record context')).toContainText('PO-8843')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.screenshot({ path: '../UI_SCREENSHOTS/fifteenth-FactoryOS-detail.png', fullPage: true })
  await page.reload()
  await expect(page.getByLabel('Selected record context')).toContainText('PO-8843')
  await page.getByRole('link', { name: 'Back to workspace' }).click()
  await expect(page.getByLabel('Selected order', { exact: true })).toContainText('PO-8843')
})

test('unknown record recovery never opens the default record', async ({ page }) => {
  await page.goto('/execution/orders/PO-8842?record=MISSING')
  await expect(page.getByRole('alert')).toContainText('not found')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0)
  await page.getByRole('link', { name: 'Back to workspace' }).click()
  await expect(page.getByRole('button', { name: 'Refresh workspace' })).toBeVisible()
})
