import { expect, test } from '@playwright/test'

test('URL triage survives reload and browser history without changing selection', async ({ page }) => {
  await page.goto('/execution/recovery-workspace?order=PO-8842&q=assembly&state=recall-failed&sort=id-desc&size=5')
  await expect(page.getByLabel('Search orders', { exact: true })).toHaveValue('assembly')
  await expect(page.getByLabel('Work state', { exact: true })).toHaveValue('recall-failed')
  await expect(page.getByLabel('Selected order', { exact: true })).toContainText('PO-8842')
  await page.reload()
  await expect(page.getByLabel('Sort orders', { exact: true })).toHaveValue('id-desc')
  await page.getByLabel('Sort orders', { exact: true }).selectOption('revision-desc')
  await expect(page).toHaveURL(/sort=revision-desc/)
  await page.goBack()
  await expect(page.getByLabel('Sort orders', { exact: true })).toHaveValue('id-desc')
  await page.goForward()
  await expect(page.getByLabel('Sort orders', { exact: true })).toHaveValue('revision-desc')
  await expect(page.getByLabel('Selected order', { exact: true })).toContainText('PO-8842')
})

test('empty-view recovery keeps the selected record and unrelated URL context', async ({ page }) => {
  await page.goto('/execution/recovery-workspace?order=PO-8842&q=not-a-real-record&source=triage')
  const records = page.getByLabel('Order collection', { exact: true })
  await expect(records).toContainText('outside the current page or filters')
  await records.getByRole('button', { name: 'Reset empty view', exact: true }).click()
  await expect(page.getByLabel('Search orders', { exact: true })).toHaveValue('')
  await expect(records.getByLabel('Select PO-8842', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/source=triage/)
  await expect(page.getByLabel('Selected order', { exact: true })).toContainText('PO-8842')
})

test('page selection is explicit and hidden bulk scope remains discoverable', async ({ page }) => {
  await page.goto('/execution/recovery-workspace?order=PO-8842&show=all&size=5')
  const selection = page.getByLabel('Bulk selection', { exact: true })
  await page.getByRole('button', { name: 'Select this page', exact: true }).click()
  await expect(selection).toContainText('5 records selected · 0 outside this page.')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(selection).toContainText('5 records selected · 5 outside this page.')
  await expect(selection).toContainText('Bulk actions include selected records outside this page.')
  await page.getByRole('button', { name: 'Select this page', exact: true }).click()
  await expect(selection).toContainText('6 records selected · 5 outside this page.')
  await page.getByRole('button', { name: 'Clear this page', exact: true }).click()
  await expect(selection).toContainText('5 records selected · 5 outside this page.')
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await expect(selection).toContainText('0 records selected · 0 outside this page.')
})

test('detail and decision workflows return to the same tablet triage view', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto('/execution/recovery-workspace?order=PO-8842&q=assembly&sort=id-desc&size=5')
  for (const name of ['Open record details', 'Open decision workflow']) {
    await page.getByRole('link', { name, exact: true }).click()
    await expect(page.getByLabel('Selected record context')).toContainText('PO-8842')
    await page.getByRole('link', { name: 'Back to workspace', exact: true }).click()
    await expect(page.getByLabel('Search orders', { exact: true })).toHaveValue('assembly')
    await expect(page.getByLabel('Sort orders', { exact: true })).toHaveValue('id-desc')
    await expect(page).toHaveURL(/size=5/)
    await expect(page.getByLabel('Selected order', { exact: true })).toContainText('PO-8842')
  }
  await page.screenshot({ path: '../UI_SCREENSHOTS/sixteenth-FactoryOS-triage.png', fullPage: true })
})
