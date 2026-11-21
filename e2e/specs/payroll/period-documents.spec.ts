import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { expect, test } from '@playwright/test'
import { plantWorkshop } from '../../support/db'
import { languageState } from '../../support/language'
import { settle } from '../../support/hydration'

test.use({ storageState: languageState('uk') })
for (const width of [1440, 390]) {
  test(`salary rules and period document from inherited executors (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    const url = new URL(process.env.E2E_DATABASE_URL ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !/test|e2e/.test(url.pathname))
      throw new Error('Dedicated local test database required')
    const email = `salary-${randomUUID()}@example.test`,
      password = 'Payroll-local-test-password'
    const owner = await plantWorkshop({
      name: 'Salary owner',
      email,
      password,
      workshopName: 'Salary e2e',
    })
    const db = new Client({ connectionString: url.toString() })
    await db.connect()
    const manager = randomUUID(),
      mechanic = randomUUID(),
      archived = randomUUID(),
      order = randomUUID()
    try {
      for (const [id, name, active, role] of [
        [manager, 'Менеджер Тест', true, 'advisor'],
        [mechanic, 'Механік Тест', true, 'mechanic'],
        [archived, 'Архівний Тест', false, 'mechanic'],
      ]) {
        await db.query(
          'INSERT INTO technicians (id,name,"organizationId","updatedAt","isActive","workRoles") VALUES($1,$2,$3,now(),$4,ARRAY[$5]::text[])',
          [id, name, owner.organizationId, active, role]
        )
      }
      await db.query(
        'INSERT INTO "EmployeePayRule" (id,"technicianId","ruleKey",effective,name,basis,scope,rate,"actorId") VALUES($1,$2,$1,\'2026-11-01\',\'Власні роботи\',\'labor\',\'performer\',40,$3)',
        [randomUUID(), mechanic, owner.userId]
      )
      for (const [id, status, closed] of [
        [order, 'completed', '2026-11-17T12:00:00Z'],
        [randomUUID(), 'pending', null],
        [randomUUID(), 'completed', '2026-11-15T12:00:00Z'],
      ]) {
        await db.query(
          'INSERT INTO service_records (id,title,status,"organizationId","technicianId","payrollEarnedAt","updatedAt",subtotal,"invoiceNumber") VALUES($1,\'Salary job\',$2,$3,$4,$5,now(),15000,$1)',
          [id, status, owner.organizationId, mechanic, closed]
        )
        await db.query(
          'INSERT INTO service_labor(id,description,total,"serviceRecordId",hours) VALUES($1,\'Ремонт\',5000,$2,1)',
          [randomUUID(), id]
        )
        await db.query(
          'INSERT INTO service_parts(id,name,quantity,"unitPrice",total,"unitCost","serviceRecordId") VALUES($1,\'Запчастина\',1,10000,10000,7000,$2)',
          [randomUUID(), id]
        )
      }
      await page.goto('/auth/sign-in')
      await settle(page)
      await page.locator('#email').fill(email)
      await page.locator('#password').fill(password)
      await page.getByRole('button', { name: 'Увійти', exact: true }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
      await page.goto(`/payroll?mode=rules&employee=${manager}`)
      await settle(page)
      await expect(page.getByRole('option', { name: /Архівний Тест/ })).toHaveCount(0)
      await page.getByLabel('Показати також архівних працівників').check()
      await expect(page.getByRole('option', { name: /Архівний Тест/ })).toHaveCount(1)
      await page.getByLabel('Показати також архівних працівників').uncheck()
      for (const [basis, rate, name] of [
        ['partsMargin', '10', 'Запчастини менеджера'],
        ['managerLabor', '5', 'Роботи менеджера'],
      ]) {
        await page.getByRole('button', { name: '+ Додати правило', exact: true }).click()
        await page.getByLabel('Назва правила').fill(name)
        await page.getByLabel('База нарахування', { exact: true }).selectOption(basis)
        await expect(page.getByLabel('Які позиції враховувати')).toHaveValue('workshop')
        await page.getByLabel('Ставка, %').fill(rate)
        await page.getByLabel('Діє з').fill('2026-11-01')
        await page.getByRole('button', { name: 'Зберегти правило', exact: true }).click()
        await expect(page.getByLabel('Назва правила')).toHaveCount(0)
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
      }
      await page.getByRole('button', { name: 'Документи нарахування', exact: true }).click()
      await page.getByRole('button', { name: 'Створити нарахування', exact: true }).click()
      await page.getByLabel('Працівник', { exact: true }).selectOption(manager)
      await page.getByLabel('Початок періоду').fill('2026-11-16')
      await page.getByLabel('Кінець періоду включно').fill('2026-11-22')
      await page.getByRole('button', { name: 'Заповнити за правилами', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'За що нараховано зарплату' })).toBeVisible()
      await expect(page.locator('dl').last()).toContainText('450,00')
      await expect(
        page.getByText('Механік Тест · Виконавець, зафіксований при закритті')
      ).toBeVisible()
      await page.getByRole('button', { name: 'Зберегти чернетку', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Чернетку збережено')
      await page.getByRole('button', { name: 'Провести нарахування', exact: true }).click()
      await expect(page.getByRole('status')).toContainText('Нарахування проведено')
      await expect(page.getByRole('button', { name: 'Провести нарахування' })).toHaveCount(0)
      const saved = (
        await db.query('SELECT status,total,lines FROM "PaySlip" WHERE "technicianId"=$1', [
          manager,
        ])
      ).rows
      expect(saved).toHaveLength(1)
      expect(saved[0].status).toBe('completed')
      expect(saved[0].total).toBe('450.00')
      expect(
        new Set(saved[0].lines.lines.map((line: { orderId: string }) => line.orderId))
      ).toEqual(new Set([order]))
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
    } finally {
      await db.end()
    }
  })
}
