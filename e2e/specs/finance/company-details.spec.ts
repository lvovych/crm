import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { test, expect } from '@playwright/test'
import { plantWorkshop } from '../../support/db'
import { settle } from '../../support/hydration'
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`company details ${viewport.name}`, () => {
    test.use({ viewport, storageState: { cookies: [], origins: [] } })
    test('edits the existing entity without activating cash or changing linked accounts', async ({
      page,
    }) => {
      const url = process.env.E2E_DATABASE_URL ?? ''
      if (
        !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
        !/(test|e2e)/.test(new URL(url).pathname)
      )
        throw Error('Local test database required')
      const email = `entity-${randomUUID()}@example.test`,
        password = 'Entity-local-test-password'
      const owner = await plantWorkshop({
        name: 'Entity tester',
        email,
        password,
        workshopName: 'Company edit test',
      })
      const db = new Client({ connectionString: url })
      await db.connect()
      const entity = randomUUID(),
        account = randomUUID(),
        bank = randomUUID()
      try {
        await db.query(
          'insert into own_legal_entities(id,"organizationId",name) values($1,$2,$3)',
          [entity, owner.organizationId, 'Тестова компанія']
        )
        await db.query(
          'insert into money_accounts(id,"organizationId","legalEntityId",name,kind) values($1,$2,$3,$4,$5)',
          [account, owner.organizationId, entity, 'Тестова каса', 'cash']
        )
        await db.query(
          'insert into money_accounts(id,"organizationId","legalEntityId",name,kind) values($1,$2,$3,$4,$5)',
          [bank, owner.organizationId, entity, 'Тестовий банк', 'bank']
        )
        const before = (await db.query('select * from money_accounts where id=$1', [account])).rows
        await page.goto('/auth/sign-in')
        await page.locator('#email').fill(email)
        await page.locator('#password').fill(password)
        await page.getByRole('button', { name: 'Sign In', exact: true }).click()
        await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
        await page.goto('/settings/finance')
        await settle(page)
        await page.getByRole('button', { name: 'Редагувати реквізити', exact: true }).click()
        const dialog = page.getByRole('dialog')
        await expect(dialog.getByLabel('Назва', { exact: true })).toHaveValue('Тестова компанія')
        await expect(dialog.getByLabel('Код / податковий номер')).toHaveValue('')
        await dialog.getByLabel('Код / податковий номер').fill('1631608939')
        await dialog.getByLabel('Назва', { exact: true }).fill('Тестова компанія — оновлено')
        await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await page.reload()
        await settle(page)
        await page.getByRole('button', { name: 'Редагувати реквізити', exact: true }).click()
        await expect(dialog.getByLabel('Код / податковий номер')).toHaveValue('1631608939')
        await expect(dialog.getByLabel('Назва', { exact: true })).toHaveValue(
          'Тестова компанія — оновлено'
        )
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        )
        const box = await dialog.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
        await page.screenshot({
          path: `/tmp/company-details-${viewport.name}.png`,
          animations: 'disabled',
        })
        await dialog.getByRole('button', { name: 'Скасувати', exact: true }).click()
        const bankRow = page
          .locator('div')
          .filter({ has: page.getByText('Тестовий банк', { exact: true }) })
          .filter({
            has: page.getByRole('button', { name: 'Редагувати реквізити рахунку', exact: true }),
          })
          .last()
        await bankRow
          .getByRole('button', { name: 'Редагувати реквізити рахунку', exact: true })
          .click()
        await expect(dialog.getByLabel('IBAN')).toHaveValue('')
        await dialog.getByLabel('IBAN').fill('ua21 322313 0000026007233566001')
        await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await page.reload()
        await settle(page)
        await bankRow
          .getByRole('button', { name: 'Редагувати реквізити рахунку', exact: true })
          .click()
        await expect(dialog.getByLabel('IBAN')).toHaveValue('UA213223130000026007233566001')
        await page.screenshot({
          path: `/tmp/bank-details-${viewport.name}.png`,
          animations: 'disabled',
        })
        expect(
          (await db.query('select "legalEntityId",iban from money_accounts where id=$1', [bank]))
            .rows
        ).toEqual([{ legalEntityId: entity, iban: 'UA213223130000026007233566001' }])
        await dialog.getByRole('button', { name: 'Скасувати', exact: true }).click()
        expect(
          (await db.query('select * from money_accounts where id=$1', [account])).rows
        ).toEqual(before)
        expect(
          (
            await db.query('select id,"taxId" from own_legal_entities where "organizationId"=$1', [
              owner.organizationId,
            ])
          ).rows
        ).toEqual([{ id: entity, taxId: '1631608939' }])
        for (const table of [
          'finance_settings',
          'finance_cutover_batches',
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
