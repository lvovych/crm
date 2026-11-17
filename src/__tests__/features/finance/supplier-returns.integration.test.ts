// @vitest-environment node
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { randomUUID } from 'node:crypto'
import { postSupplierReturn } from '@/features/receipts/return-ledger'
import { supplierTotals, remaining, workshopDay } from '@/features/settlements/amounts'
import type { TxClient } from '@/lib/db'

const url = process.env.FINANCE_TEST_DATABASE_URL
describe.skipIf(!url)('supplier returns on PostgreSQL', () => {
  let db: PrismaClient
  afterAll(async () => db?.$disconnect())
  async function setup(kind = 'part', quantity = '3', price = '100') {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('test')
    )
      throw new Error('Local test database required')
    db ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    const org = await db.organization.create({ data: { name: 'Return test' } })
    const user = await db.user.create({
      data: { email: randomUUID() + '@returns.test', name: 'Test' },
    })
    const supplier = await db.counterparty.create({
      data: { organizationId: org.id, name: 'Supplier', createdById: 'test' },
    })
    const brand = await db.brand.create({ data: { name: 'Return ' + randomUUID() } })
    const part = await db.inventoryPart.create({
      data: {
        userId: user.id,
        organizationId: org.id,
        name: 'Part',
        brandId: brand.id,
        quantity: Number(quantity),
        unit: 'шт',
      },
    })
    const date = new Date(workshopDay() + 'T00:00:00Z')
    const receipt = await db.supplierReceipt.create({
      data: {
        organizationId: org.id,
        supplierId: supplier.id,
        number: 'RETURN-TEST',
        documentDate: date,
        receivedDate: date,
        status: 'posted',
        createdById: 'test',
        lines: {
          create: {
            position: 0,
            kind,
            name: 'Test',
            unit: 'шт',
            quantity,
            unitPrice: price,
            amount: (Number(quantity) * Number(price)).toFixed(2),
            partId: kind === 'part' ? part.id : null,
          },
        },
        settlement: {
          create: {
            organizationId: org.id,
            supplierId: supplier.id,
            kind: 'receipt',
            amount: (Number(quantity) * Number(price)).toFixed(2),
            date,
            createdById: 'test',
          },
        },
      },
      include: { lines: true, settlement: true },
    })
    const request = (q: string) => ({
      id: randomUUID(),
      receiptId: receipt.id,
      reason: 'Повернення',
      lines: [{ id: receipt.lines[0].id, quantity: q }],
    })
    const post = (input: unknown, organizationId = org.id) =>
      db.$transaction((tx) => postSupplierReturn(tx as TxClient, organizationId, user.id, input))
    return { org, receipt, part, request, post, supplier }
  }
  it('posts partial and full remainder, reduces stock and debt, and retries exactly once', async () => {
    const f = await setup()
    const input = f.request('1')
    await Promise.all([f.post(input), f.post(input)])
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      2
    )
    expect(await db.supplierReturn.count({ where: { receiptId: f.receipt.id } })).toBe(1)
    const debt = await db.supplierEntry.findUniqueOrThrow({
      where: { id: f.receipt.settlement!.id },
      include: { debits: true },
    })
    expect(remaining(debt, debt.debits, workshopDay())).toBe(BigInt(20000))
    await f.post(f.request('2'))
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      0
    )
    await expect(f.post(f.request('1'))).rejects.toThrow('перевищує')
    await expect(f.post({ ...input, reason: 'Different' })).rejects.toThrow('іншого')
  })
  it('returns all lines of one receipt together to its supplier', async () => {
    const f = await setup()
    const second = await db.supplierReceiptLine.create({
      data: {
        receiptId: f.receipt.id,
        position: 1,
        kind: 'part',
        name: 'Second line',
        unit: 'шт',
        quantity: 2,
        unitPrice: 100,
        amount: 200,
        partId: f.part.id,
      },
    })
    await db.inventoryPart.update({ where: { id: f.part.id }, data: { quantity: 5 } })
    await db.supplierEntry.update({
      where: { id: f.receipt.settlement!.id },
      data: { amount: 500 },
    })
    const input = f.request('3')
    await f.post({ ...input, lines: [...input.lines, { id: second.id, quantity: '2' }] })
    const document = await db.supplierReturn.findUniqueOrThrow({
      where: { id: input.id },
      include: { settlement: true, lines: true },
    })
    expect(document.lines).toHaveLength(2)
    expect(document.settlement?.supplierId).toBe(f.supplier.id)
    expect(document.settlement?.amount.toFixed(2)).toBe('500.00')
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      0
    )
  })
  it('rolls back insufficient stock, rejects foreign organizations and duplicate lines', async () => {
    const f = await setup()
    await db.inventoryPart.update({ where: { id: f.part.id }, data: { quantity: 0 } })
    await expect(f.post(f.request('1'))).rejects.toThrow('залишок')
    expect(await db.supplierReturn.count({ where: { receiptId: f.receipt.id } })).toBe(0)
    await expect(f.post(f.request('1'), 'another-org')).rejects.toThrow()
    const input = f.request('1')
    await expect(f.post({ ...input, lines: [...input.lines, ...input.lines] })).rejects.toThrow()
  })
  it('rolls back earlier line movements when a later line cannot be returned', async () => {
    const f = await setup()
    const second = await db.supplierReceiptLine.create({
      data: {
        receiptId: f.receipt.id,
        position: 1,
        kind: 'part',
        name: 'Second',
        unit: 'шт',
        quantity: 3,
        unitPrice: 100,
        amount: 300,
        partId: f.part.id,
      },
    })
    const input = f.request('1')
    await expect(
      f.post({ ...input, lines: [...input.lines, { id: second.id, quantity: '3' }] })
    ).rejects.toThrow('залишок')
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      3
    )
    expect(await db.stockMovement.count({ where: { organizationId: f.org.id } })).toBe(0)
    expect(await db.supplierReturn.count({ where: { receiptId: f.receipt.id } })).toBe(0)
    expect(
      await db.supplierEntry.count({ where: { organizationId: f.org.id, kind: 'return_credit' } })
    ).toBe(0)
  })
  it('rejects closed periods, drafts and lines belonging to another receipt', async () => {
    const f = await setup()
    await db.financeSettings.create({
      data: { organizationId: f.org.id, closedThrough: f.receipt.receivedDate },
    })
    await expect(f.post(f.request('1'))).rejects.toThrow('Період закрито')
    await db.financeSettings.update({
      where: { organizationId: f.org.id },
      data: { closedThrough: null },
    })
    await db.supplierReceipt.update({ where: { id: f.receipt.id }, data: { status: 'draft' } })
    await expect(f.post(f.request('1'))).rejects.toThrow('проведеної')
    await db.supplierReceipt.update({ where: { id: f.receipt.id }, data: { status: 'posted' } })
    const other = await setup()
    await expect(
      f.post({ ...f.request('1'), lines: [{ id: other.receipt.lines[0].id, quantity: '1' }] })
    ).rejects.toThrow('цієї накладної')
    expect(await db.supplierReturn.count({ where: { receiptId: f.receipt.id } })).toBe(0)
  })
  it('returns free goods and keeps money and debt at zero', async () => {
    const f = await setup('part', '1', '0')
    await f.post(f.request('1'))
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      0
    )
    expect(
      (
        await db.supplierEntry.findFirstOrThrow({
          where: { organizationId: f.org.id, kind: 'return_credit' },
        })
      ).amount.toFixed(2)
    ).toBe('0.00')
    expect(await db.moneyEntry.count({ where: { organizationId: f.org.id } })).toBe(0)
  })
  it('prevents concurrent over-return', async () => {
    const f = await setup('part', '1')
    const results = await Promise.allSettled([f.post(f.request('1')), f.post(f.request('1'))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      0
    )
  })
  it('excludes goods transferred into orders and rejects unaccounted receipts', async () => {
    const f = await setup()
    await db.receiptTransfer.create({
      data: {
        lineId: f.receipt.lines[0].id,
        requestId: randomUUID(),
        requestHash: 'test',
        serviceRecordId: 'snapshot',
        serviceRecordLabel: 'Order',
        servicePartId: 'snapshot',
        quantity: 2,
        unitPrice: 100,
        createdById: 'test',
      },
    })
    await expect(f.post(f.request('2'))).rejects.toThrow('перевищує')
    await f.post(f.request('1'))
    await expect(f.post(f.request('1'))).rejects.toThrow('перевищує')
    const unknown = await setup()
    await db.supplierEntry.delete({ where: { id: unknown.receipt.settlement!.id } })
    await expect(unknown.post(unknown.request('1'))).rejects.toThrow('звірте')
  })
  it('preserves a credit for paid receipts and keeps returns out of cash advances', async () => {
    const f = await setup()
    const credit = await db.supplierEntry.create({
      data: {
        organizationId: f.org.id,
        supplierId: f.supplier.id,
        kind: 'payment',
        amount: 300,
        date: f.receipt.receivedDate,
        createdById: 'test',
      },
    })
    await db.supplierAllocation.create({
      data: {
        creditId: credit.id,
        debitId: f.receipt.settlement!.id,
        amount: 300,
        date: f.receipt.receivedDate,
        createdById: 'test',
      },
    })
    await f.post(f.request('1'))
    const entry = await db.supplierEntry.findFirstOrThrow({
      where: { organizationId: f.org.id, kind: 'return_credit' },
    })
    expect(entry.amount.toFixed(2)).toBe('100.00')
    expect(supplierTotals([{ kind: entry.kind, open: '100.00', overdue: false }])).toMatchObject({
      net: '-100.00',
      advance: '0.00',
      overdue: '0.00',
    })
  })
  it('returns services with exact cumulative rounding and adjusts purchase cost without stock movements', async () => {
    const f = await setup('service', '3', '0.3333')
    const order = await db.serviceRecord.create({
      data: { organizationId: f.org.id, title: 'Work', status: 'pending' },
    })
    const labor = await db.serviceLabor.create({
      data: {
        serviceRecordId: order.id,
        description: 'Test',
        hours: 3,
        rate: 10,
        total: 30,
        subcontract: {
          create: {
            supplierId: f.supplier.id,
            unitCost: '0.3333',
            receiptLineId: f.receipt.lines[0].id,
          },
        },
      },
    })
    await f.post(f.request('1'))
    await f.post(f.request('1'))
    await f.post(f.request('1'))
    const rows = await db.supplierReturnLine.findMany({
      where: { lineId: f.receipt.lines[0].id },
      orderBy: { amount: 'asc' },
    })
    expect(rows.map((r) => r.amount.toFixed(2))).toEqual(['0.33', '0.33', '0.34'])
    expect(
      (
        await db.subcontractWork.findUniqueOrThrow({ where: { laborId: labor.id } })
      ).returnedCost.toFixed(2)
    ).toBe('1.00')
    expect(await db.stockMovement.count({ where: { organizationId: f.org.id } })).toBe(0)
  })
})
