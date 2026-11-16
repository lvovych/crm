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
      await page.getByRole('button', { name: 'Далі' }).click()
      const row = page.getByRole('row', { name, exact: true })
      await expect(row.getByRole('cell').nth(1)).toContainText('800,00')
      await expect(row.getByRole('cell').nth(2)).toContainText('300,00')
      await expect(page.getByLabel('Підсумки вибірки')).toContainText('51 000,00 грн')
      await row.getByRole('link').press('Enter')
      await expect(page.locator('#settlement-documents')).toContainText('Документи взаєморозрахунків')
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
