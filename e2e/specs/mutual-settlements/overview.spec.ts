import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { test, expect } from '@playwright/test'
import { plantWorkshop } from '../../support/db'
import { settle } from '../../support/hydration'
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`settlement overview ${viewport.name}`, () => {
    test.use({ viewport, storageState: { cookies: [], origins: [] } })
    test('filters, details, review, historical date and read-only accounting', async ({ page }) => {
      const url = process.env.E2E_DATABASE_URL ?? ''
      if (
        !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
        !/(test|e2e)/.test(new URL(url).pathname)
      )
        throw Error('Local test database required')
      const email = `settlements-${randomUUID()}@example.test`,
        password = 'Settlements-local-test-password'
      const owner = await plantWorkshop({
        name: 'Settlement tester',
        email,
        password,
        workshopName: 'Settlement test',
      })
      const db = new Client({ connectionString: url })
      await db.connect()
      const customer = randomUUID(),
        order = randomUUID(),
        review = randomUUID(),
        supplier = randomUUID(),
        receipt = randomUUID()
      try {
        await db.query(
          'insert into customers(id,name,phone,"userId","organizationId","updatedAt") values($1,$2,$3,$4,$5,now())',
          [customer, 'Тестовий клієнт', '+380671234567', owner.userId, owner.organizationId]
        )
        for (const [id, title, manual] of [
          [order, 'TEST-ORDER', false],
          [review, 'TEST-REVIEW', true],
        ])
          await db.query(
            'insert into service_records(id,title,"invoiceNumber",status,"totalAmount","manuallyPaid","customerId","organizationId","invoiceDueDate","updatedAt") values($1,$2,$2,\'completed\',12000,$3,$4,$5,current_date-1,now())',
            [id, title, manual, customer, owner.organizationId]
          )
        await db.query(
          'insert into payments(id,amount,"amountExact","serviceRecordId","updatedAt") values($1,4000,4000,$2,now())',
          [randomUUID(), order]
        )
        await db.query(
          'insert into counterparties(id,name,"organizationId","createdById","updatedAt") values($1,$2,$3,$4,now())',
          [supplier, 'Тестовий постачальник', owner.organizationId, owner.userId]
        )
        await db.query(
          'insert into supplier_profiles(id,"organizationId","counterpartyId") values($1,$2,$3)',
          [randomUUID(), owner.organizationId, supplier]
        )
        await db.query(
          'insert into supplier_receipts(id,"organizationId","supplierId",number,"documentDate","receivedDate",status,"createdById","postedAt") values($1,$2,$3,\'TEST-RECEIPT\',current_date-1,current_date-1,\'posted\',$4,now())',
          [receipt, owner.organizationId, supplier, owner.userId]
        )
        await db.query(
          'insert into supplier_entries(id,"organizationId","supplierId","receiptId",kind,amount,date,due,reference,"createdById") values($1,$2,$3,$4,\'receipt\',5000,current_date-1,current_date-1,\'TEST-RECEIPT\',$5)',
          [randomUUID(), owner.organizationId, supplier, receipt, owner.userId]
        )
        // Renaming/reformatting contacts must not alter identity or exclude the order.
        await db.query('update service_records set "issuedData"=$1::jsonb where id=$2', [
          JSON.stringify({ customer: { name: 'Old customer name', phone: '+380 (67) 123-45-67' } }),
          order,
        ])
        const before = await db.query(
          'select id,"totalAmount","manuallyPaid" from service_records where "organizationId"=$1 order by id',
          [owner.organizationId]
        )
        await page.goto('/auth/sign-in')
        await page.locator('#email').fill(email)
        await page.locator('#password').fill(password)
        await page.getByRole('button', { name: 'Sign In', exact: true }).click()
        await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
        await page.goto('/mutual-settlements')
        await settle(page)
        await expect(
          page.getByRole('heading', { name: 'Взаєморозрахунки', exact: true })
        ).toBeVisible()
        await page.getByRole('button', { name: 'Старі документи · попередні суми' }).click()
        const customerCard = page.getByRole('article', { name: 'Тестовий клієнт', exact: true })
        await expect(customerCard).toContainText('8 000,00'.replace(' ', '\u00a0'))
        await page.getByPlaceholder('Ім’я, назва, телефон або документ').fill('0671234567')
        await expect(customerCard).toBeVisible()
        await page.getByRole('button', { name: 'Документи: Тестовий клієнт' }).click()
        await expect(
          page.getByRole('dialog').getByRole('article', { name: 'TEST-ORDER', exact: true })
        ).toContainText('4 000,00'.replace(' ', '\u00a0'))
        await expect(
          page
            .getByRole('dialog')
            .getByRole('article', { name: 'TEST-ORDER', exact: true })
            .getByRole('link')
        ).toHaveAttribute('href', `/sales/${order}`)
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Скинути фільтри' }).click()
        const excludedTab = page.getByRole('button', { name: 'Не враховано в підсумках (1)' })
        await expect(excludedTab).toBeVisible()
        expect(
          await excludedTab.evaluate(
            (el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth
          )
        ).toBe(true)
        await excludedTab.click()
        await page.screenshot({
          path: `/tmp/settlements-excluded-${viewport.name}.png`,
          fullPage: true,
        })
        await expect(customerCard).toContainText('TEST-REVIEW')
        await page.getByRole('button', { name: 'Постачальники', exact: true }).click()
        await expect(
          page.getByRole('article', { name: 'Тестовий постачальник', exact: true })
        ).toContainText('5 000,00'.replace(' ', '\u00a0'))
        await page.getByRole('button', { name: 'Документи: Тестовий постачальник' }).click()
        await expect(page.getByRole('dialog')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        )
        const box = await page.getByRole('dialog').boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
        await page.screenshot({ path: `/tmp/settlements-${viewport.name}-details.png` })
        await page.keyboard.press('Escape')
        await page.goto('/mutual-settlements?date=2020-01-01&view=customer')
        await settle(page)
        await page.getByRole('button', { name: 'Старі документи · попередні суми' }).click()
        await expect(page.getByText('Історичний клієнтський борг поки недоступний')).toBeVisible()
        await page.getByRole('link', { name: 'Показати на сьогодні' }).click()
        await settle(page)
        await page.getByRole('button', { name: 'Старі документи · попередні суми' }).click()
        await expect(customerCard).toBeVisible()
        await expect(page.getByLabel('Станом на')).not.toHaveValue('2020-01-01')
        await page.screenshot({ path: `/tmp/settlements-${viewport.name}.png`, fullPage: true })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        )
        expect(
          (
            await db.query(
              'select id,"totalAmount","manuallyPaid" from service_records where "organizationId"=$1 order by id',
              [owner.organizationId]
            )
          ).rows
        ).toEqual(before.rows)
        for (const table of [
          'finance_settings',
          'money_entries',
          'financial_documents',
          'money_accounts',
        ])
          expect(
            (
              await db.query(`select count(*)::int n from ${table} where "organizationId"=$1`, [
                owner.organizationId,
              ])
            ).rows[0].n
          ).toBe(0)
      } finally {
        await db.end()
      }
    })
  })
}
