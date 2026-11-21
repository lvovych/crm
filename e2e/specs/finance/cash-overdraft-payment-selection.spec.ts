import { languageState } from '../../support/language'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { test, expect } from '@playwright/test'
import { plantWorkshop, plantJob } from '../../support/db'
import { settle } from '../../support/hydration'
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`cash settings and payment selection ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      storageState: languageState('uk'),
    })
    test('owner enables cash overdraft and first account selection persists', async ({ page }) => {
      const url = process.env.E2E_DATABASE_URL ?? ''
      if (
        !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
        !/(test|e2e)/.test(new URL(url).pathname)
      )
        throw Error('Only a local test database')
      const email = `cash-${randomUUID()}@example.test`,
        password = 'Cash-e2e-test-password'
      const owner = await plantWorkshop({
        name: 'Cash tester',
        email,
        password,
        workshopName: 'Isolated cash test',
      })
      const db = new Client({ connectionString: url })
      await db.connect()
      const entity = randomUUID(),
        cash = randomUUID(),
        bank = randomUUID(),
        category = randomUUID()
      try {
        await db.query(
          'insert into own_legal_entities(id,"organizationId",name) values($1,$2,$3)',
          [entity, owner.organizationId, 'Test company']
        )
        for (const [id, name, kind] of [
          [cash, 'Test cash', 'cash'],
          [bank, 'Test bank', 'bank'],
        ])
          await db.query(
            'insert into money_accounts(id,"organizationId","legalEntityId",name,kind) values($1,$2,$3,$4,$5)',
            [id, owner.organizationId, entity, name, kind]
          )
        await db.query(
          'insert into cash_flow_categories(id,"organizationId",name,direction) values($1,$2,$3,$4)',
          [category, owner.organizationId, 'Test income', 'income']
        )
        await db.query(
          'insert into finance_settings("organizationId","activatedOn","activatedAt") values($1,current_date,now())',
          [owner.organizationId]
        )
        await page.goto('/auth/sign-in')
        await page.locator('#email').fill(email)
        await page.locator('#password').fill(password)
        await page.getByRole('button', { name: 'Увійти', exact: true }).click()
        await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
        await page.goto('/settings/finance')
        await settle(page)
        const row = page
          .locator('div')
          .filter({ has: page.getByText('Test cash', { exact: true }) })
          .filter({
            has: page.getByRole('button', { name: 'Редагувати реквізити рахунку', exact: true }),
          })
          .last()
        await row.getByRole('button', { name: 'Редагувати реквізити рахунку', exact: true }).click()
        const dialog = page.getByRole('dialog')
        const optIn = dialog.getByLabel('Дозволити від’ємний залишок', { exact: true })
        await expect(optIn).not.toBeChecked()
        await optIn.check()
        await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        expect(
          (await db.query('select "allowNegative" from money_accounts where id=$1', [cash])).rows[0]
            .allowNegative
        ).toBe(true)
        await page.reload()
        await settle(page)
        await row.getByRole('button', { name: 'Редагувати реквізити рахунку', exact: true }).click()
        await expect(optIn).toBeChecked()
        await dialog.getByRole('button', { name: 'Скасувати', exact: true }).click()

        const job = await plantJob(
          owner.organizationId,
          owner.userId,
          'Account selection regression'
        )
        await db.query('update service_records set "totalAmount"=100 where id=$1', [
          job.serviceRecordId,
        ])
        await page.goto(`/vehicles/${job.vehicleId}/service/${job.serviceRecordId}`)
        await settle(page)
        await page
          .getByTestId('payments-section')
          .getByRole('button', { name: 'Внести платіж', exact: true })
          .click()
        const account = page.getByRole('combobox', { name: 'Каса / рахунок', exact: true })
        await expect(account.locator(`option[value="${bank}"]`)).toHaveCount(1)
        // A single native selection: no retries masking the original bug.
        await account.selectOption(bank)
        await expect(account).toHaveValue(bank)
        await page.locator('#paymentAmount').fill('25')
        await expect(account).toHaveValue(bank)
        await page.getByRole('button', { name: 'Зберегти платіж', exact: true }).click()
        await expect
          .poll(
            async () =>
              (
                await db.query(
                  'select count(*)::int as count from money_entries where "organizationId"=$1 and "accountId"=$2 and amount=25',
                  [owner.organizationId, bank]
                )
              ).rows[0].count
          )
          .toBe(1)
        expect(
          (
            await db.query(
              'select count(*)::int as count from money_entries where "organizationId"=$1 and "accountId"=$2',
              [owner.organizationId, cash]
            )
          ).rows[0].count
        ).toBe(0)
      } finally {
        await db.end()
      }
    })
  })
}
