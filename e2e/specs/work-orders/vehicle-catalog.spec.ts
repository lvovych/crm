import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { settle } from '../../support/hydration'

// Verify the real save, not only the labels rendered by the picker.
async function savedVehicle(id: string) {
  const db = new Client({ connectionString: process.env.E2E_DATABASE_URL })
  await db.connect()
  try {
    return (
      await db.query(
        'SELECT make, model, vin, color, generation, modification FROM vehicles WHERE id = $1',
        [id]
      )
    ).rows[0]
  } finally {
    await db.end()
  }
}

for (const mobile of [false, true]) {
  test(`creates a catalogue vehicle with VIN and registration colour (${mobile ? 'phone' : 'desktop'})`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/work-orders?new=1')
    await settle(page)
    await page.getByRole('dialog').getByRole('button', { name: 'Add New Vehicle' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add New Vehicle', exact: true })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox', { name: 'Make *' }).click()
    await page.getByPlaceholder('Search…', { exact: true }).fill('toyota')
    await page.getByRole('option', { name: 'Toyota', exact: true }).click()
    await expect(page.getByRole('status')).toHaveCount(0)
    await dialog.getByRole('combobox', { name: 'Model *' }).click()
    await page.getByPlaceholder('Search…', { exact: true }).fill('corolla')
    await page.getByRole('option', { name: 'Corolla', exact: true }).click()
    await dialog.getByRole('combobox', { name: 'Generation (optional)' }).click()
    await page.getByRole('option', { name: 'Corolla Sedan (2022)', exact: true }).click()
    await dialog.getByRole('combobox', { name: 'Engine / modification (optional)' }).click()
    await page.getByRole('option', { name: '1.8L CVT FWD (140 HP)', exact: true }).click()
    await dialog.getByLabel('Year *').fill('2023')
    await dialog.getByLabel('VIN', { exact: true }).fill('jt123456789012345')
    await dialog.getByRole('combobox', { name: 'Registration colour' }).click()
    await expect(page.getByRole('option')).toHaveCount(12) // 11 MVS colours + unspecified
    await page.getByRole('option', { name: 'Gray', exact: true }).click()
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({
      path: test.info().outputPath(`vehicle-form-${mobile ? 'phone' : 'desktop'}.png`),
    })
    await dialog.getByRole('button', { name: 'Create & Continue' }).click()
    await expect(page).toHaveURL(/\/vehicles\/[^/]+\/service\/[^/]+$/)
    const id = new URL(page.url()).pathname.split('/')[2]
    await expect
      .poll(() => savedVehicle(id))
      .toEqual({
        make: 'Toyota',
        model: 'Corolla',
        vin: 'JT123456789012345',
        color: 'Gray',
        generation: 'Corolla Sedan (2022)',
        modification: '1.8L CVT FWD (140 HP)',
      })
  })
}
