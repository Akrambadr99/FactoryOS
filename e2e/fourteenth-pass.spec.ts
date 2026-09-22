import { expect, test } from '@playwright/test'

test('recovery collection keeps independent orders and propagates only a linked lot', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => { errors.push(error.message) })
  await page.goto('/execution/recovery-workspace?order=PO-8843')
  expect(errors).toEqual([])
  await expect(page.getByRole('heading', { name: 'Order recovery workspace' })).toBeVisible()
  await expect(page.getByLabel('Recovery summary')).toContainText('5')
  await page.getByRole('button', { name: 'Claim recovery' }).click()
  await expect(page.getByLabel('Selected order')).toContainText('planner-ada')
  await page.getByRole('button', { name: /PO-8845 · packaging · failed/ }).click()
  await expect(page).toHaveURL(/order=PO-8845/)
  await expect(page.getByLabel('Selected order')).toContainText('unclaimed')
  await page.goto('/operations')
  await page.goto('/execution/recovery-workspace?order=PO-8843')
  await expect(page.getByLabel('Selected order')).toContainText('planner-ada')
  await page.getByRole('button', { name: 'Toggle related lot index' }).click()
  await expect(page.getByRole('status')).toContainText('2 related orders updated')
  await page.getByRole('button', { name: /PO-8845 · packaging · failed/ }).click()
  await expect(page.getByLabel('Selected order')).toContainText('Order revision 7')
})
