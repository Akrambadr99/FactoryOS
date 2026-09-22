import { expect, test } from '@playwright/test'

test('failed recall recovery can be reasonedly transferred to quality approval', async ({ page }) => {
  await page.goto('/execution/orders/PO-8842')
  for (const name of ['Release material lot', 'Restore machine', 'Start order', 'Record output', 'Approve quality', 'Complete order']) {
    await page.getByRole('button', { name }).click()
  }
  await page.goto('/execution/lots/LOT-91/genealogy?depth=1')
  await page.getByLabel('Decision authority').selectOption('quality approver')
  await page.getByRole('button', { name: 'Open recall scope' }).click()
  await page.getByRole('button', { name: 'Process recall reconciliation' }).click()
  await expect(page.getByRole('button', { name: 'Retry recall reconciliation' })).toBeDisabled()
  await page.getByLabel('Handoff reason').fill('Escalate incomplete genealogy index to quality control.')
  await page.getByRole('button', { name: 'Take over recovery' }).click()
  await expect(page.getByText('Recovery owner: quality approver')).toBeVisible()
  await page.getByRole('button', { name: 'Retry recall reconciliation' }).click()
  await page.getByRole('button', { name: 'Process recall reconciliation' }).click()
  await expect(page.getByText('Job complete')).toBeVisible()
})
