import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { test, expect } from '@playwright/test'
import { plantWorkshop } from '../../support/db'
import { settle } from '../../support/hydration'
test.use({ storageState: { cookies: [], origins: [] } })
test('payroll keeps all-time balance while paging documents and filtering employee detail', async ({
  page,
}) => {
  const url = process.env.E2E_DATABASE_URL ?? ''
  if (
    !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
    !/test|e2e/.test(new URL(url).pathname)
  )
    throw new Error('Local test database required')
  const email = 'payroll-' + randomUUID() + '@example.test',
    password = 'Payroll-local-test-password'
  const owner = await plantWorkshop({
    name: 'Payroll tester',
    email,
    password,
    workshopName: 'Payroll pagination',
  })
  const db = new Client({ connectionString: url })
  await db.connect()
  try {
    const employee = randomUUID()
    await db.query(
      'INSERT INTO technicians (id,name,"organizationId","updatedAt") VALUES ($1,$2,$3,now())',
      [employee, 'Працівник Період', owner.organizationId]
    )
    for (let i = 0; i < 52; i++)
      await db.query(
        'INSERT INTO "PaySlip" (id,"technicianId",start,"end",lines,total,"actorId") VALUES ($1,$2,current_date-$3::integer,current_date-$3::integer+6,$4::jsonb,100.01,$5)',
        [randomUUID(), employee, 7 * (i + 1), '[]', owner.userId]
      )
    await page.goto('/auth/sign-in')
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(password)
    await page.getByRole('button', { name: 'Sign In', exact: true }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/auth'))
    await page.goto('/employees?tab=documents')
    await settle(page)
    await expect(page.locator('main table tbody tr')).toHaveCount(50)
    await page
      .getByRole('navigation', { name: 'Сторінки нарахувань' })
      .getByRole('link', { name: 'Далі' })
      .click()
    await expect(page.locator('main table tbody tr')).toHaveCount(2)
    await page.goto('/employee-settlements?employee=' + employee)
    await settle(page)
    await expect(page.getByText(/Загальний залишок:/)).toContainText('5200,52')
    const initial = await page.locator('details[id^="slip-"]').count()
    expect(initial).toBeGreaterThan(0)
    expect(initial).toBeLessThan(20)
    const from = new Date()
    from.setUTCDate(from.getUTCDate() - 365)
    await page.locator('input[name="from"]').fill(from.toISOString().slice(0, 10))
    await page.getByRole('button', { name: 'Показати період' }).click()
    await expect(page.locator('details[id^="slip-"]')).toHaveCount(52)
    await expect(page.getByText(/Загальний залишок:/)).toContainText('5200,52')
  } finally {
    await db.end()
  }
})
