import { test, expect } from '@playwright/test'
import { newWorkOrder, seededVehicleUrl, saveWorkOrder } from '../../support/work-order'
import { seedContractor } from '../../support/db'

for (const width of [390, 1440]) {
  test.describe('subcontract work at ' + width, () => {
    test.use({ viewport: { width, height: 900 } })
    test('creates a linked draft with purchase price from the work order', async ({ page }) => {
      const supplier = await seedContractor('Machining ' + width)
      await newWorkOrder(page, await seededVehicleUrl(page), 'Subcontract ' + width)
      await page.getByRole('button', { name: 'Add Service', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('textarea').fill('Brake disc machining')
      await dialog.getByLabel('Тип виконавця').selectOption('supplier')
      await dialog.getByLabel('Підрядник', { exact: true }).selectOption(supplier)
      await dialog.getByLabel('Ціна закупівлі').fill('800')
      await dialog.getByLabel('Ціна продажу').fill('1200')
      await dialog.getByRole('button', { name: 'Apply', exact: true }).last().click()
      await expect(page.getByText('Без приходу: 1')).toBeVisible()
      await saveWorkOrder(page)
      await page.getByRole('button', { name: 'Створити чернетку' }).click()
      await page.getByRole('link', { name: 'Відкрити чернетку' }).click()
      await expect(page.getByText('Brake disc machining')).toBeVisible()
      await expect(page.getByText(/Разом 800.00 грн/)).toBeVisible()
      await expect(page.getByText(/Чернетка/).first()).toBeVisible()
    })
  })
}
