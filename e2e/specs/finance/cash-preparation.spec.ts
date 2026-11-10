import { expect, test } from '@playwright/test'
import { settle } from '../../support/hydration'
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`cash preparation ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })
    test('creates an account without activating balances or changing payment workflow', async ({
      page,
    }) => {
      await page.goto('/finance')
      await settle(page)
      await expect(page.getByRole('heading', { name: 'Підготовка касового обліку' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Надходження', exact: true })).toBeDisabled()
      await page.getByText('Налаштування та початкові залишки', { exact: true }).click()
      await page.getByRole('button', { name: 'Додати власні реквізити', exact: true }).click()
      let dialog = page.getByRole('dialog')
      const entity = `Demo finance ${viewport.name} ${Date.now()}`
      await dialog.getByLabel('Назва', { exact: true }).fill(entity)
      await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Додати касу / рахунок', exact: true })
      ).toBeEnabled()
      await page.getByRole('button', { name: 'Додати касу / рахунок', exact: true }).click()
      dialog = page.getByRole('dialog')
      const account = `Cash ${viewport.name} ${Date.now()}`
      await dialog.getByLabel('Назва', { exact: true }).fill(account)
      await dialog
        .getByRole('combobox', { name: 'Власні реквізити', exact: true })
        .selectOption({ label: entity })
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1)
      await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
      await expect(dialog).not.toBeVisible()
      await page.reload()
      await settle(page)
      await expect(page.getByRole('button', { name: new RegExp(account) })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Виплата', exact: true })).toBeDisabled()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      ).toBe(false)
    })
  })
}
