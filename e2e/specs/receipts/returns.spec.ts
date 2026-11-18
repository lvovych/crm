import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { settle } from '../../support/hydration'
import { receiptDb, receiptFixture } from '../../support/receipt-fixture'

test('returns all receipt goods in one document and updates supplier debt and stock once', async ({
  page,
}) => {
  const fixture = await receiptFixture()
  const db = await receiptDb()
  const receiptId = randomUUID()
  const debitId = randomUUID()
  try {
    const {
      rows: [owner],
    } = await db.query('select "createdById" from counterparties where id=$1', [
      fixture.supplier.id,
    ])
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() - 86400000))
    await db.query(
      'insert into supplier_receipts (id,"organizationId","supplierId",number,"documentDate","receivedDate",status,"createdById") values ($1,$2,$3,$4,$5,$5,\'posted\',$6)',
      [
        receiptId,
        fixture.organizationId,
        fixture.supplier.id,
        fixture.prefix + '-return',
        date,
        owner.createdById,
      ]
    )
    for (const [position, quantity] of [3, 2].entries()) {
      await db.query(
        'insert into supplier_receipt_lines (id,"receiptId",position,kind,name,unit,quantity,"unitPrice",amount,"partId",article) values ($1,$2,$3,\'part\',$4,\'шт\',$5,100,$6,$7,$8)',
        [
          randomUUID(),
          receiptId,
          position,
          fixture.prefix + '-line-' + position,
          quantity,
          quantity * 100,
          fixture.part.id,
          fixture.part.partNumber,
        ]
      )
    }
    await db.query(
      'insert into supplier_entries (id,"organizationId","supplierId","receiptId",kind,amount,date,"createdById") values ($1,$2,$3,$4,\'receipt\',500,$5,$6)',
      [debitId, fixture.organizationId, fixture.supplier.id, receiptId, date, owner.createdById]
    )
    await page.goto('/receipts/' + receiptId)
    await settle(page)
    await page.getByRole('tab', { name: 'Оплати й розрахунки', exact: true }).click()
    const payments = page.getByRole('tabpanel', { name: 'Оплати й розрахунки', exact: true })
    await expect(payments.getByText('До сплати', { exact: true }).locator('..')).toContainText(
      '500,00 грн'
    )
    await page.getByRole('tab', { name: 'Повернення', exact: true }).click()
    const returns = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Повернення постачальнику', exact: true }) })
    await returns.getByText('Створити повернення з накладної', { exact: true }).click()
    await returns.getByRole('button', { name: 'Повернути все доступне з накладної' }).click()
    await expect(
      returns.getByLabel('Повернути ' + fixture.prefix + '-line-0', { exact: true })
    ).toHaveValue('3.000')
    await expect(
      returns.getByLabel('Повернути ' + fixture.prefix + '-line-1', { exact: true })
    ).toHaveValue('2.000')
    await returns.getByLabel('Причина повернення').selectOption('Відмова клієнта')
    await returns.getByRole('button', { name: 'Зберегти чернетку', exact: true }).click()
    await expect(page.getByText('Чернетка', { exact: true })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Провести повернення', exact: true })
    ).toBeVisible()
    expect(
      (await db.query('select quantity from inventory_parts where id=$1', [fixture.part.id]))
        .rows[0].quantity
    ).toBe(10)
    await page.getByRole('button', { name: 'Провести повернення', exact: true }).click()
    await expect(page.getByText('Проведено', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Повернення постачальнику №/ })).toBeVisible()
    await expect(page.getByRole('row')).toHaveCount(3)
    await page.reload()
    await settle(page)
    const { rows: documents } = await db.query(
      'select id from supplier_returns where "receiptId"=$1',
      [receiptId]
    )
    expect(documents).toHaveLength(1)
    expect(
      (await db.query('select quantity from inventory_parts where id=$1', [fixture.part.id]))
        .rows[0].quantity
    ).toBe(5)
    expect(
      Number(
        (
          await db.query(
            'select sum(amount) as total from supplier_allocations where "debitId"=$1 and "reversedAt" is null',
            [debitId]
          )
        ).rows[0].total
      )
    ).toBe(0)
    await page.goto('/settlements?supplier=' + fixture.supplier.id)
    await settle(page)
    await expect(
      page.getByText('Сальдо постачальника', { exact: true }).locator('..')
    ).toContainText('0,00 грн')
    await expect(page.getByText(/Повернення постачальнику/).first()).toBeVisible()
  } finally {
    await db.end()
  }
})
