import { test, expect } from '@playwright/test'
import { newWorkOrder, seededVehicleUrl, saveWorkOrder } from '../../support/work-order'
import { seedContractor } from '../../support/db'

for (const width of [390, 1440]) {
  test.describe('subcontract work at ' + width, () => {
    test.use({ viewport: { width, height: 900 } })
    test('creates a linked draft with purchase price from the work order', async ({ page }) => {
      const supplier = await seedContractor('Machining ' + width)
      await newWorkOrder(page, await seededVehicleUrl(page), 'Subcontract ' + width)
      await expect(page.getByRole('button', { name: /^Прихід послуг/ })).toHaveCount(0)
      await page.getByLabel('Add Service', { exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('textarea').fill('Brake disc machining')
      // Convert a previously saved employee service on desktop.
      if (width === 1440) {
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
        await saveWorkOrder(page)
        await page.getByRole('button', { name: 'Brake disc machining', exact: true }).click()
      }
      await dialog.getByLabel('Тип виконавця').selectOption('supplier')
      await dialog.getByLabel('Підрядник', { exact: true }).selectOption(supplier)
      await dialog.getByLabel('Ціна закупівлі').fill('800')
      await dialog.getByLabel('Ціна продажу').fill('1200')
      await dialog.getByRole('button', { name: 'Apply', exact: true }).last().click()
      const receive = page.getByRole('button', { name: 'Прихід послуг - 1', exact: true })
      await expect(receive).toBeInViewport()
      await saveWorkOrder(page)
      await receive.click()
      await expect(receive).toHaveCount(0)
      await page.getByRole('link', { name: 'Відкрити чернетку' }).click()
      await expect(page).toHaveURL(/\/receipts\/[^/]+$/)
      await expect(page.getByRole('cell', { name: 'Brake disc machining', exact: true })).toBeVisible()
      await expect(page.getByText(/Разом 800.00 грн/)).toBeVisible()
      await expect(page.getByText(/Чернетка/).first()).toBeVisible()
    })
  })
}
