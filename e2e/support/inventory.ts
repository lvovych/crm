import { expect, type Page } from '@playwright/test'
import { settle } from './hydration'
import { applyLine, editPart, partRows } from './work-order'

/** Pick an inventory-linked part; leave its draft open when testing refusal/stock safety. */
export async function addPartFromInventory(
  page: Page,
  name: string,
  quantity: number,
  apply = true
): Promise<void> {
  await settle(page)
  const before = await partRows(page).count()
  const picker = page.getByRole('dialog', { name: 'Select Part from Inventory' })
  await page.getByRole('button', { name: 'From Inventory', exact: true }).click()
  await expect(picker).toBeVisible()
  await picker.getByPlaceholder('Search inventory...').fill(name)
  await picker
    .getByRole('button', {
      name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
    })
    .first()
    .click()
  const editor = page.getByRole('dialog', { name: 'Add Part', exact: true })
  await expect(editor.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(name)
  await editor.getByLabel('Qty', { exact: true }).fill(String(quantity))
  if (apply) {
    await applyLine(editor)
    await expect(partRows(page)).toHaveCount(before + 1)
  }
}

export async function setPartQuantityField(page: Page, quantity: number): Promise<void> {
  const editor = await editPart(page)
  await editor.getByLabel('Qty', { exact: true }).fill(String(quantity))
  await applyLine(editor)
}
