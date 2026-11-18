import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { receiptDb, receiptFixture } from '../../support/receipt-fixture'
import { settle } from '../../support/hydration'

test('server pages preserve a multi-receipt draft and list filters', async ({ page }) => {
  const fixture = await receiptFixture()
  const db = await receiptDb()
  try {
    const {
      rows: [owner],
    } = await db.query('select "createdById" from counterparties where id=$1', [
      fixture.supplier.id,
    ])
    const lineIds: string[] = []
    const receipts = [randomUUID(), randomUUID()].sort()
    for (const [invoice, receiptId] of receipts.entries()) {
      await db.query(
        `insert into supplier_receipts
        (id,"organizationId","supplierId",number,"documentDate","receivedDate",status,"createdById")
        values ($1,$2,$3,$4,'2026-01-01','2026-01-01','posted',$5)`,
        [
          receiptId,
          fixture.organizationId,
          fixture.supplier.id,
          fixture.prefix + '-INV-' + invoice,
          owner.createdById,
        ]
      )
      for (let i = 0; i < 15; i++) {
        const id = randomUUID()
        lineIds.push(id)
        await db.query(
          `insert into supplier_receipt_lines
          (id,"receiptId",position,kind,name,unit,quantity,"unitPrice",amount,"partId",article)
          values ($1,$2,$3,'part',$4,'шт',1,100,100,$5,$6)`,
          [
            id,
            receiptId,
            i,
            fixture.prefix + '-item-' + (invoice * 15 + i),
            fixture.part.id,
            fixture.prefix + '-SKU-' + (invoice * 15 + i),
          ]
        )
      }
      await db.query(
        `insert into supplier_entries
        (id,"organizationId","supplierId","receiptId",kind,amount,date,"createdById")
        values ($1,$2,$3,$4,'receipt',1500,'2026-01-01',$5)`,
        [randomUUID(), fixture.organizationId, fixture.supplier.id, receiptId, owner.createdById]
      )
    }
    await page.goto('/supplier-returns/new?supplier=' + fixture.supplier.id)
    await settle(page)
    await expect(page.getByRole('checkbox')).toHaveCount(25)
    await page.getByRole('checkbox').first().check()
    await page
      .getByRole('navigation', { name: 'Сторінки доступних позицій' })
      .getByRole('button', { name: 'Далі' })
      .click()
    await expect(page.getByRole('checkbox')).toHaveCount(5)
    await page.getByRole('checkbox').first().check()
    await expect(
      page.getByRole('heading', { name: '2. Перевірте повернення · 2 поз.' })
    ).toBeVisible()
    await page.getByLabel('Знайти позицію').fill(fixture.prefix + '-SKU-29')
    await page.getByRole('button', { name: 'Знайти', exact: true }).click()
    await expect(page.getByRole('checkbox')).toHaveCount(1)
    await expect(page.getByText('Сума: 200,00 грн', { exact: true })).toBeVisible()
    await page.getByLabel('Причина повернення').selectOption('Інше')
    await page.getByLabel('Номер документа постачальника').fill('PAGE-REFERENCE')
    await page.getByRole('button', { name: 'Зберегти чернетку', exact: true }).click()
    await expect(page).toHaveURL(/\/supplier-returns\/[^/?]+$/)
    await expect(page.getByText('Чернетка', { exact: true })).toBeVisible()
    const savedId = new URL(page.url()).pathname.split('/').at(-1)!
    const { rows: sources } = await db.query(
      `select distinct l."receiptId" from supplier_return_lines rl
      join supplier_receipt_lines l on l.id=rl."lineId" where rl."returnId"=$1`,
      [savedId]
    )
    expect(sources).toHaveLength(2)
    expect(
      (await db.query('select quantity from inventory_parts where id=$1', [fixture.part.id]))
        .rows[0].quantity
    ).toBe(10)
    expect(
      (await db.query('select id from supplier_entries where "returnId"=$1', [savedId])).rows
    ).toHaveLength(0)
    for (let i = 0; i < 27; i++) {
      const id = randomUUID()
      await db.query(
        `insert into supplier_returns
        (id,"organizationId","supplierId",number,date,reason,fingerprint,"createdById",status)
        values ($1,$2,$3,$4,'2026-01-01','Інше',$1,$5,'draft')`,
        [
          id,
          fixture.organizationId,
          fixture.supplier.id,
          fixture.prefix + '-DRAFT-' + i,
          owner.createdById,
        ]
      )
      await db.query(
        `insert into supplier_return_lines (id,"returnId","lineId",quantity,amount)
        values ($1,$2,$3,0.1,10)`,
        [randomUUID(), id, lineIds[0]]
      )
    }
    await page.goto('/supplier-returns?supplier=' + fixture.supplier.id + '&status=draft')
    await settle(page)
    await expect(page.locator('tbody tr')).toHaveCount(25)
    await page
      .getByRole('navigation', { name: 'Сторінки повернень' })
      .getByRole('link', { name: 'Далі' })
      .click()
    await expect(page).toHaveURL(/page=2/)
    expect(new URL(page.url()).searchParams.get('supplier')).toBe(fixture.supplier.id)
    expect(new URL(page.url()).searchParams.get('status')).toBe('draft')
    await expect(page.locator('tbody tr')).toHaveCount(3)
    await page.getByLabel('Номер або постачальник').fill('PAGE-REFERENCE')
    await page.getByRole('button', { name: 'Показати', exact: true }).click()
    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('tbody')).toContainText('PAGE-REFERENCE')
    await page
      .getByRole('button', { name: 'Постачальник: ' + fixture.supplier.name, exact: true })
      .click()
    await page.getByLabel('Пошук постачальника').fill(fixture.prefix)
    await page.getByRole('button', { name: fixture.supplier.name, exact: true }).click()
    await page.goto('/suppliers/' + fixture.supplier.id + '?returnsPage=2')
    await settle(page)
    const supplierReturns = page.getByRole('tabpanel', { name: 'Повернення', exact: true })
    await expect(supplierReturns.locator('tbody tr')).toHaveCount(3)
    await supplierReturns.getByRole('link', { name: 'Назад', exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp('/suppliers/' + fixture.supplier.id + '\\?returnsPage=1')
    )
    await expect(
      page.getByRole('tabpanel', { name: 'Повернення', exact: true }).locator('tbody tr')
    ).toHaveCount(25)
  } finally {
    await db.query('delete from supplier_entries where "supplierId"=$1', [fixture.supplier.id])
    await db.query(
      'delete from supplier_return_lines where "returnId" in (select id from supplier_returns where "supplierId"=$1)',
      [fixture.supplier.id]
    )
    await db.query('delete from supplier_returns where "supplierId"=$1', [fixture.supplier.id])
    await db.query('delete from supplier_receipts where "supplierId"=$1', [fixture.supplier.id])
    await db.end()
  }
})
