import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { test, expect } from '@playwright/test'
import { plantWorkshop } from '../../support/db'
import { settle } from '../../support/hydration'
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`customer history ${viewport.name}`, () => {
    test.use({ viewport, storageState: { cookies: [], origins: [] } })
    test('prepayment, completion, partial debt and history without activating cash', async ({
      page,
    }) => {
      const url = process.env.E2E_DATABASE_URL ?? ''
      if (
        !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
        !/test|e2e/.test(new URL(url).pathname)
      )
        throw Error('Local test database only')
      const email = `history-${randomUUID()}@example.test`,
        password = 'History-local-test-password'
      const owner = await plantWorkshop({
        name: 'History tester',
        email,
        password,
        workshopName: 'History test',
      })
      const db = new Client({ connectionString: url })
      await db.connect()
      const customer = randomUUID(),
        order = randomUUID(),
        old = randomUUID()
      try {
        await db.query(
          'insert into customers(id,name,"userId","organizationId","updatedAt") values($1,$2,$3,$4,now())',
          [customer, 'Андрій Історія', owner.userId, owner.organizationId]
        )
        for (const [id, title, tracked] of [
          [order, 'НОВИЙ-12000', true],
          [old, 'СТАРИЙ-12000', false],
        ])
          await db.query(
            'insert into service_records(id,title,status,"totalAmount","customerId","organizationId","customerLedgerTracked","updatedAt") values($1,$2,\'pending\',12000,$3,$4,$5,now())',
            [id, title, customer, owner.organizationId, tracked]
          )
        await db.query(
          'insert into payments(id,amount,"serviceRecordId","updatedAt") values($1,3000,$2,now())',
          [randomUUID(), order]
        )
        await page.goto('/auth/sign-in')
        await page.locator('#email').fill(email)
        await page.locator('#password').fill(password)
        await page.getByRole('button', { name: 'Sign In', exact: true }).click()
        await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
        await page.goto('/mutual-settlements')
        await settle(page)
        const card = page.getByRole('row', { name: 'Андрій Історія', exact: true })
        await expect(card).toContainText('3\u00a0000,00')
        await db.query("update service_records set status='completed' where id=$1", [order])
        await db.query(
          'insert into payments(id,amount,"serviceRecordId","updatedAt") values($1,4000,$2,now())',
          [randomUUID(), order]
        )
        await page.reload()
        await settle(page)
        await expect(card).toContainText('5\u00a0000,00')
        await page.getByRole('button', { name: 'Документи: Андрій Історія' }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog).toContainText('НОВИЙ-12000')
        await expect(dialog).not.toContainText('СТАРИЙ-12000')
        await dialog.getByText('Історія зобов’язань і оплат (4)').click()
        await expect(
          dialog.getByRole('list', { name: 'Історія документа' }).getByRole('listitem')
        ).toHaveCount(4)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        )
        const box = await dialog.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
        await page.screenshot({ path: `/tmp/customer-history-${viewport.name}.png` })
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: 'Старі документи · попередні суми' }).click()
        await page.getByRole('button', { name: 'Документи: Андрій Історія' }).click()
        await expect(dialog).toContainText('СТАРИЙ-12000')
        await expect(dialog).not.toContainText('НОВИЙ-12000')
        for (const table of [
          'finance_settings',
          'money_accounts',
          'money_entries',
          'financial_documents',
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
