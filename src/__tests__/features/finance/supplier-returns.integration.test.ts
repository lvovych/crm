import { restoreSupplierReturn } from '@/features/receipts/return-backup'
import { readDocument } from '@/features/documents/queries'
import { reverseEntry } from '@/features/settlements/ledger'
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
      reason: 'Інше',
      lines: [{ id: receipt.lines[0].id, quantity: q }],
    })
    const post = (input: unknown, organizationId = org.id) =>
      db.$transaction((tx) => postSupplierReturn(tx as TxClient, organizationId, user.id, input))
    return { org, receipt, part, request, post, supplier }
  }

  it('drafts do not reserve stock or reduce debt; editing uses versions and posting is atomic', async () => {
    const f = await setup()
    const input = { ...f.request('1'), supplierDocumentNumber: '  ПВ-001/26  ' }
    const save = (raw: unknown) =>
      db.$transaction((tx) =>
        postSupplierReturn(tx as TxClient, f.org.id, 'manager', raw, workshopDay(), 'draft')
      )
    await save(input)
    await save(input)
    expect(
      (await db.supplierReturn.findUniqueOrThrow({ where: { id: input.id } }))
        .supplierDocumentNumber
    ).toBe('ПВ-001/26')
    expect(await db.supplierEntry.count({ where: { returnId: input.id } })).toBe(0)
    expect(await db.stockMovement.count({ where: { receiptLineId: f.receipt.lines[0].id } })).toBe(
      0
    )
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      3
    )
    await save({ ...input, version: 1, lines: [{ id: f.receipt.lines[0].id, quantity: '2' }] })
    await expect(save({ ...input, version: 1, reason: 'Відмова клієнта' })).rejects.toThrow(
      'уже змінено'
    )
    const edited = { ...input, version: 2, lines: [{ id: f.receipt.lines[0].id, quantity: '2' }] }
    await Promise.all([f.post(edited), f.post(edited)])
    expect((await db.supplierReturn.findUniqueOrThrow({ where: { id: input.id } })).status).toBe(
      'posted'
    )
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      1
    )
    expect(await db.supplierEntry.count({ where: { returnId: input.id } })).toBe(1)
    expect(
      await db.supplierAllocation.count({ where: { credit: { organizationId: f.org.id } } })
    ).toBe(0)
    expect(
      (await db.supplierReturn.findUniqueOrThrow({ where: { id: input.id } }))
        .supplierDocumentNumber
    ).toBe('ПВ-001/26')
  })
  it.each([
    'part',
    'service',
  ])('only one competing %s draft can consume the last quantity', async (kind) => {
    const f = await setup(kind, '1')
    const inputs = [f.request('1'), f.request('1')]
    for (const input of inputs) {
      await db.$transaction((tx) =>
        postSupplierReturn(tx as TxClient, f.org.id, 'manager', input, workshopDay(), 'draft')
      )
    }
    const results = await Promise.allSettled(
      inputs.map((input) => f.post({ ...input, version: 1 }))
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const docs = await db.supplierReturn.findMany({ where: { organizationId: f.org.id } })
    expect(docs.map((doc) => doc.status).sort()).toEqual(['draft', 'posted'])
    const credits = await db.supplierEntry.findMany({
      where: { organizationId: f.org.id, kind: 'return_credit' },
    })
    expect(credits).toHaveLength(1)
    expect(credits[0].amount.toFixed(2)).toBe('100.00')
    expect(await db.moneyEntry.count({ where: { organizationId: f.org.id } })).toBe(0)
    expect(await db.stockMovement.count({ where: { receiptLineId: f.receipt.lines[0].id } })).toBe(
      kind === 'part' ? 1 : 0
    )
  })

  it.each([
    'closed',
    'cancelled',
    'reversed',
    'unit',
  ])('rechecks %s after a draft was saved and leaves no partial posting', async (change) => {
    const f = await setup()
    const input = f.request('1')
    await db.$transaction((tx) =>
      postSupplierReturn(tx as TxClient, f.org.id, 'manager', input, workshopDay(), 'draft')
    )
    if (change === 'closed')
      await db.financeSettings.create({
        data: { organizationId: f.org.id, closedThrough: f.receipt.receivedDate },
      })
    if (change === 'cancelled')
      await db.supplierReceipt.update({
        where: { id: f.receipt.id },
        data: { status: 'cancelled' },
      })
    if (change === 'reversed')
      await db.supplierEntry.update({
        where: { id: f.receipt.settlement!.id },
        data: { reversedAt: new Date() },
      })
    if (change === 'unit')
      await db.inventoryPart.update({ where: { id: f.part.id }, data: { unit: 'л' } })
    await expect(f.post({ ...input, version: 1 })).rejects.toThrow()
    const draft = await db.supplierReturn.findUniqueOrThrow({
      where: { id: input.id },
      include: { lines: true },
    })
    expect(draft.status).toBe('draft')
    expect(draft.version).toBe(1)
    expect(draft.lines[0].quantity.toString()).toBe('1')
    expect(await db.supplierEntry.count({ where: { returnId: input.id } })).toBe(0)
    expect(await db.stockMovement.count({ where: { receiptLineId: f.receipt.lines[0].id } })).toBe(
      0
    )
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      3
    )
  })

  it('does not rewrite supplier reference on a posted retry', async () => {
    const f = await setup()
    const input = { ...f.request('1'), supplierDocumentNumber: 'RETURN-123' }
    await f.post(input)
    await expect(f.post({ ...input, supplierDocumentNumber: 'RETURN-456' })).rejects.toThrow(
      'іншого'
    )
    expect(
      (await db.supplierReturn.findUniqueOrThrow({ where: { id: input.id } }))
        .supplierDocumentNumber
    ).toBe('RETURN-123')
    expect(await db.supplierEntry.count({ where: { returnId: input.id } })).toBe(1)
  })

  it('revalidates stock when posting and preserves the draft on failure', async () => {
    const f = await setup()
    const input = f.request('3')
    await db.$transaction((tx) =>
      postSupplierReturn(tx as TxClient, f.org.id, 'manager', input, workshopDay(), 'draft')
    )
    await f.post(f.request('1'))
    await expect(f.post({ ...input, version: 1 })).rejects.toThrow('перевищує')
    expect((await db.supplierReturn.findUniqueOrThrow({ where: { id: input.id } })).status).toBe(
      'draft'
    )
    expect(await db.supplierEntry.count({ where: { returnId: input.id } })).toBe(0)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      2
    )
  })
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
    expect(remaining(debt, debt.debits, workshopDay())).toBe(BigInt(30000))
    expect(debt.debits).toHaveLength(0)
    const credit = await db.supplierEntry.findFirstOrThrow({ where: { returnId: input.id } })
    expect(
      supplierTotals([
        { kind: 'receipt', open: '300.00', overdue: true },
        { kind: credit.kind, open: credit.amount.toFixed(2), overdue: false },
      ])
    ).toMatchObject({ net: '200.00', overdue: '200.00', advance: '0.00' })
    await f.post(f.request('2'))
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      0
    )
    await expect(f.post(f.request('1'))).rejects.toThrow('перевищує')
    await expect(f.post({ ...input, reason: 'Відмова клієнта' })).rejects.toThrow('іншого')
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
  it('uses the server-resolved workshop date for document and settlement', async () => {
    const f = await setup()
    const today = new Date(f.receipt.receivedDate)
    today.setUTCDate(today.getUTCDate() - 1)
    const day = today.toISOString().slice(0, 10)
    await db.supplierReceipt.update({ where: { id: f.receipt.id }, data: { receivedDate: today } })
    await db.supplierEntry.update({
      where: { id: f.receipt.settlement!.id },
      data: { date: today },
    })
    const input = f.request('1')
    const actor = await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })
    await db.$transaction((tx) =>
      postSupplierReturn(tx as TxClient, f.org.id, actor.userId, input, day)
    )
    const doc = await db.supplierReturn.findUniqueOrThrow({
      where: { id: input.id },
      include: { settlement: true },
    })
    expect(doc.date.toISOString().slice(0, 10)).toBe(day)
    expect(doc.settlement!.date.toISOString().slice(0, 10)).toBe(day)
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
  it('returns a unit restored by reducing the original order line, without reusing it twice', async () => {
    const f = await setup('part', '2', '565')
    const order = await db.serviceRecord.create({
      data: { organizationId: f.org.id, title: 'Order' },
    })
    const part = await db.servicePart.create({
      data: { serviceRecordId: order.id, inventoryPartId: f.part.id, name: 'Part', quantity: 1 },
    })
    await db.inventoryPart.update({ where: { id: f.part.id }, data: { quantity: 1 } })
    await db.receiptTransfer.create({
      data: {
        lineId: f.receipt.lines[0].id,
        requestId: randomUUID(),
        requestHash: 'test',
        serviceRecordId: order.id,
        serviceRecordLabel: 'Order',
        servicePartId: part.id,
        quantity: 2,
        unitPrice: 565,
        createdById: 'test',
      },
    })
    await expect(f.post(f.request('2'))).rejects.toThrow('перевищує')
    const input = f.request('1')
    await f.post(input)
    await f.post(input)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      0
    )
    expect(
      (
        await db.supplierReturnLine.findFirstOrThrow({ where: { lineId: f.receipt.lines[0].id } })
      ).amount.toFixed(2)
    ).toBe('565.00')
    await expect(f.post(f.request('1'))).rejects.toThrow('перевищує')
  })

  it('releases a deleted order line, keeps other orders consumed and returns restored stock once', async () => {
    const f = await setup('part', '8', '100')
    const order = await db.serviceRecord.create({
      data: { organizationId: f.org.id, title: 'Oil order' },
    })
    const part = await db.servicePart.create({
      data: { serviceRecordId: order.id, inventoryPartId: f.part.id, name: 'Oil', quantity: 8 },
    })
    await db.receiptTransfer.create({
      data: {
        lineId: f.receipt.lines[0].id,
        requestId: randomUUID(),
        requestHash: 'oil',
        serviceRecordId: order.id,
        serviceRecordLabel: 'Oil order',
        servicePartId: part.id,
        quantity: 8,
        unitPrice: 100,
        createdById: 'test',
      },
    })
    await expect(f.post(f.request('1'))).rejects.toThrow('перевищує')
    await db.servicePart.delete({ where: { id: part.id } })
    // A replacement row must not make the historical transfer available again.
    const replacement = await db.servicePart.create({
      data: { serviceRecordId: order.id, inventoryPartId: f.part.id, name: 'Oil', quantity: 8 },
    })
    await expect(f.post(f.request('1'))).rejects.toThrow('перевищує')
    await db.servicePart.delete({ where: { id: replacement.id } })
    await f.post(f.request('8'))
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      0
    )
    await expect(f.post(f.request('1'))).rejects.toThrow('перевищує')
  })
  it('posts one independent supplier return across receipts, freezes identity and never pays source invoices', async () => {
    const f = await setup()
    await db.inventoryPart.update({
      where: { id: f.part.id },
      data: { quantity: 5, partNumber: '38MR0600' },
    })
    const brand = await db.brand.findUniqueOrThrow({ where: { id: f.part.brandId } })
    const second = await db.supplierReceipt.create({
      data: {
        organizationId: f.org.id,
        supplierId: f.supplier.id,
        number: 'SECOND',
        documentDate: f.receipt.documentDate,
        receivedDate: f.receipt.receivedDate,
        status: 'posted',
        createdById: 'test',
        lines: {
          create: {
            position: 0,
            kind: 'part',
            name: 'Second',
            unit: 'шт',
            quantity: 2,
            unitPrice: 200,
            amount: 400,
            partId: f.part.id,
          },
        },
        settlement: {
          create: {
            organizationId: f.org.id,
            supplierId: f.supplier.id,
            kind: 'receipt',
            amount: 400,
            date: f.receipt.receivedDate,
            createdById: 'test',
          },
        },
      },
      include: { lines: true, settlement: true },
    })
    const input = {
      id: randomUUID(),
      supplierId: f.supplier.id,
      reason: 'Інше',
      lines: [
        { id: f.receipt.lines[0].id, quantity: '1' },
        { id: second.lines[0].id, quantity: '1' },
      ],
    }
    await Promise.all([f.post(input), f.post(input)])
    const returned = await db.supplierReturn.findUniqueOrThrow({
      where: { id: input.id },
      include: { lines: true, settlement: { include: { credits: true } } },
    })
    expect(returned.receiptId).toBeNull()
    expect(returned.supplierId).toBe(f.supplier.id)
    expect(returned.lines).toHaveLength(2)
    const graph = await readDocument(
      db,
      {
        organizationId: f.org.id,
        receipts: true,
        orders: false,
        finance: false,
        settlements: false,
        payroll: false,
        accounts: [],
      },
      'return:' + input.id
    )
    expect(graph?.document.party).toBe(f.supplier.name)
    expect(
      graph?.edges
        .filter((e) => e.target === 'return:' + input.id)
        .map((e) => e.source)
        .sort()
    ).toEqual(['receipt:' + f.receipt.id, 'receipt:' + second.id].sort())
    await expect(
      db.$transaction((tx) =>
        reverseEntry(
          tx as TxClient,
          f.org.id,
          f.supplier.id,
          second.settlement!.id,
          'test',
          'cancel'
        )
      )
    ).rejects.toThrow('поверненням')

    expect(returned.settlement!.amount.toFixed(2)).toBe('300.00')
    expect(returned.settlement!.credits).toHaveLength(0)
    for (const id of [f.receipt.settlement!.id, second.settlement!.id])
      expect(await db.supplierAllocation.count({ where: { debitId: id } })).toBe(0)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      3
    )
    expect(
      supplierTotals([
        { kind: 'receipt', open: '700.00', overdue: true },
        { kind: 'return_credit', open: '300.00', overdue: false },
      ])
    ).toMatchObject({ net: '400.00', overdue: '400.00', advance: '0.00' })
    await db.inventoryPart.update({ where: { id: f.part.id }, data: { partNumber: 'CHANGED' } })
    await db.brand.update({ where: { id: brand.id }, data: { name: 'Changed ' + randomUUID() } })
    const frozen = await db.supplierReturnLine.findMany({ where: { returnId: input.id } })
    expect(
      frozen.every((l) => l.articleSnapshot === '38MR0600' && l.brandSnapshot === brand.name)
    ).toBe(true)
    await expect(f.post({ ...input, reason: 'Відмова клієнта' })).rejects.toThrow('іншого')
  })
  it('rejects lines from another supplier or tenant in a consolidated return without partial writes', async () => {
    const f = await setup(),
      other = await setup()
    const input = {
      id: randomUUID(),
      supplierId: f.supplier.id,
      reason: 'Інше',
      lines: [
        { id: f.receipt.lines[0].id, quantity: '1' },
        { id: other.receipt.lines[0].id, quantity: '1' },
      ],
    }
    await expect(f.post(input)).rejects.toThrow('цього постачальника')
    expect(await db.supplierReturn.count({ where: { id: input.id } })).toBe(0)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      3
    )
    const otherSupplier = await db.counterparty.create({
      data: { organizationId: f.org.id, name: 'Other', createdById: 'test' },
    })
    await db.supplierReceipt.update({
      where: { id: f.receipt.id },
      data: { supplierId: otherSupplier.id },
    })
    await expect(f.post({ ...input, lines: [input.lines[0]] })).rejects.toThrow(
      'цього постачальника'
    )
  })
  it('rolls back a multi-receipt return when the shared stock cannot cover the combined quantities', async () => {
    const f = await setup()
    const second = await db.supplierReceipt.create({
      data: {
        organizationId: f.org.id,
        supplierId: f.supplier.id,
        number: 'SECOND',
        documentDate: f.receipt.documentDate,
        receivedDate: f.receipt.receivedDate,
        status: 'posted',
        createdById: 'test',
        lines: {
          create: {
            position: 0,
            kind: 'part',
            name: 'Same stock',
            unit: 'шт',
            quantity: 3,
            unitPrice: 100,
            amount: 300,
            partId: f.part.id,
          },
        },
        settlement: {
          create: {
            organizationId: f.org.id,
            supplierId: f.supplier.id,
            kind: 'receipt',
            amount: 300,
            date: f.receipt.receivedDate,
            createdById: 'test',
          },
        },
      },
      include: { lines: true },
    })
    const input = {
      id: randomUUID(),
      supplierId: f.supplier.id,
      reason: 'Інше',
      lines: [
        { id: f.receipt.lines[0].id, quantity: '2' },
        { id: second.lines[0].id, quantity: '2' },
      ],
    }
    await expect(f.post(input)).rejects.toThrow('залишок')
    expect(await db.supplierReturn.count({ where: { id: input.id } })).toBe(0)
    expect((await db.inventoryPart.findUniqueOrThrow({ where: { id: f.part.id } })).quantity).toBe(
      3
    )
  })
  it('restores both legacy receipt-based and independent return backups with supplier validation', async () => {
    const f = await setup()
    const base = {
      id: randomUUID(),
      receiptId: f.receipt.id,
      organizationId: f.org.id,
      number: 'BACKUP',
      date: f.receipt.documentDate.toISOString(),
      reason: 'Legacy free-text reason',
      fingerprint: 'backup',
      createdById: 'test',
      lines: [
        {
          id: randomUUID(),
          lineId: f.receipt.lines[0].id,
          quantity: '1',
          amount: '100.00',
          brandSnapshot: 'Frozen brand',
          articleSnapshot: 'Frozen SKU',
        },
      ],
    }
    await db.$transaction((tx) => restoreSupplierReturn(tx as TxClient, f.org.id, 'test', base))
    const restored = await db.supplierReturn.findUniqueOrThrow({ where: { id: base.id } })
    expect(restored.supplierId).toBe(f.supplier.id)
    expect(restored.reason).toBe('Інше')
    const independent = {
      ...base,
      id: randomUUID(),
      receiptId: null,
      supplierId: f.supplier.id,
      reason: 'Брак/рекламація',
      lines: [{ ...base.lines[0], id: randomUUID() }],
    }
    await db.$transaction((tx) =>
      restoreSupplierReturn(tx as TxClient, f.org.id, 'test', independent)
    )
    expect(
      (await db.supplierReturn.findUniqueOrThrow({ where: { id: independent.id } })).reason
    ).toBe('Брак/рекламація')
    expect(
      (await db.supplierReturnLine.findFirstOrThrow({ where: { returnId: independent.id } }))
        .brandSnapshot
    ).toBe('Frozen brand')
    await expect(
      db.$transaction((tx) =>
        restoreSupplierReturn(tx as TxClient, 'other', 'test', { ...base, id: randomUUID() })
      )
    ).rejects.toThrow()
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
