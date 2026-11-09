import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { settle } from '../../support/hydration'

const prefix = `Search-${randomUUID().slice(0, 8)}`
const customerId = randomUUID()
const otherOrgId = randomUUID()
const ids = Array.from({ length: 4 }, () => randomUUID())
async function withDb<T>(run: (db: Client) => Promise<T>) {
  const connectionString = process.env.E2E_DATABASE_URL || ''
  const url = new URL(connectionString)
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/torqvoice_e2e') {
    throw new Error('Vehicle picker fixtures require the disposable E2E database')
  }
  const db = new Client({ connectionString })
  await db.connect()
  try {
    return await run(db)
  } finally {
    await db.end()
  }
}

test.beforeAll(async () => {
  await withDb(async (db) => {
    const {
      rows: [owner],
    } = await db.query(
      `select m."organizationId", m."userId" from organization_members m join users u on u.id=m."userId" where u.email='demo@torqvoice.com' limit 1`
    )
    if (!owner) throw new Error('Missing seeded owner')
    await db.query('BEGIN')
    try {
      await db.query('insert into organizations (id,name,"updatedAt") values ($1,$2,now())', [
        otherOrgId,
        prefix,
      ])
      await db.query(
        'insert into customers (id,name,phone,"userId","organizationId","updatedAt") values ($1,$2,$3,$4,$5,now())',
        [
          customerId,
          `Воляник Андрій ${prefix}`,
          '+380 (67) 987-65-43',
          owner.userId,
          owner.organizationId,
        ]
      )
      for (const [i, id] of ids.entries()) {
        await db.query(
          'insert into vehicles (id,make,model,year,vin,"licensePlate","customerId","organizationId","userId","isArchived","updatedAt") values ($1,$2,$3,2015,$4,$5,$6,$7,$8,$9,now()-($10 * interval \'1 second\'))',
          [
            id,
            prefix,
            ['Golf', 'Passat', 'Archived', 'Foreign'][i],
            `WVWZZZ1KZFW12345${i}`,
            `АС123${i}ВК`,
            customerId,
            i === 3 ? otherOrgId : owner.organizationId,
            owner.userId,
            i === 2,
            i,
          ]
        )
      }
      await db.query('COMMIT')
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    }
  })
})

test.afterAll(async () => {
  await withDb(async (db) => {
    await db.query('delete from vehicles where id=any($1::text[])', [ids])
    await db.query('delete from customers where id=$1', [customerId])
    await db.query('delete from organizations where id=$1', [otherOrgId])
  })
})

test('new work order searches real owner contacts, VIN and plate without exposing archived or foreign vehicles', async ({
  page,
}) => {
  await page.goto('/work-orders')
  await settle(page)
  await page.getByRole('button', { name: 'New Work Order', exact: true }).last().click()
  const dialog = page.getByRole('dialog')
  const search = dialog.getByRole('textbox')
  for (const query of [
    `Андрій Воляник ${prefix}`,
    `0679876543 ${prefix}`,
    `+380 (67) 987-65-43 ${prefix}`,
    `6543 ${prefix}`,
  ]) {
    await search.fill(query)
    await expect(dialog.getByRole('button', { name: new RegExp(prefix) })).toHaveCount(2)
    await expect(dialog.getByText('+380 (67) 987-65-43', { exact: true })).toHaveCount(2)
    await expect(dialog.getByRole('button', { name: /Archived|Foreign/ })).toHaveCount(0)
  }
  for (const query of ['AC-1230-BK', 'wvwzzz1kzfw123450', `Golf Воляник ${prefix}`]) {
    await search.fill(query)
    await expect(dialog.getByRole('button', { name: new RegExp(prefix + ' Golf') })).toBeVisible()
    await expect(dialog.getByRole('button', { name: new RegExp(prefix + ' Passat') })).toHaveCount(
      0
    )
  }
  await search.fill(`543 ${prefix}`)
  await expect(dialog.getByRole('button', { name: new RegExp(prefix) })).toHaveCount(0)
  await search.fill(`Passat Воляник ${prefix}`)
  await dialog.getByRole('button', { name: new RegExp(prefix + ' Passat') }).click()
  await expect(page).toHaveURL(new RegExp(`/vehicles/${ids[1]}/service/`))
})

test('Quick Add passes owner phone and VIN to the same search', async ({ page }) => {
  await page.goto('/')
  await settle(page)
  await page.getByRole('button', { name: 'Quick Add', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Work Order', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const search = dialog.getByRole('textbox')
  await search.fill(`0679876543 ${prefix}`)
  await expect(dialog.getByRole('button', { name: new RegExp(prefix) })).toHaveCount(2)
  await search.fill('wvwzzz1kzfw123450')
  await expect(dialog.getByRole('button', { name: new RegExp(prefix + ' Golf') })).toBeVisible()
  await expect(dialog.getByRole('button', { name: new RegExp(prefix + ' Passat') })).toHaveCount(0)
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 390, height: 400 },
]) {
  test(`search layout and touch controls at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto('/work-orders')
    await settle(page)
    await page.getByRole('button', { name: 'New Work Order', exact: true }).last().click()
    const dialog = page.getByRole('dialog')
    const field = dialog.getByRole('textbox', { name: 'Search vehicle or owner' })
    await field.fill(`Воляник ${prefix}`)
    await expect(dialog.getByRole('status')).toHaveText('Found: 2')
    const region = dialog.getByRole('region', { name: 'Search results' })
    expect(await dialog.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    expect(await dialog.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
    for (const control of [
      field,
      dialog.getByRole('button', { name: 'Clear search' }),
      dialog.getByRole('button', { name: 'Close', exact: true }),
      dialog.getByRole('button', { name: 'Add vehicle', exact: true }),
    ]) {
      await expect(control).toBeInViewport()
      const box = await control.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
    const last = region.getByRole('button', { name: new RegExp(prefix + ' Passat') })
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
    await dialog.getByRole('button', { name: 'Clear search' }).click()
    await expect(field).toHaveValue('')
    await expect(field).toBeFocused()
    await field.fill('missing-search-vehicle')
    await expect(dialog.getByText('No matches for this search')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Add vehicle', exact: true })).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  })
}

test('keyboard selects the intended result and displays VIN match context', async ({ page }) => {
  await page.goto('/work-orders')
  await settle(page)
  await page.getByRole('button', { name: 'New Work Order', exact: true }).last().click()
  const dialog = page.getByRole('dialog')
  const field = dialog.getByRole('textbox')
  await field.fill('wvwzzz1kzfw123450')
  await expect(dialog.locator('mark').filter({ hasText: 'WVWZZZ1KZFW123450' })).toBeVisible()
  await field.fill(`Воляник ${prefix}`)
  await field.press('ArrowDown')
  await expect(dialog.getByRole('button', { name: new RegExp(prefix + ' Golf') })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(dialog.getByRole('button', { name: new RegExp(prefix + ' Passat') })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/vehicles/${ids[1]}/service/`))
})
