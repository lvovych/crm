import { chooseStatus } from '../../support/work-order'
import { expect, test } from '@playwright/test'
import { settle } from '../../support/hydration'
import {
  partRows,
  editPart,
  addPart,
  newWorkOrder,
  saveWorkOrder,
  seededVehicleUrl,
} from '../../support/work-order'

/**
 * The work order page every browser opens. It is one form, so what these
 * tests hold it to is each field once, and a save that keeps what was on
 * screen. The classic page is still offered in the menu but is not tested.
 */

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const partName = `E2E wiper blade ${stamp}`

let jobUrl = ''

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ storageState: 'e2e/.auth/owner.json' })
  const vehicleUrl = await seededVehicleUrl(page)
  jobUrl = await newWorkOrder(page, vehicleUrl, `E2E modern layout ${stamp}`)
  await addPart(page, { name: partName, quantity: 2, unitPrice: 150 })
  // This layout fixture asserts a 300 balance, independent of a workshop's default tax.
  const taxRate = page.getByTestId('totals').getByRole('spinbutton')
  if (await taxRate.count()) await taxRate.fill('0')
  await saveWorkOrder(page)
  await page.close()
})

test.describe('the work order page', () => {
  test('opens for a browser that has not chosen a layout', async ({ page }) => {
    await page.goto(jobUrl)
    await settle(page)

    await expect(page.getByTestId('service-layout-modern')).toBeVisible()
    await expect(page.getByTestId('service-layout')).toHaveCount(0)
    // The top of the page is the work order's number and its status, then
    // what the job is called.
    const hero = page.getByTestId('service-hero')
    await expect(hero.getByTestId('service-number')).not.toBeEmpty()
    await expect(hero.getByTestId('service-status')).toHaveText('Pending')
    await expect(hero).toContainText(`E2E modern layout ${stamp}`)
  })

  test('holds one copy of each field and keeps photos on the job', async ({ page }) => {
    await page.goto(jobUrl)
    await settle(page)
    await expect(page.getByTestId('service-layout-modern')).toBeVisible()

    for (const selector of [
      'input[name="title"]',
      '#invoiceNumber',
      '#invoiceDate',
      '#mileage',
      'input[name="techName"]',
      'input[name="serviceDate"]',
    ]) {
      await expect(page.locator(selector), `${selector} appears once`).toHaveCount(1)
    }

    await expect(partRows(page)).toHaveCount(1)
    const partDialog = await editPart(page)
    await expect(partDialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveCount(1)
    await partDialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    const duplicates = await page.evaluate(() => {
      const form = document.querySelector('form')
      if (!form) return ['no form']
      const seen = new Map<string, number>()
      for (const el of form.querySelectorAll<HTMLInputElement>('input[name], textarea[name]')) {
        seen.set(el.name, (seen.get(el.name) ?? 0) + 1)
      }
      return [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name)
    })
    expect(duplicates, 'field names used twice in the form').toEqual([])

    // No tab bar at the top of the page: photos, documents, diagnostics,
    // video and status reports are tabs of one card on the job itself.
    const files = page.getByTestId('files-media')
    await expect(files).toBeVisible()
    await expect(page.getByRole('button', { name: /^Images/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Status Reports/ })).toHaveCount(0)
    for (const name of [/^Photos/, /^Documents/, /^Diagnostics/, /^Video/, /^Status Reports/]) {
      await expect(files.getByRole('tab', { name })).toBeVisible()
    }
    await expect(files.getByTestId('media-add')).toContainText('Add photos')
    await files.getByRole('tab', { name: /^Status Reports/ }).click()
    await expect(files.getByTestId('status-reports-section')).toBeVisible()

    // The money stays on screen along the bottom, with what is done about it.
    const bar = page.getByTestId('money-bar')
    await expect(bar).toBeInViewport()
    await expect(bar.getByTestId('money-balance')).toContainText('300')
    await expect(bar.getByRole('button', { name: 'Take payment' })).toBeVisible()
    await expect(bar.getByRole('button', { name: /Preview/ })).toBeVisible()
    await expect(bar.getByRole('button', { name: /Send/ })).toBeVisible()
  })

  test('notes follow mechanic planning and survive saving before labor', async ({ page }) => {
    await page.goto(jobUrl)
    await settle(page)
    const schedule = page.getByRole('heading', { name: 'Responsible mechanic', exact: true })
    const internal = page.getByRole('heading', { name: 'Internal notes', exact: true })
    const customer = page.getByRole('heading', { name: 'Customer notes', exact: true })
    const labor = page.getByRole('heading', { name: /Labor & Services/ })
    const positions = await Promise.all(
      [schedule, internal, customer, labor].map((el) => el.boundingBox())
    )
    expect(positions.every(Boolean)).toBe(true)
    expect(positions[1]!.y).toBeGreaterThan(positions[0]!.y)
    expect(positions[2]!.y).toBeGreaterThan(positions[0]!.y)
    expect(positions[3]!.y).toBeGreaterThan(Math.max(positions[1]!.y, positions[2]!.y))
    const editors = page.locator('[contenteditable="true"]')
    await expect(editors).toHaveCount(2)
    await editors.nth(0).fill('Internal placement regression')
    await editors.nth(1).fill('Customer placement regression')
    await saveWorkOrder(page)
    await page.reload()
    await settle(page)
    await expect(editors.nth(0)).toContainText('Internal placement regression')
    await expect(editors.nth(1)).toContainText('Customer placement regression')
  })

  test('saves what is on screen', async ({ page }) => {
    await page.goto(jobUrl)
    await settle(page)
    await expect(page.getByTestId('service-layout-modern')).toBeVisible()

    // The part saved when the job was made is here, with its figures.
    await expect(partRows(page)).toContainText(partName)

    await chooseStatus(page, 'In Progress')
    // The title is edited in the header, behind its pencil; the form carries
    // it as a hidden field, so Save takes it with everything else.
    const title = `E2E modern layout ${stamp} renamed`
    await page.getByTestId('edit-title').click()
    await page.getByTestId('title-input').fill(title)
    await page.getByTestId('title-input').press('Enter')
    await expect(page.getByTestId('service-title')).toHaveText(title)
    await expect(page.locator('input[name="title"]')).toHaveValue(title)
    await saveWorkOrder(page)

    await page.reload()
    await settle(page)
    await expect(page.getByTestId('service-title').first()).toHaveText(title)
    await expect(page.getByTestId('current-status')).toHaveText('In Progress')
    await expect(partRows(page)).toContainText(partName)
  })

  test('stacks into one column on a phone without overflowing sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(jobUrl)
    await settle(page)
    const layout = page.getByTestId('service-layout-modern')
    await expect(layout).toBeVisible()

    // The money bar is a desktop thing: the page already carries its totals,
    // payment form, preview and send, and a phone has no height to spare.
    await expect(page.getByTestId('money-bar')).toBeHidden()
    // What it leaves behind is the running total, in the flow under the parts,
    // so adding a line on a small screen still shows what it did to the bill.
    await expect(page.getByTestId('money-line')).toBeVisible()
    // The header's second line is which job this is; when it was opened is
    // left for a wider screen.
    await expect(page.getByTestId('service-opened')).toBeHidden()

    const control = page.getByTestId('status-control').getByRole('button')
    await expect(control).toContainText('In Progress')
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)

    const overflow = await layout.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow, 'sideways overflow in pixels').toBeLessThanOrEqual(1)

    const main = await page.getByTestId('service-main').boundingBox()
    const secondary = await page.getByTestId('service-secondary').boundingBox()
    expect(main, 'the job section is visible').not.toBeNull()
    expect(secondary, 'the secondary section is visible').not.toBeNull()
    expect(secondary!.y, 'the secondary section sits under the job').toBeGreaterThan(
      main!.y + main!.height - 1
    )
  })
})
