import { expect, type Locator, type Page } from '@playwright/test'
import { settle } from './hydration'

/**
 * Driving a work order through the browser the way a workshop does.
 *
 * The suite pins the locale and uses accessible dialog fields. Wait for the
 * current page to settle before counting rows or opening a new line editor;
 * otherwise a navigation can make an existing list look temporarily empty.
 */

/** The address of one seeded vehicle, found through the list's own search. */
export async function seededVehicleUrl(page: Page, search = 'Camry'): Promise<string> {
  await page.goto(`/vehicles?search=${encodeURIComponent(search)}`)
  await page
    .getByRole('link', { name: new RegExp(search, 'i') })
    .first()
    .click()
  await page.waitForURL(/\/vehicles\/[^/?]+$/)
  return page.url()
}

/** The work order's id, from an editor address. */
export function jobIdOf(jobUrl: string): string {
  const id = new URL(jobUrl).pathname.split('/').pop()
  if (!id) throw new Error(`no job id in ${jobUrl}`)
  return id
}

/**
 * Retitles the job open in the editor: the title reads as text until its
 * pencil is pressed. Kept, not saved; it goes with the rest on Save.
 */
export async function setTitle(page: Page, title: string): Promise<void> {
  const field = page.getByTestId('title-input')
  await expect(async () => {
    await page.getByTestId('edit-title').click()
    await expect(field).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await field.fill(title)
  await field.press('Enter')
  await expect(page.getByTestId('service-title').first()).toContainText(title)
}

/** A fresh draft work order on the vehicle, titled, open in the editor. */
export async function newWorkOrder(page: Page, vehicleUrl: string, title: string): Promise<string> {
  await page.goto(`${vehicleUrl}/service/new`)
  await page.waitForURL(/\/vehicles\/[^/]+\/service\/[^/]+$/)
  // `/service/new` makes the draft and redirects to it, and for a moment the
  // page being left and the page arriving are both in the document: two title
  // fields, and a strict-mode error instead of a retry. Settled, there is one.
  await settle(page)
  await setTitle(page, title)
  return page.url()
}

/** Visible line names: the other responsive rendering must not count twice. */
export function partRows(page: Page): Locator {
  return page.getByTestId('part-name').filter({ visible: true })
}
export function laborRows(page: Page): Locator {
  return page.getByTestId('labor-name').filter({ visible: true })
}
export function partRowOf(name: Locator): Locator {
  return name.locator('xpath=ancestor::*[@data-testid="part-row"][1]')
}
export function laborRowOf(name: Locator): Locator {
  return name.locator('xpath=ancestor::*[@data-testid="labor-row"][1]')
}
/** The scheduling fields live in a collapsed details section. */
export async function openSchedule(page: Page): Promise<void> {
  const summary = page.locator('summary').filter({ hasText: 'Mechanic and scheduling' })
  const section = summary.locator('..')
  if ((await section.getAttribute('open')) === null) await summary.click()
  await expect(section).toHaveAttribute('open', '')
}
export async function editPart(page: Page, index = 0): Promise<Locator> {
  await partRows(page).nth(index).click()
  const dialog = page.getByRole('dialog', { name: 'Edit part', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
export async function editLabor(page: Page, index = 0): Promise<Locator> {
  await laborRows(page).nth(index).click()
  const dialog = page.getByRole('dialog', { name: 'Edit service', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
export async function applyLine(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(dialog).toBeHidden()
}
export async function deletePart(page: Page, index = 0): Promise<void> {
  await settle(page)
  const before = await partRows(page).count()
  const dialog = await editPart(page, index)
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(partRows(page)).toHaveCount(before - 1)
}

export interface PartInput {
  name: string
  quantity: number
  /** Vendor cost; with a markup the unit price is expected to follow from it. */
  cost?: number
  markupPercent?: number
  unitPrice?: number
}

/** Fill and apply the part dialog, then verify the new row exists. */
export async function addPart(page: Page, part: PartInput): Promise<void> {
  await settle(page)
  const before = await partRows(page).count()
  await page.getByRole('button', { name: 'Add Part', exact: true }).last().click()
  const dialog = page.getByRole('dialog', { name: 'Add Part', exact: true })
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(part.name)
  await dialog.getByLabel('Qty', { exact: true }).fill(String(part.quantity))
  if (part.cost !== undefined || part.markupPercent !== undefined) {
    await dialog.locator('summary').click()
    if (part.cost !== undefined)
      await dialog.getByLabel('Cost', { exact: true }).fill(String(part.cost))
    if (part.markupPercent !== undefined)
      await dialog.getByLabel('Markup %', { exact: true }).fill(String(part.markupPercent))
  }
  if (part.unitPrice !== undefined)
    await dialog.getByLabel('Unit Price', { exact: true }).fill(String(part.unitPrice))
  await applyLine(dialog)
  await expect(partRows(page)).toHaveCount(before + 1)
}

export async function lastPartUnitPrice(page: Page): Promise<string> {
  const dialog = await editPart(page, (await partRows(page).count()) - 1)
  const value = await dialog.getByLabel('Unit Price', { exact: true }).inputValue()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  return value
}

export interface LaborInput {
  description: string
  hours: number
  rate: number
}

/** Add an hourly line through the same editor used by the workshop. */
export async function addLabor(page: Page, labor: LaborInput): Promise<void> {
  await settle(page)
  const before = await laborRows(page).count()
  await page.getByRole('button', { name: 'Add Labor', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add Service', exact: true })
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill(labor.description)
  await dialog.getByLabel('Hours', { exact: true }).fill(String(labor.hours))
  await dialog.getByLabel('Price / rate', { exact: true }).fill(String(labor.rate))
  await applyLine(dialog)
  await expect(laborRows(page)).toHaveCount(before + 1)
}

/** Saves the work order and waits for the header to say so. */
export async function saveWorkOrder(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
}

/**
 * One line of the totals panel, found by its label. The panel prints each
 * line as a label and a figure side by side, so the row is the label's
 * parent and the figure is read from it.
 */
export function totalsRow(page: Page, label: string): Locator {
  // Scoped to the totals rows: "Parts" and "Labor" are also section headings.
  const panel = page.getByTestId('totals')
  // The row is the nearest box that spreads label and figure apart; the tax
  // label sits one level deeper, beside its percentage input.
  return panel
    .getByText(label, { exact: true })
    .first()
    .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
}

/** Sets the discount on the open work order. */
export async function setDiscount(
  page: Page,
  kind: 'None' | 'Percentage' | 'Fixed',
  value?: number
): Promise<void> {
  const row = totalsRow(page, 'Discount')
  await row.getByRole('combobox').click()
  await page.getByRole('option', { name: kind, exact: true }).click()
  if (value !== undefined) await row.locator('input[type="number"]').fill(String(value))
}

/** The public share link for the open work order, generating it if needed. */
export async function shareLink(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Share', exact: true }).click()

  // A document whose invoice date has passed is offered a fresh one before it
  // goes out. Declined here: a spec that shares a seeded invoice must hand the
  // customer the document as it stands, not rewrite its dates on the way.
  const expired = page.getByRole('dialog', { name: /invoice dates expired/i })
  const asksAboutDates = await expired
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  if (asksAboutDates) {
    await expired.getByRole('button', { name: /proceed without changes/i }).click()
  }

  // By name: a workshop-wide announcement is a dialog too, and can be open on
  // the same page.
  const dialog = page.getByRole('dialog', { name: 'Share Invoice' })
  await expect(dialog).toBeVisible()
  const generate = dialog.getByRole('button', { name: /generate public link/i })
  if (await generate.isVisible()) {
    await generate.click()
    // A job that has gone to the customer is asked to leave the work board.
    const prompt = page.getByRole('alertdialog', { name: /mark this invoice as completed/i })
    const asked = await prompt
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false)
    if (asked) await prompt.getByRole('button', { name: 'Mark completed', exact: true }).click()
  }
  const field = dialog.locator('input[readonly]')
  await expect(field).toHaveValue(/\/share\/invoice\//)
  const url = await field.inputValue()
  await page.keyboard.press('Escape')
  return url
}
