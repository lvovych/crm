// @vitest-environment node
import { afterAll, expect, it, describe } from 'vitest'
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  draftSubcontractReceipts,
  assignReceiptService,
} from '@/features/receipts/subcontract-ledger'
import { saveReceiptDraft } from '@/features/receipts/save-ledger'
import { DOCUMENT_LOCK_DEFAULTS } from '@/lib/document-lock'
import type { TxClient } from '@/lib/db'

const url = process.env.FINANCE_TEST_DATABASE_URL
describe.skipIf(!url)('subcontract services on PostgreSQL', () => {
  let db: PrismaClient
  afterAll(async () => {
    await db?.$disconnect()
  })
  it('groups pending work, survives concurrent retries, links existing receipts and keeps sale and cost separate', async () => {
    if (
      !url ||
      !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
      !new URL(url).pathname.includes('test')
    )
      throw new Error('Expected local test database')
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
    const { id: org } = await db.organization.create({ data: { name: 'Subcontract test' } })
    const { id: order } = await db.serviceRecord.create({
      data: { organizationId: org, title: 'Order', status: 'pending' },
    })
    const suppliers = await Promise.all(
      ['A', 'B'].map((name) =>
        db.counterparty.create({ data: { organizationId: org, name, createdById: 'test' } })
      )
    )
    for (const supplier of [suppliers[0], suppliers[0], suppliers[1]]) {
      await db.serviceLabor.create({
        data: {
          serviceRecordId: order,
          description: 'Turning',
          hours: 1,
          rate: 1200,
          total: 1200,
          subcontract: { create: { supplierId: supplier.id, unitCost: '800.005' } },
        },
      })
    }
    const drafts = () =>
      db.$transaction((tx) => draftSubcontractReceipts(tx as TxClient, org, 'test', order))
    const [a, b] = await Promise.all([drafts(), drafts()])
    expect(a.sort()).toEqual(b.sort())
    const docs = await db.supplierReceipt.findMany({
      where: { organizationId: org },
      include: { lines: true, settlement: true },
    })
    expect(docs.map((d) => d.lines.length).sort()).toEqual([1, 2])
    expect(
      docs.every(
        (d) =>
          d.status === 'draft' &&
          !d.settlement &&
          d.lines.every((l) => l.amount.toString() === '800.01')
      )
    ).toBe(true)
    const editable = docs.find((doc) => doc.lines.length === 2)!
    await db.supplierProfile.create({
      data: { counterpartyId: editable.supplierId, organizationId: org },
    })
    const day = editable.documentDate.toISOString().slice(0, 10)
    const edit = {
      id: editable.id,
      version: editable.version,
      supplierId: editable.supplierId,
      number: 'SUP-123',
      documentDate: day,
      receivedDate: day,
      lines: editable.lines.map((l) => ({
        id: l.id,
        kind: 'service',
        partId: null,
        name: l.name,
        quantity: '1',
        unit: l.unit,
        unitPrice: '900',
      })),
    }
    await db.$transaction((tx) => saveReceiptDraft(tx as TxClient, org, 'test', edit, true, false))
    expect(
      await db.supplierReceipt.findUniqueOrThrow({ where: { id: editable.id } })
    ).toMatchObject({ status: 'posted' })
    for (const original of editable.lines) {
      const work = await db.subcontractWork.findUniqueOrThrow({
        where: { receiptLineId: original.id },
        include: { labor: true },
      })
      expect(work.unitCost.toString()).toBe('900')
      expect(work.labor.total).toBe(1200)
    }
    const receipt = await db.supplierReceipt.create({
      data: {
        organizationId: org,
        supplierId: suppliers[0].id,
        number: 'external',
        status: 'posted',
        createdById: 'test',
        documentDate: new Date(),
        receivedDate: new Date(),
        lines: {
          create: {
            position: 0,
            kind: 'service',
            name: 'Testing',
            unit: 'service',
            quantity: 2,
            unitPrice: 300,
            amount: 600,
          },
        },
      },
      include: { lines: true },
    })
    const attach = () =>
      db.$transaction((tx) =>
        assignReceiptService(
          tx as TxClient,
          org,
          order,
          receipt.lines[0].id,
          null,
          '550',
          DOCUMENT_LOCK_DEFAULTS
        )
      )
    await attach()
    await attach()
    const linked = await db.subcontractWork.findUniqueOrThrow({
      where: { receiptLineId: receipt.lines[0].id },
      include: { labor: true },
    })
    expect(linked.unitCost.toString()).toBe('300')
    expect(linked.labor.total).toBe(1100)
    const late = await db.serviceLabor.create({
      data: {
        serviceRecordId: order,
        description: 'Late service receipt',
        hours: 1,
        rate: 950,
        total: 950,
        subcontract: { create: { supplierId: suppliers[0].id, unitCost: 650 } },
      },
    })
    const lateLine = await db.supplierReceiptLine.create({
      data: {
        receiptId: receipt.id,
        kind: 'service',
        name: 'Late',
        unit: 'service',
        position: 1,
        quantity: 1,
        unitPrice: 700,
        amount: 700,
      },
    })
    await db.serviceRecord.update({ where: { id: order }, data: { status: 'completed' } })
    await expect(
      db.$transaction((tx) =>
        assignReceiptService(
          tx as TxClient,
          org,
          order,
          lateLine.id,
          null,
          '900',
          DOCUMENT_LOCK_DEFAULTS
        )
      )
    ).rejects.toThrow()
    await db.$transaction((tx) =>
      assignReceiptService(
        tx as TxClient,
        org,
        order,
        lateLine.id,
        late.id,
        '',
        DOCUMENT_LOCK_DEFAULTS
      )
    )
    expect(
      (
        await db.subcontractWork.findUniqueOrThrow({ where: { laborId: late.id } })
      ).unitCost.toString()
    ).toBe('700')
    expect((await db.serviceLabor.findUniqueOrThrow({ where: { id: late.id } })).total).toBe(950)
    expect(await db.stockMovement.count({ where: { organizationId: org } })).toBe(0)
  })
})
