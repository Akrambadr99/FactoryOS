import { expect, test } from '@playwright/test'
test('order execution follows material, machine, production, and quality gates', async ({ page }) => {
  await page.goto('/execution/orders/PO-8842')
  await expect(page.getByRole('button', { name: 'Start order' })).toBeDisabled()
  await page.getByRole('button', { name: 'Release material lot' }).click()
  await page.getByRole('button', { name: 'Restore machine' }).click()
  await page.getByRole('button', { name: 'Start order' }).click()
  await page.getByRole('button', { name: 'Record output' }).click()
  await page.getByRole('button', { name: 'Approve quality' }).click()
  await page.getByRole('button', { name: 'Complete order' }).click()
  await expect(page.getByText('Phase: complete')).toBeVisible()
})
