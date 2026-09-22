import { expect, test } from '@playwright/test'

test('named production planner claims a failed recall before retry', async ({ page }) => {
  await page.goto('/execution/orders/PO-8842')
  for (const name of ['Release material lot', 'Restore machine', 'Start order', 'Record output', 'Approve quality', 'Complete order']) {
    await page.getByRole('button', { name }).click()
  }
  await page.goto('/execution/lots/LOT-91/genealogy?depth=1')
  await page.getByLabel('Decision authority').selectOption('quality approver')
  await page.getByRole('button', { name: 'Open recall scope' }).click()
  await page.getByRole('button', { name: 'Process recall reconciliation' }).click()
  await page.getByLabel('Decision authority').selectOption('production planner')
  await page.getByLabel('Recovery operator').selectOption('planner-ada')
  await page.getByRole('button', { name: 'Claim recall recovery' }).click()
  await expect(page.getByLabel('Recovery assignments')).toContainText('planner-ada')
  await page.reload()
  await page.getByRole('button', { name: 'Retry recall reconciliation' }).click()
  await page.getByRole('button', { name: 'Process recall reconciliation' }).click()
  await expect(page.getByText('Job complete')).toBeVisible()
})
