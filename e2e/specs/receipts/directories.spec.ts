import { expect, test } from '@playwright/test'
import { settle } from '../../support/hydration'
import { receiptDb, receiptFixture } from '../../support/receipt-fixture'
let fixture: Awaited<ReturnType<typeof receiptFixture>>
test.beforeAll(async () => {
  fixture = await receiptFixture()
})

test('suppliers are reached from Directories, not a duplicate sidebar item', async ({ page }) => {
  await page.goto('/directories')
  await settle(page)
  const link = page.locator('a[href="/suppliers"]')
  await expect(link).toHaveCount(1)
  await expect(page.locator('main').locator('a[href="/suppliers"]')).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/suppliers$/)
})

test('brand create, rename, deactivate and restore preserve the product reference', async ({
  page,
}) => {
  await page.goto('/directories/brands')
  await settle(page)
  const brandName = fixture.prefix + ' browser brand'
  await page.getByRole('button', { name: 'Додати бренд' }).click()
  await page.getByLabel('Назва', { exact: true }).fill(brandName)
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Бренд збережено')
  await page.getByLabel('Пошук бренду').fill(brandName)
  const row = page.getByRole('row').filter({ hasText: brandName })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: 'Редагувати' }).click()
  await page.getByLabel('Назва', { exact: true }).fill(brandName + ' renamed')
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click()
  await expect(row).toContainText(brandName + ' renamed')
  const db = receiptDb()
  try {
    const brand = await db.brand.findFirstOrThrow({ where: { name: brandName + ' renamed' } })
    await db.inventoryPart.update({ where: { id: fixture.part.id }, data: { brandId: brand.id } })
    await row.getByRole('button', { name: 'Видалити (деактивувати)' }).click()
    await expect(row).toContainText('Неактивний')
    expect(
      (await db.inventoryPart.findUniqueOrThrow({ where: { id: fixture.part.id } })).brandId
    ).toBe(brand.id)
    await row.getByRole('button', { name: 'Відновити' }).click()
    await expect(row).toContainText('Активний')
    expect((await db.brand.findUniqueOrThrow({ where: { id: brand.id } })).isActive).toBe(true)
  } finally {
    await db.$disconnect()
  }
})

test('role editor exposes each independent brand permission', async ({ page }) => {
  await page.goto('/settings/team')
  await settle(page)
  await page.getByRole('button', { name: 'New Role', exact: true }).click()
  for (const action of ['read', 'create', 'update', 'delete']) {
    await expect(page.locator(`[id="${action}:brands"]`)).toBeVisible()
    await expect(page.locator(`[id="${action}:brands"]`)).not.toBeChecked()
  }
  await page.locator('[id="read:brands"]').check()
  await expect(page.locator('[id="create:brands"]')).not.toBeChecked()
  await expect(page.locator('[id="update:brands"]')).not.toBeChecked()
  await expect(page.locator('[id="delete:brands"]')).not.toBeChecked()
})
