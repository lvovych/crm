import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { test as base, expect } from '@playwright/test'
import { plantWorkshop } from '../../support/db'
import { settle } from '../../support/hydration'

const test = base.extend<{ shop: { db: Client; org: string; user: string } }>({
  shop: async ({ page }, use) => {
    const url = new URL(process.env.E2E_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/test|e2e/.test(url.pathname))
      throw Error('Local test database required')
    const email = `financial-ui-${randomUUID()}@example.test`
    const password = 'Financial-ui-test-password'
    const owner = await plantWorkshop({ email, password, name: 'Manager', workshopName: 'UI test' })
    const db = new Client({ connectionString: url.href })
    await db.connect()
    try {
      await page.goto('/auth/sign-in')
      await page.locator('#email').fill(email)
      await page.locator('#password').fill(password)
      await page.getByRole('button', { name: 'Sign In', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
      await use({ db, org: owner.organizationId, user: owner.userId })
    } finally {
      await db.end()
    }
  },
})
test.use({ storageState: { cookies: [], origins: [] } })

for (const width of [1440, 360]) {
  test.describe(`settlement amounts at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } })
    test('labels, ordering, filtered totals and return to page two', async ({ page, shop }) => {
      const customer = randomUUID()
      const name = 'Майстерня з довгою назвою та кількома відкритими нарядами'
      await shop.db.query(
        `insert into customers(id,name,"userId","organizationId","updatedAt")
        values ($1,$2,$3,$4,now())`,
        [customer, name, shop.user, shop.org]
      )
      for (const [amount, days, paid] of [
        [300, -2, 0],
        [700, 10, 0],
        [50, 10, 250],
      ]) {
        const id = randomUUID()
        await shop.db.query(
          `insert into service_records(id,title,status,"totalAmount","customerId","organizationId","customerLedgerTracked","invoiceDueDate","updatedAt")
          values($1,$1,'completed',$2,$3,$4,false,current_date+$5::int,now())`,
          [id, amount, customer, shop.org, days]
        )
        if (paid)
          await shop.db.query(
            'insert into payments(id,amount,"serviceRecordId","updatedAt") values($1,$2,$3,now())',
            [randomUUID(), paid, id]
          )
      }
      await shop.db.query(
        `with others as (
        insert into customers(id,name,"userId","organizationId","updatedAt")
        select gen_random_uuid()::text,'Контрагент ' || lpad(i::text,2,'0'),$1,$2,now() from generate_series(1,25) i returning id
      ) insert into service_records(id,title,status,"totalAmount","customerId","organizationId","customerLedgerTracked","invoiceDueDate","updatedAt")
        select gen_random_uuid()::text,'Замовлення','completed',2000,id,$2,false,current_date+10,now() from others`,
        [shop.user, shop.org]
      )
      await page.goto('/mutual-settlements')
      await settle(page)
      await page.getByRole('button', { name: 'Старі документи · попередні суми' }).click()
      const rows = page.locator('tbody tr')
      await expect(rows.first()).toHaveAttribute('aria-label', 'Контрагент 01')
      if (width === 360) await page.getByRole('button', { name: 'Фільтри', exact: true }).click()
      const filter = page.getByLabel('Показати контрагентів')
      await filter.selectOption('debt')
      await page.getByRole('button', { name: 'Далі' }).click()
      const row = page.getByRole('row', { name, exact: true })
      const open = row.getByRole('button')
      await open.focus()
      await open.press('Enter')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(open).toBeFocused()
      await expect(filter).toHaveValue('debt')
      await expect(page.getByLabel('Сторінки контрагентів')).toContainText('2 / 2')
      const labels = ['Попередній борг', 'Прострочено', 'Аванс клієнта']
      const values = ['1 000,00 грн', '300,00 грн', '200,00 грн']
      for (const [index, label] of labels.entries()) {
        const cell = row.getByRole('cell').nth(index + 1)
        await expect(cell.getByText(values[index], { exact: true })).toBeVisible()
        if (width === 360) await expect(cell.getByText(label, { exact: true })).toBeVisible()
        else
          await expect(page.getByRole('columnheader').nth(index + 1)).toContainText(
            label === 'Прострочено' ? 'Із них прострочено' : label
          )
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      if (width === 360) await page.getByLabel('Сортування').selectOption('overdue')
      else await page.getByRole('button', { name: 'Із них прострочено' }).click()
      await expect(rows.first()).toHaveAttribute('aria-label', name)
      const summary = page.getByLabel('Підсумки вибірки')
      await expect(summary).toContainText('51 000,00 грн')
      await filter.selectOption('overdue')
      await expect(rows).toHaveCount(1)
      for (const value of values)
        await expect(summary.getByText(value, { exact: true })).toBeVisible()
    })
  })
}

test('double clicking Save Payment leaves one partial payment after reload', async ({
  page,
  shop,
}) => {
  const vehicle = randomUUID(),
    order = randomUUID()
  await shop.db.query(
    `insert into vehicles(id,make,model,year,"userId","organizationId","updatedAt") values($1,'Toyota','Test',2020,$2,$3,now())`,
    [vehicle, shop.user, shop.org]
  )
  await shop.db.query(
    `insert into service_records(id,title,status,"totalAmount","vehicleId","organizationId","updatedAt") values($1,'Double payment','completed',2400,$2,$3,now())`,
    [order, vehicle, shop.org]
  )
  await shop.db.query(
    `insert into service_parts(id,name,quantity,"unitPrice",total,"serviceRecordId") values($1,'Kit',1,2400,2400,$2)`,
    [randomUUID(), order]
  )
  await page.goto(`/vehicles/${vehicle}/service/${order}`)
  await settle(page)
  const panel = page.getByTestId('payments-section')
  await panel.getByRole('button', { name: 'Record Payment', exact: true }).click()
  await page.locator('#paymentAmount').fill('900')
  await panel.getByRole('button', { name: 'Save Payment', exact: true }).dblclick()
  await expect(panel.getByRole('listitem')).toHaveCount(1)
  await page.reload()
  await expect(panel.getByRole('listitem')).toHaveCount(1)
  await expect(panel.getByRole('listitem')).toContainText('900')
  await expect(panel.getByTestId('balance-due')).toHaveText(/1[,\s]?500[.,]00/)
  expect(
    (await shop.db.query('select amount from payments where "serviceRecordId"=$1', [order])).rows
  ).toEqual([{ amount: 900 }])
})
