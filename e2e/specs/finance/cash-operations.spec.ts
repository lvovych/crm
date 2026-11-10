import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { test, expect } from '@playwright/test'
import { plantWorkshop } from '../../support/db'
import { settle } from '../../support/hydration'
for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`cash operations ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      storageState: { cookies: [], origins: [] },
    })
    test('draft, posting, transfer and reversal preserve exact balances', async ({ page }) => {
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
        await page.getByRole('button', { name: 'Sign In', exact: true }).click()
        await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
        await page.goto('/finance')
        await settle(page)
        await page.getByRole('button', { name: '＋ Додати операцію', exact: true }).click()
        await page.getByRole('button', { name: 'Інше надходження коштів', exact: true }).click()
        let dialog = page.getByRole('dialog', { name: 'Інше надходження коштів', exact: true })
        await dialog.getByRole('combobox', { name: 'На рахунок', exact: true }).selectOption(cash)
        await dialog.getByLabel('Сума, грн').fill('100,01')
        await dialog.getByRole('combobox', { name: 'Стаття', exact: true }).selectOption(category)
        await dialog.getByLabel('Призначення').fill('Test exact income')
        await dialog.getByRole('button', { name: 'Зберегти чернетку', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        expect(
          (
            await db.query(
              'select count(*)::int as count from money_entries where "organizationId"=$1',
              [owner.organizationId]
            )
          ).rows[0].count
        ).toBe(0)
        await page.getByRole('button', { name: 'Редагувати', exact: true }).click()
        dialog = page.getByRole('dialog')
        await expect(dialog.getByLabel('Сума, грн')).toHaveValue('100.01')
        await dialog.getByLabel('Сума, грн').fill('100,02')
        await dialog.getByRole('button', { name: 'Зберегти зміни чернетки', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await page.getByRole('button', { name: 'Редагувати', exact: true }).click()
        await page.getByRole('dialog').getByLabel('Сума, грн').fill('100,01')
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Зберегти зміни чернетки', exact: true })
          .click()
        await expect(page.getByRole('dialog')).not.toBeVisible()
        expect(
          (
            await db.query(
              'select count(*)::int as count from money_entries where "organizationId"=$1',
              [owner.organizationId]
            )
          ).rows[0].count
        ).toBe(0)
        await page.getByRole('button', { name: 'Провести', exact: true }).click()
        dialog = page.getByRole('dialog', { name: 'Провести чернетку', exact: true })
        await dialog.getByRole('button', { name: 'Провести', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await page.getByRole('button', { name: '＋ Додати операцію', exact: true }).click()
        await page
          .getByRole('button', { name: 'Переказ між своїми рахунками', exact: true })
          .click()
        dialog = page.getByRole('dialog', { name: 'Переказ між своїми рахунками', exact: true })
        await dialog.getByRole('combobox', { name: 'З рахунку', exact: true }).selectOption(cash)
        await dialog.getByRole('combobox', { name: 'На рахунок', exact: true }).selectOption(bank)
        await dialog.getByLabel('Сума, грн').fill('20,01')
        await dialog.getByLabel('Призначення').fill('Test transfer')
        await expect(dialog.getByLabel('Підсумок операції')).toContainText('100,01 грн → 80,00 грн')
        const bounds = await dialog.boundingBox()
        expect(bounds!.width).toBeLessThanOrEqual(viewport.width)
        expect(bounds!.height).toBeLessThanOrEqual(viewport.height)

        await dialog.getByRole('button', { name: 'Провести переказ', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await page.reload()
        await settle(page)
        await expect(page.getByRole('button', { name: /Test cash.*80,00/ })).toBeVisible()
        await expect(page.getByRole('button', { name: /Test bank.*20,01/ })).toBeVisible()
        const row = page.locator('article').filter({ hasText: 'Test transfer' }).first()
        await expect(page.locator('article').filter({ hasText: 'Test transfer' })).toHaveCount(1)
        await row.getByText('Деталі та дії', { exact: true }).click()
        await row.getByRole('button', { name: 'Скасувати помилкову операцію', exact: true }).click()
        dialog = page.getByRole('dialog', { name: 'Скасувати помилкову операцію', exact: true })
        await dialog.getByLabel('Причина виправлення').fill('Test reversal')
        await dialog.getByRole('button', { name: 'Підтвердити виправлення', exact: true }).click()
        await expect(dialog).not.toBeVisible()
        await expect(page.getByRole('button', { name: /Test cash.*100,01/ })).toBeVisible()
        await expect(page.getByRole('button', { name: /Test bank.*0,00/ })).toBeVisible()
        await page.getByRole('button', { name: /Test cash.*100,01/ }).click()
        await expect(page.getByRole('button', { name: /Операції: Test cash/ })).toBeVisible()
        await page.getByRole('button', { name: /Додати операцію/ }).click()
        await expect(page.getByRole('link', { name: /Оплата від клієнта/ })).toHaveAttribute(
          'href',
          '/work-orders'
        )
        await expect(page.getByRole('link', { name: /Оплата постачальнику/ })).toHaveAttribute(
          'href',
          '/settlements'
        )
        await page.getByRole('button', { name: 'Інше надходження коштів', exact: true }).click()
        await expect(
          page.getByRole('dialog').getByRole('combobox', { name: 'На рахунок', exact: true })
        ).toHaveValue(cash)
        await page.getByRole('button', { name: 'Скасувати', exact: true }).click()
        await page.getByRole('button', { name: /Операції: Test cash/ }).click()
        await page.getByText('Фільтри та період', { exact: true }).click()
        await page.getByRole('button', { name: 'Сьогодні', exact: true }).click()
        await expect(page.getByLabel('Операції від', { exact: true })).toHaveValue(
          await page.getByLabel('Операції до', { exact: true }).inputValue()
        )
        await page.getByRole('button', { name: 'Скинути фільтри', exact: true }).click()
        await expect(page.getByLabel('Операції від', { exact: true })).toHaveValue('')
        const sum = await db.query(
          'select sum(amount)::text as total from money_entries where "organizationId"=$1',
          [owner.organizationId]
        )
        expect(sum.rows[0].total).toBe('100.01')
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
        ).toBe(false)
      } finally {
        await db.end()
      }
    })
  })
}
