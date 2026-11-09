import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import {
  ownerOrganizationId,
  insertTechnician,
  deleteTechnicians,
  jobAssignment,
} from '../../support/db'
import { settle } from '../../support/hydration'
import {
  newWorkOrder,
  seededVehicleUrl,
  addPart,
  saveWorkOrder,
  chooseStatus,
  jobIdOf,
  partRows,
} from '../../support/work-order'

const label = `UX Mechanic ${randomUUID().slice(0, 8)}`
const customId = randomUUID()
let techId = ''
async function db<T>(fn: (client: Client) => Promise<T>) {
  const connectionString = process.env.E2E_DATABASE_URL || ''
  const url = new URL(connectionString)
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/torqvoice_e2e')
    throw new Error('Disposable E2E database required')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
test.beforeAll(async () => {
  const org = await ownerOrganizationId()
  techId = await insertTechnician(org, label)
  await db((c) =>
    c.query(
      'insert into work_order_statuses (id,name,stage,color,"organizationId","updatedAt") values ($1,$2,$3,$4,$5,now())',
      [customId, 'UX ready for collection', 'completed', 'emerald', org]
    )
  )
})
test.afterAll(async () => {
  await deleteTechnicians([techId])
  await db((c) => c.query('delete from work_order_statuses where id=$1', [customId]))
})
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`status and mechanic are discoverable, keyboard accessible and persistent at ${viewport.width}px`, async ({
    page,
  }) => {
    const url = await newWorkOrder(
      page,
      await seededVehicleUrl(page),
      `UX review ${viewport.width} ${Date.now()}`
    )
    await saveWorkOrder(page)
    await settle(page)
    await page.setViewportSize(viewport)
    const facts = page.getByTestId('job-facts')
    const more = facts.getByRole('button', { name: 'More info', exact: true })
    if (await facts.getByTestId('vehicle-details').isVisible()) {
      await facts.getByRole('button', { name: 'Less info', exact: true }).click()
    }
    await expect(facts.getByRole('link', { name: 'Service history' })).toHaveCount(0)
    await expect(facts.getByTestId('customer-detail-email')).toHaveCount(0)
    await more.click()
    await expect(facts.getByRole('link', { name: 'Service history' })).toBeVisible()
    await expect(facts.getByTestId('customer-detail-email')).toBeVisible()
    await expect(facts.getByTestId('vehicle-detail-purchasePrice')).toHaveCount(0)
    await expect(facts.getByTestId('vehicle-detail-purchaseDate')).toHaveCount(0)
    await facts.getByRole('button', { name: 'Less info', exact: true }).click()

    const planning = page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: /^Scheduling/ }) })
    await expect(planning).not.toHaveAttribute('open', '')
    const mechanic = page.getByTestId('mechanic-assignment')
    await expect(mechanic.getByRole('button', { name: 'Assign mechanic' })).toBeVisible()
    const status = page.getByTestId('status-control').getByRole('button')
    expect((await status.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect((await mechanic.getByRole('button').boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await status.press('Enter')
    let dialog = page.getByRole('dialog', { name: 'Work order status', exact: true })
    for (const name of [
      'Pending',
      'In Progress',
      'Waiting Parts',
      'Completed',
      'UX ready for collection',
    ])
      await expect(dialog.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(status).toBeFocused()
    await chooseStatus(page, 'In Progress')
    await mechanic.getByRole('button').click()
    dialog = page.getByRole('dialog', { name: 'Choose mechanic' })
    await dialog.getByRole('textbox', { name: 'Search by name' }).fill('not-a-mechanic')
    await expect(dialog.getByText('No mechanics found')).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Search by name' }).fill(label)
    await dialog.getByRole('radio', { name: new RegExp(label) }).click()
    await expect(mechanic.getByTestId('assigned-mechanic')).toHaveText(label)
    await expect.poll(async () => (await jobAssignment(jobIdOf(url))).technicianId).toBe(techId)
    // An unsaved part must survive an immediate custom status change and later autosave.
    const part = `UX pending part ${viewport.width}`
    await addPart(page, { name: part, quantity: 2, unitPrice: 12.34 })
    await chooseStatus(page, /UX ready for collection/)
    await saveWorkOrder(page)
    await page.reload()
    await settle(page)
    await expect(page.getByTestId('current-status')).toHaveText('UX ready for collection')
    await expect(partRows(page)).toContainText(part)
    await expect(mechanic.getByTestId('assigned-mechanic')).toHaveText(label)
    await expect
      .poll(async () =>
        db(
          async (c) =>
            (
              await c.query('select status,"customStatusId" from service_records where id=$1', [
                jobIdOf(url),
              ])
            ).rows[0]
        )
      )
      .toEqual({ status: 'completed', customStatusId: customId })
    await mechanic.getByRole('button').click()
    dialog = page.getByRole('dialog', { name: 'Choose mechanic' })
    await dialog.getByRole('button', { name: 'Remove assignment' }).click()
    await expect(mechanic.getByTestId('assigned-mechanic')).toHaveText('Not assigned')
    await page.reload()
    await settle(page)
    await expect(mechanic.getByTestId('assigned-mechanic')).toHaveText('Not assigned')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true)
    await page.getByTestId('status-control').scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath(`status-mechanic-${viewport.width}.png`) })
  })
}

test('failed status and assignment requests keep saved values and can be retried', async ({
  page,
}) => {
  const url = await newWorkOrder(page, await seededVehicleUrl(page), `UX failure ${Date.now()}`)
  await saveWorkOrder(page)
  const id = jobIdOf(url)
  let failStatus = true
  let failMechanic = true
  await page.route(`**/service/${id}`, async (route) => {
    const request = route.request()
    const body = request.postData() || ''
    if (request.method() === 'POST' && body.includes('waiting-parts') && failStatus) {
      failStatus = false
      await route.abort('failed')
      return
    }
    if (
      request.method() === 'POST' &&
      body.includes('technicianId') &&
      body.includes(techId) &&
      failMechanic
    ) {
      failMechanic = false
      await route.abort('failed')
      return
    }
    await route.continue()
  })
  const control = page.getByTestId('status-control')
  await control.getByRole('button').click()
  await page
    .getByRole('dialog', { name: 'Work order status', exact: true })
    .getByRole('button', { name: 'Waiting Parts', exact: true })
    .click()
  await expect(control.getByRole('button')).toBeEnabled()
  await expect(page.getByTestId('current-status')).toHaveText('Pending')
  expect(failStatus).toBe(false)
  await chooseStatus(page, 'Waiting Parts')
  const mechanic = page.getByTestId('mechanic-assignment')
  await mechanic.getByRole('button').click()
  const dialog = page.getByRole('dialog', { name: 'Choose mechanic' })
  await dialog.getByRole('textbox', { name: 'Search by name' }).fill(label)
  const choice = dialog.getByRole('radio', { name: new RegExp(label) })
  await choice.click()
  await expect(choice).toBeEnabled()
  await expect(page.getByTestId('assigned-mechanic')).toHaveText('Not assigned')
  expect(failMechanic).toBe(false)
  await choice.click()
  await expect(page.getByTestId('assigned-mechanic')).toHaveText(label)
  await page.reload()
  await settle(page)
  await expect(page.getByTestId('current-status')).toHaveText('Waiting Parts')
  await expect(page.getByTestId('assigned-mechanic')).toHaveText(label)
})
