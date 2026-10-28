import { expect, test, type Locator } from '@playwright/test'
import {
  addPart,
  applyLine,
  editPart,
  newWorkOrder,
  partRows,
  laborRows,
  saveWorkOrder,
  seededVehicleUrl,
  totalsRow,
} from '../../support/work-order'

// Invalid drafts must remain editable and must never change saved invoice totals.
test.describe.configure({ mode: 'serial' })
const stamp = Date.now()
let vehicleUrl = ''
let jobUrl = ''

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: 'e2e/.auth/owner.json' })
  vehicleUrl = await seededVehicleUrl(page)
  await page.close()
})

async function expectRefused(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Check the name and numeric fields')
  await expect(dialog).toBeVisible()
}

test.describe('line validation protects the saved work order', () => {
  test('a priced part without a name stays in the dialog and is not added', async ({ page }) => {
    jobUrl = await newWorkOrder(page, vehicleUrl, `E2E validation ${stamp}`)
    await addPart(page, { name: `E2E gasket ${stamp}`, quantity: 1, unitPrice: 500 })
    await saveWorkOrder(page)
    await page.getByRole('button', { name: 'Add Part', exact: true }).last().click()
    const dialog = page.getByRole('dialog', { name: 'Add Part', exact: true })
    await dialog.getByLabel('Qty', { exact: true }).fill('2')
    await dialog.getByLabel('Unit Price', { exact: true }).fill('300')
    await expectRefused(dialog)
    await expect(dialog.getByLabel('Unit Price', { exact: true })).toHaveValue('300')
    await expect(totalsRow(page, 'Parts')).toContainText('$500.00')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Discard', exact: true })
      .click()
    await page.reload()
    await expect(partRows(page)).toHaveCount(1)
    await expect(totalsRow(page, 'Parts')).toContainText('$500.00')
  })

  test('naming the part lets both lines be saved', async ({ page }) => {
    await page.goto(jobUrl)
    await addPart(page, { name: `E2E hose ${stamp}`, quantity: 2, unitPrice: 300 })
    await saveWorkOrder(page)
    await page.reload()
    await expect(partRows(page)).toHaveCount(2)
    await expect(totalsRow(page, 'Parts')).toContainText('$1,100.00')
  })

  test('labor requires a description and can be corrected without losing its price', async ({
    page,
  }) => {
    await page.goto(jobUrl)
    await page.getByRole('button', { name: 'Add Labor', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Service', exact: true })
    await dialog.getByLabel('Hours', { exact: true }).fill('3')
    await dialog.getByLabel('Price / rate', { exact: true }).fill('900')
    await expectRefused(dialog)
    await expect(laborRows(page)).toHaveCount(0)
    await dialog
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill(`E2E fit the hose ${stamp}`)
    await applyLine(dialog)
    await saveWorkOrder(page)
    await page.reload()
    await expect(laborRows(page)).toHaveCount(1)
    await expect(totalsRow(page, 'Labor')).toContainText('$2,700.00')
  })

  for (const [label, value, original] of [
    ['Qty', '-2', '1'],
    ['Unit Price', '-10', '500'],
  ]) {
    test(`negative ${label} is refused before changing saved totals`, async ({ page }) => {
      await page.goto(jobUrl)
      const dialog = await editPart(page)
      await dialog.getByLabel(label, { exact: true }).fill(value)
      await expectRefused(dialog)
      await expect(totalsRow(page, 'Parts')).toContainText('$1,100.00')
      await dialog.getByLabel(label, { exact: true }).fill(original)
      await applyLine(dialog)
      await saveWorkOrder(page)
      await page.reload()
      await expect(totalsRow(page, 'Parts')).toContainText('$1,100.00')
      await expect(totalsRow(page, 'Labor')).toContainText('$2,700.00')
    })
  }
})
